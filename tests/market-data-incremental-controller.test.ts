import assert from "node:assert/strict";
import { setMarketDataCapturePolicy } from "../src/v6/market-data-capture-context.ts";
import {
  MAX_AUTOMATIC_RETRY_ATTEMPTS,
  automaticRetryDelayMinutes,
  automaticRetryExhausted,
  classifyTradingDay,
  dueLayerKeys,
  makePendingLayer,
  mergeReadyMonotonic,
  parseTwseHolidayCsv,
  parseTwseHolidayJson,
  summarizeDay,
  type MarketManifestLayer,
} from "../src/v6/market-data-incremental-controller.ts";

const csv = "日期,名稱,說明\n2026-02-20,農曆除夕及春節,補假\n2026-02-23,農曆春節後開始交易日,農曆春節後開始交易\n2026-09-25,中秋節,依規定放假1日。\n";
const calendar = parseTwseHolidayCsv(csv);
assert.equal(calendar.length, 3);
assert.equal(classifyTradingDay({ tradeDate: "2026-09-25", calendarEntries: calendar, calendarVerified: true }).status, "CLOSED_SCHEDULED");
assert.equal(classifyTradingDay({ tradeDate: "2026-02-23", calendarEntries: calendar, calendarVerified: true }).status, "OPEN_EXPECTED");
assert.equal(classifyTradingDay({ tradeDate: "2026-08-22", calendarEntries: calendar, calendarVerified: true }).status, "CLOSED_WEEKEND");

const jsonCalendar = parseTwseHolidayJson({
  fields: ["日期", "名稱", "說明"],
  data: [
    ["2月20日", "農曆除夕及春節", "依規定休市"],
    ["2月23日", "農曆春節後開始交易日", "農曆春節後開始交易"],
  ],
}, "2026");
assert.equal(jsonCalendar.length, 2);
assert.equal(classifyTradingDay({ tradeDate: "2026-02-20", calendarEntries: jsonCalendar, calendarVerified: true }).status, "CLOSED_SCHEDULED");
assert.equal(classifyTradingDay({ tradeDate: "2026-02-23", calendarEntries: jsonCalendar, calendarVerified: true }).status, "OPEN_EXPECTED");

const unavailable = classifyTradingDay({ tradeDate: "2026-08-20", calendarEntries: [], calendarVerified: false });
assert.equal(unavailable.status, "UNKNOWN");
assert.equal(unavailable.terminal, false);
assert.equal(unavailable.reason, "official_calendar_unavailable_fail_closed");
assert.equal(unavailable.evidence.verified, false);
assert.equal(classifyTradingDay({ tradeDate: "2026-08-20", override: { status: "CLOSED", reason: "typhoon", source: "TWSE_NOTICE" } }).status, "CLOSED_EMERGENCY");

const ready: MarketManifestLayer = {
  kind: "institutional", market: "listed", status: "READY", source: "T86", row_count: 100,
  dataset_version: "v", content_sha256: "h", snapshot_path: "p", raw_paths: ["r"],
  captured_at: "2026-08-20T10:15:00Z", error: null, attempts: 1,
  first_attempt_at: "2026-08-20T10:15:00Z", last_attempt_at: "2026-08-20T10:15:00Z", next_retry_at: null,
};
const failed = makePendingLayer({ kind: "institutional", market: "listed" }, "2026-08-20T10:25:00Z", { previous: ready, error: "timeout", status: "ERROR" });
assert.equal(mergeReadyMonotonic(ready, failed).status, "READY");

const pending = makePendingLayer({ kind: "margin", market: "listed" }, "2026-08-20T10:15:00Z", { error: "source_date_mismatch" });
assert.equal(pending.attempts, 1);
assert.equal(pending.next_retry_at, "2026-08-20T10:25:00.000Z");
assert.equal(dueLayerKeys([ready, pending], "2026-08-20T10:20:00Z").includes("margin-listed"), false);
assert.equal(dueLayerKeys([ready, pending], "2026-08-20T10:25:00Z").includes("margin-listed"), true);
assert.equal(automaticRetryDelayMinutes(1), 10);
assert.equal(automaticRetryDelayMinutes(2), 20);
assert.equal(automaticRetryDelayMinutes(6), 320);
assert.equal(automaticRetryDelayMinutes(20), 360);

// 18:00 institutional checkpoint must not expose margin/lending/SBL.
setMarketDataCapturePolicy({ allowedKinds: ["institutional"], checkpointStartedAt: "2026-08-20T10:00:00Z" });
const institutionalOnly = dueLayerKeys([ready, pending], "2026-08-20T10:30:00Z");
assert.equal(institutionalOnly.some((key) => key.startsWith("margin-")), false);
assert.equal(institutionalOnly.every((key) => key.startsWith("institutional-")), true);

