import assert from "node:assert/strict";
import {
  classifyTradingDay,
  dueLayerKeys,
  makePendingLayer,
  mergeReadyMonotonic,
  parseTwseHolidayCsv,
  summarizeDay,
  type MarketManifestLayer,
} from "../src/v6/market-data-incremental-controller.ts";

const csv = "日期,名稱,說明\n2026-02-20,農曆除夕及春節,補假\n2026-02-23,農曆春節後開始交易日,農曆春節後開始交易\n2026-09-25,中秋節,依規定放假1日。\n";
const calendar = parseTwseHolidayCsv(csv);
assert.equal(calendar.length, 3);
assert.equal(classifyTradingDay({ tradeDate: "2026-09-25", calendarEntries: calendar, calendarVerified: true }).status, "CLOSED_SCHEDULED");
assert.equal(classifyTradingDay({ tradeDate: "2026-02-23", calendarEntries: calendar, calendarVerified: true }).status, "OPEN_EXPECTED");
assert.equal(classifyTradingDay({ tradeDate: "2026-08-22", calendarEntries: calendar, calendarVerified: true }).status, "CLOSED_WEEKEND");
assert.equal(classifyTradingDay({ tradeDate: "2026-08-20", calendarEntries: [], calendarVerified: false }).status, "OPEN_EXPECTED");
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

const identities = [
  ["institutional", "otc"], ["margin", "listed"], ["margin", "otc"],
  ["securities_lending", "listed"], ["securities_lending", "otc"],
  ["sbl_short_sale", "listed"], ["sbl_short_sale", "otc"],
] as const;
const layers = [ready, ...identities.map(([kind, market]) => makePendingLayer({ kind, market }, "2026-08-20T10:15:00Z"))];
assert.equal(summarizeDay(layers).terminal, false);

console.log("market-data incremental controller tests passed");
