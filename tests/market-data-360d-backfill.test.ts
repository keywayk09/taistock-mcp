import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MARKET_DATA_BACKFILL_HORIZON_DAYS,
  MARKET_DATA_BACKFILL_STEPS_PER_CRON,
  initialMarketDataBackfillState,
  marketDataBackfillStart,
  refreshBackfillAnchor,
  shiftIsoDate,
  shouldAdvanceBackfillCursor,
} from "../src/v6/market-data-backfill-policy.ts";

assert.equal(MARKET_DATA_BACKFILL_HORIZON_DAYS, 360);
assert.equal(MARKET_DATA_BACKFILL_STEPS_PER_CRON, 3);
assert.equal(shiftIsoDate("2026-08-20", -1), "2026-08-19");
assert.equal(marketDataBackfillStart("2026-08-20"), "2025-08-26");

const state = initialMarketDataBackfillState("2026-08-20", new Date("2026-08-21T00:00:00Z"));
assert.equal(state.cursor_date, "2026-08-19");
assert.equal(state.target_start_date, "2025-08-26");
assert.equal(state.status, "RUNNING");
assert.equal(shouldAdvanceBackfillCursor("INDEX_COMPLETE"), true);
assert.equal(shouldAdvanceBackfillCursor("NO_TRADING_DAY"), true);
assert.equal(shouldAdvanceBackfillCursor("INDEX_PROGRESS"), false);

const complete = {
  ...state,
  status: "COMPLETE" as const,
  cursor_date: "2025-08-25",
};
const rolled = refreshBackfillAnchor(complete, "2026-08-21", new Date("2026-08-21T01:00:00Z"));
assert.equal(rolled.status, "COMPLETE");
assert.equal(rolled.target_start_date, "2025-08-27");
assert.equal(rolled.cursor_date, "2025-08-26");

const runtime = fs.readFileSync("src/v6/market-data-360d-backfill.ts", "utf8");
assert.match(runtime, /runSubrequestSafeMarketDataCapture/);
assert.match(runtime, /MARKET_DATA_BACKFILL_STEPS_PER_CRON/);
assert.match(runtime, /360d-state\.json/);

const dispatch = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
assert.match(dispatch, /MARKET_DATA_HOT_STEPS_PER_CRON = 3/);
assert.match(dispatch, /MARKET_DATA_PUBLISH_STEPS_PER_CRON = 2/);
assert.match(dispatch, /BACKFILL_PAUSED_FOR_HOT_LANE/);
assert.match(dispatch, /publication\?\.status === "PUBLISHED"/);

const transport = fs.readFileSync("src/v6/tpex-cloudflare-transport.ts", "utf8");
assert.match(transport, /margin_sbl_result\.php/);
assert.match(transport, /getMarketDataCaptureTradeDate/);
assert.match(transport, /source_date_mismatch/);
assert.match(transport, /getOfficialWebSblDataset/);

const tools = fs.readFileSync("src/v6/tw-market-data-tools.ts", "utf8");
assert.match(tools, /get_family_market_chip_summary/);
assert.match(tools, /READ_ONLY_PUBLISHED_GENERATION/);
assert.match(tools, /max\(360\)/);
assert.match(tools, /family_market_data_write: "FORBIDDEN"/);

const published = fs.readFileSync("src/v6/market-data-published-gateway.ts", "utf8");
assert.match(published, /Math\.min\(360/);
assert.match(published, /slice\(-360\)/);

console.log("PASS market-data 360d backfill + accelerated hot lane + family read-only access");
