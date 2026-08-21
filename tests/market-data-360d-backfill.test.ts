import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MARKET_DATA_BACKFILL_HORIZON_DAYS,
  initialMarketDataBackfillState,
  marketDataBackfillStart,
  refreshBackfillAnchor,
  shiftIsoDate,
  shouldAdvanceBackfillCursor,
} from "../src/v6/market-data-backfill-policy.ts";

assert.equal(MARKET_DATA_BACKFILL_HORIZON_DAYS, 360);
assert.equal(shiftIsoDate("2026-08-20", -1), "2026-08-19");
assert.equal(marketDataBackfillStart("2026-08-20"), "2025-08-26");

const state = initialMarketDataBackfillState("2026-08-20", new Date("2026-08-21T00:00:00Z"));
assert.equal(state.anchor_trade_date, "2026-08-20");
assert.equal(state.cursor_date, "2026-08-19");
assert.equal(state.target_start_date, "2025-08-26");
assert.equal(state.status, "RUNNING");
assert.equal(state.completed_at, null);
assert.equal(shouldAdvanceBackfillCursor("INDEX_COMPLETE"), true);
assert.equal(shouldAdvanceBackfillCursor("NO_TRADING_DAY"), true);
assert.equal(shouldAdvanceBackfillCursor("INDEX_PROGRESS"), false);

// A completed bootstrap is terminal. A newer daily anchor must never reopen,
// extend, or roll the 360-day history cursor.
const complete = {
  ...state,
  status: "COMPLETE" as const,
  cursor_date: "2025-08-25",
  completed_at: "2026-08-21T01:00:00.000Z",
};
const frozen = refreshBackfillAnchor(complete, "2026-08-21", new Date("2026-08-22T01:00:00Z"));
assert.deepEqual(frozen, complete);

const runtime = fs.readFileSync("src/v6/market-data-360d-backfill.ts", "utf8");
assert.match(runtime, /runSubrequestSafeMarketDataCapture/);
assert.match(runtime, /360d-state\.json/);
assert.doesNotMatch(runtime, /MARKET_DATA_BACKFILL_STEPS_PER_CRON/);
assert.doesNotMatch(runtime, /for \(let step = 0; step < MARKET_DATA_BACKFILL_STEPS_PER_CRON/);
assert.match(runtime, /BACKFILL_COMPLETE/);
assert.match(runtime, /completed_at/);

const dispatch = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
assert.doesNotMatch(dispatch, /MARKET_DATA_HOT_STEPS_PER_CRON/);
assert.doesNotMatch(dispatch, /MARKET_DATA_PUBLISH_STEPS_PER_CRON/);
assert.doesNotMatch(dispatch, /BACKFILL_PAUSED_FOR_HOT_LANE/);
assert.doesNotMatch(dispatch, /publication\?\.status === "PUBLISHED"/);
assert.match(dispatch, /hasSafeMarketDataBudget/);
assert.match(dispatch, /chargeMarketDataWorkBudget/);
assert.match(dispatch, /lane === "HISTORY"/);

const transport = fs.readFileSync("src/v6/tpex-cloudflare-transport.ts", "utf8");
assert.match(transport, /margin_sbl_result\.php/);
assert.match(transport, /getMarketDataCaptureTradeDate/);
assert.match(transport, /source_date_mismatch/);
assert.match(transport, /getOfficialWebSblDataset/);

const published = fs.readFileSync("src/v6/market-data-published-gateway-v2.ts", "utf8");
assert.match(published, /Math\.min\(360/);
assert.match(published, /slice\(-360\)/);
assert.match(published, /GENERATION_MANIFEST_V5/);

console.log("PASS market-data one-shot 360d bootstrap + adaptive scheduler contract");