// Regression: a structural placeholder is not a real provider attempt. The
// next five-minute wake in the same checkpoint must pick it up even though the
// manifest already contains the layer and next_retry_at is intentionally null.
const institutionalPlaceholder: MarketManifestLayer = {
  kind: "institutional", market: "otc", status: "PENDING", source: null, row_count: 0,
  dataset_version: null, content_sha256: null, snapshot_path: null, raw_paths: [],
  captured_at: null, error: "not_attempted_in_current_subrequest_window", attempts: 0,
  first_attempt_at: null, last_attempt_at: null, next_retry_at: null,
};
assert.equal(
  dueLayerKeys([ready, institutionalPlaceholder], "2026-08-20T10:05:00Z").includes("institutional-otc"),
  true,
);

// A layer already attempted after checkpoint start cannot be polled again by
// another five-minute wake in the same checkpoint.
const attemptedThisCheckpoint = makePendingLayer(
  { kind: "margin", market: "listed" },
  "2026-08-20T13:16:00Z",
  { error: "source_date_mismatch", retryMinutes: 0 },
);
setMarketDataCapturePolicy({ allowedKinds: ["margin"], checkpointStartedAt: "2026-08-20T13:15:00Z" });
assert.equal(dueLayerKeys([attemptedThisCheckpoint], "2026-08-20T13:30:00Z").includes("margin-listed"), false);

// A later recovery checkpoint is a new attempt epoch.
setMarketDataCapturePolicy({ allowedKinds: ["margin"], checkpointStartedAt: "2026-08-20T14:15:00Z" });
assert.equal(dueLayerKeys([attemptedThisCheckpoint], "2026-08-20T14:30:00Z").includes("margin-listed"), true);

// 2026-09-02 regression model: OTC SBL failed at 21:25 Taipei and was given a
// 21:35 next_retry_at. The same 21:15 epoch must still block a retry storm, but
// a later 21:30 bounded epoch may retry once next_retry_at is due. This is what
// lets a relay that becomes complete at 21:41 be consumed on the 21:45 wake.
const lateSblFailure = makePendingLayer(
  { kind: "sbl_short_sale", market: "otc" },
  "2026-09-02T13:25:00Z",
  { error: "TPEX_SHORT_SELL_all_transports_failed", status: "ERROR", retryMinutes: 10 },
);
assert.equal(lateSblFailure.next_retry_at, "2026-09-02T13:35:00.000Z");
setMarketDataCapturePolicy({ allowedKinds: ["sbl_short_sale"], checkpointStartedAt: "2026-09-02T13:15:00Z" });
assert.equal(dueLayerKeys([lateSblFailure], "2026-09-02T13:35:00Z").includes("sbl_short_sale-otc"), false);
setMarketDataCapturePolicy({ allowedKinds: ["sbl_short_sale"], checkpointStartedAt: "2026-09-02T13:30:00Z" });
assert.equal(dueLayerKeys([lateSblFailure], "2026-09-02T13:35:00Z").includes("sbl_short_sale-otc"), true);
setMarketDataCapturePolicy(null);

// Regression: an unavailable source can never create an unbounded retry storm.
let exhausted: MarketManifestLayer | null = null;
for (let attempt = 1; attempt <= MAX_AUTOMATIC_RETRY_ATTEMPTS; attempt++) {
  exhausted = makePendingLayer(
    { kind: "sbl_short_sale", market: "otc" },
    `2026-08-20T${String(10 + attempt).padStart(2, "0")}:00:00Z`,
    { previous: exhausted, error: "source_date_mismatch:null" },
  );
}
assert.ok(exhausted);
assert.equal(exhausted!.attempts, MAX_AUTOMATIC_RETRY_ATTEMPTS);
assert.equal(exhausted!.next_retry_at, null);
assert.equal(automaticRetryExhausted(exhausted), true);
assert.match(exhausted!.error || "", /^automatic_retry_exhausted:/);
assert.equal(dueLayerKeys([exhausted!], "2026-08-22T00:00:00Z").includes("sbl_short_sale-otc"), false);

const identities = [
  ["institutional", "otc"], ["margin", "listed"], ["margin", "otc"],
  ["securities_lending", "listed"], ["securities_lending", "otc"],
  ["sbl_short_sale", "listed"], ["sbl_short_sale", "otc"],
] as const;
const layers = [ready, ...identities.map(([kind, market]) => makePendingLayer({ kind, market }, "2026-08-20T10:15:00Z"))];
assert.equal(summarizeDay(layers).terminal, false);

console.log("market-data incremental controller + bounded retry epoch + placeholder continuation + retry-storm guard tests passed");
