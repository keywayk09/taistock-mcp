import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTwseHolidayCsv } from "../src/v6/market-data-incremental-controller.ts";
import { decideExtendedMarketDataSchedule } from "../src/v6/market-data-schedule.ts";

const legacyRunner = fs.readFileSync("src/v6/market-data-cloudflare-runner.ts", "utf8");
const runner = fs.readFileSync("src/v6/market-data-cloudflare-chunked-runner.ts", "utf8");
const publisher = fs.readFileSync("src/v6/market-data-publisher.ts", "utf8");
const publishedGateway = fs.readFileSync("src/v6/market-data-published-gateway.ts", "utf8");
const tpexTransport = fs.readFileSync("src/v6/tpex-cloudflare-transport.ts", "utf8");
const tpexRelayWorkflow = fs.readFileSync(".github/workflows/tpex-official-relay-v2.yml", "utf8");
const dispatcher = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
const schedule = fs.readFileSync("src/v6/market-data-schedule.ts", "utf8");
const fastGateway = fs.readFileSync("src/v6/market-data-fast-gateway.ts", "utf8");
const marketTools = fs.readFileSync("src/v6/tw-market-data-tools.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
const entrypoint = fs.readFileSync("src/index-v6.ts", "utf8");
const deployWorkflow = fs.readFileSync(".github/workflows/deploy-cloudflare-production.yml", "utf8");

function taipei(isoLocal: string) {
  return new Date(`${isoLocal}+08:00`);
}

assert.match(legacyRunner, /dueLayerKeys/);
assert.match(runner, /dueLayerKeys/);
assert.match(runner, /mergeReadyMonotonic/);
assert.match(runner, /MARKET_DATA_CAPTURE_BATCH_SIZE = 1/);
assert.match(runner, /MARKET_DATA_INDEX_PREFIX_BATCH_SIZE = 1/);
assert.match(runner, /dueAll\.slice\(0, MARKET_DATA_CAPTURE_BATCH_SIZE\)/);
assert.match(runner, /processIndexBatch/);
assert.match(runner, /completed_prefixes/);
assert.match(runner, /retries: 2/);
assert.match(runner, /getTpexInstitutionalPayload/);
assert.match(runner, /getTpexMarginPayload/);
assert.match(runner, /getTpexJson/);
assert.match(publisher, /MARKET_DATA_PUBLISH_PREFIX_BATCH_SIZE = 5/);
assert.match(publisher, /validateMarketReadPublishPrerequisites/);
assert.match(publisher, /auditMaterializedPrefix/);
assert.match(publisher, /putImmutableGitHubJson/);
assert.match(publisher, /marketReadPublishedShardPath/);
assert.match(publisher, /marketReadPublishedPointerPath/);
assert.match(publishedGateway, /PUBLISHED_GENERATION_CURRENT_MONTH_PLUS_CLOSED_MONTH_HISTORY/);
assert.match(publishedGateway, /assertPublishedShard/);
assert.match(publishedGateway, /mixed_generation_current_day: false/);
assert.match(publishedGateway, /daily_snapshot_overlay: false/);
assert.match(tpexTransport, /Accept-Language/);
assert.match(tpexTransport, /Referer/);
assert.match(tpexTransport, /Mozilla\/5\.0/);
assert.match(tpexTransport, /redirect: "manual"/);
assert.match(tpexTransport, /TPEX_OFFICIAL_RELAY_V2/);
assert.match(tpexTransport, /TPEX_OFFICIAL_RELAY_LATEST_V2/);
assert.match(tpexTransport, /sha256Text/);
assert.match(tpexTransport, /getRelayDataset/);
assert.match(tpexTransport, /3itrade_hedge_result\.php/);
assert.match(tpexTransport, /margin_bal_result\.php/);
assert.match(tpexRelayWorkflow, /tpex_3insti_daily_trading/);
assert.match(tpexRelayWorkflow, /tpex_mainboard_margin_balance/);
assert.match(tpexRelayWorkflow, /tpex_margin_sbl/);
assert.match(tpexRelayWorkflow, /tpex_short_sell/);
assert.match(tpexRelayWorkflow, /market-data-relay/);
assert.match(tpexRelayWorkflow, /TPEX_OFFICIAL_RELAY_V2/);
assert.match(tpexRelayWorkflow, /canonical_storage/);
assert.match(fastGateway, /PREFIX_MONTH_READ_MODEL_PLUS_DAILY_SNAPSHOT_OVERLAY/);
assert.match(fastGateway, /symbol\.slice\(0, 2\)/);
assert.match(fastGateway, /institutional/);
assert.match(fastGateway, /margin/);
assert.match(fastGateway, /securities_lending/);
assert.match(fastGateway, /sbl_short_sale/);
assert.match(fastGateway, /NEEDS_OHLC_JOIN/);
assert.match(fastGateway, /ESTIMATED_POSITION_MAINTENANCE_PROXY/);
assert.match(marketTools, /get_tw_market_chip_summary/);
assert.match(marketTools, /preferred_symbol_read_tool/);
assert.match(marketTools, /consistency: z\.enum\(\["published", "live"\]\)/);
assert.match(marketTools, /default\("published"\)/);
assert.match(marketTools, /getTwMarketChipSummaryPublished/);
assert.doesNotMatch(dispatcher, /runMarketDataCloudflareCapture/);
assert.match(dispatcher, /runSubrequestSafeMarketDataCapture/);
assert.match(dispatcher, /runMarketDataPublisher/);
assert.match(schedule, /hour === 18 && minute >= 15/);
assert.match(schedule, /hour >= 19 && hour <= 23/);
assert.match(schedule, /PREVIOUS_DAY_OVERNIGHT_CATCHUP/);
assert.match(schedule, /PREVIOUS_DAY_FINAL_AUDIT/);
assert.match(schedule, /WEEKEND_PREFLIGHT/);
assert.match(dispatcher, /decideExtendedMarketDataSchedule/);
assert.match(wrangler, /"crons": \["\*\/5 \* \* \* \*"\]/);
assert.match(entrypoint, /async scheduled\(controller: ScheduledController/);
assert.match(entrypoint, /runExtendedScheduledMarketDataController/);
assert.match(entrypoint, /CLOUDFLARE_CRON_CANONICAL_WRITER/);
assert.match(entrypoint, /NO_2230_HARD_STOP/);
assert.match(deployWorkflow, /npx wrangler deploy/);
assert.match(deployWorkflow, /CLOUDFLARE_API_TOKEN/);
assert.match(deployWorkflow, /tmp\/deploy-receipts\/taistock-mcp-cloudflare\.json/);

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-20T18:15:00")), {
  tradeDate: "2026-08-20",
  finalAudit: false,
  reason: "TRADING_EVENING_EXTENDED",
});
assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T00:10:00")), {
  tradeDate: "2026-08-20",
  finalAudit: false,
  reason: "PREVIOUS_DAY_OVERNIGHT_CATCHUP",
});
assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T07:55:00")), {
  tradeDate: "2026-08-20",
  finalAudit: false,
  reason: "PREVIOUS_DAY_OVERNIGHT_CATCHUP",
});
assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T08:30:00")), {
  tradeDate: "2026-08-20",
  finalAudit: true,
  reason: "PREVIOUS_DAY_FINAL_AUDIT",
});
assert.equal(decideExtendedMarketDataSchedule(taipei("2026-08-24T00:10:00")), null);

const csv = [
  '"日期","名稱","說明"',
  '"115年2月16日","農曆春節","休市"',
  '"2月23日","春節後","開始交易"',
].join("\n");
const parsed = parseTwseHolidayCsv(csv, "2026");
assert.equal(parsed[0]?.date, "2026-02-16");
assert.equal(parsed[0]?.open, false);
assert.equal(parsed[1]?.date, "2026-02-23");
assert.equal(parsed[1]?.open, true);

console.log("market-data Cloudflare cron, verified TPEx relay, live/published read gateway tests passed");
