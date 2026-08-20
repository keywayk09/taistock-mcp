import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTwseHolidayCsv } from "../src/v6/market-data-incremental-controller.ts";
import { decideExtendedMarketDataSchedule } from "../src/v6/market-data-schedule.ts";

const legacyRunner = fs.readFileSync("src/v6/market-data-cloudflare-runner.ts", "utf8");
const runner = fs.readFileSync("src/v6/market-data-cloudflare-chunked-runner.ts", "utf8");
const dispatcher = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
const schedule = fs.readFileSync("src/v6/market-data-schedule.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
const entrypoint = fs.readFileSync("src/index-v6.ts", "utf8");
const deployWorkflow = fs.readFileSync(".github/workflows/deploy-cloudflare-production.yml", "utf8");

function taipei(isoLocal: string) {
  return new Date(`${isoLocal}+08:00`);
}

assert.match(legacyRunner, /dueLayerKeys/);
assert.match(runner, /dueLayerKeys/);
assert.match(runner, /mergeReadyMonotonic/);
assert.match(runner, /MARKET_DATA_CAPTURE_BATCH_SIZE = 4/);
assert.match(runner, /MARKET_DATA_INDEX_PREFIX_BATCH_SIZE = 8/);
assert.match(runner, /dueAll\.slice\(0, MARKET_DATA_CAPTURE_BATCH_SIZE\)/);
assert.match(runner, /processIndexBatch/);
assert.match(runner, /completed_prefixes/);
assert.match(runner, /retries: 2/);
assert.doesNotMatch(dispatcher, /runMarketDataCloudflareCapture/);
assert.match(dispatcher, /runSubrequestSafeMarketDataCapture/);
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

console.log("market-data Cloudflare subrequest-safe cron tests passed");
