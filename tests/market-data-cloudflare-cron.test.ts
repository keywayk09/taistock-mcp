import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTwseHolidayCsv } from "../src/v6/market-data-incremental-controller.ts";
import { decideExtendedMarketDataSchedule } from "../src/v6/market-data-schedule.ts";

const legacyRunner = fs.readFileSync("src/v6/market-data-cloudflare-runner.ts", "utf8");
const runner = fs.readFileSync("src/v6/market-data-cloudflare-chunked-runner.ts", "utf8");
const captureContext = fs.readFileSync("src/v6/market-data-capture-context.ts", "utf8");
const incremental = fs.readFileSync("src/v6/market-data-incremental-controller.ts", "utf8");
const publisher = fs.readFileSync("src/v6/market-data-publisher-v5.ts", "utf8");
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
assert.match(runner, /MARKET_DATA_CAPTURE_BATCH_SIZE = 1/);
assert.match(runner, /MARKET_DATA_INDEX_PREFIX_BATCH_SIZE = 1/);
assert.match(runner, /processIndexBatch/);
assert.match(runner, /completed_prefixes/);
assert.match(captureContext, /setMarketDataCapturePolicy/);
assert.match(captureContext, /allowedKinds/);
assert.match(captureContext, /checkpointStartedAt/);
assert.match(captureContext, /HISTORY_COMPRESSED/);
assert.match(incremental, /getMarketDataCapturePolicy/);
assert.match(incremental, /last_attempt_at/);
assert.match(incremental, /lastAttempt >= checkpointStart/);
assert.match(publisher, /validateMarketReadPublishPrerequisites/);
assert.match(publisher, /auditMaterializedPrefix/);
assert.match(publisher, /atomicUpdateGitHubJsonFiles/);
assert.match(publisher, /adaptiveMarketDataPublishCapacity/);
assert.match(publisher, /marketReadPublishedGenerationManifestPath/);
assert.match(publisher, /source_blob_sha/);
assert.doesNotMatch(publisher, /symbols:\s*sourceRead\.value\.symbols/);
assert.doesNotMatch(publisher, /pending\.slice\(0,\s*\d+\)/);

assert.doesNotMatch(dispatcher, /MARKET_DATA_HOT_STEPS_PER_CRON/);
assert.doesNotMatch(dispatcher, /MARKET_DATA_PUBLISH_STEPS_PER_CRON/);
assert.doesNotMatch(dispatcher, /BACKFILL_PAUSED_FOR_HOT_LANE/);
assert.match(dispatcher, /runSubrequestSafeMarketDataCapture/);
assert.match(dispatcher, /runMarketDataPublisher/);
assert.match(dispatcher, /runMarketData360dBackfillStep/);
assert.match(dispatcher, /hasSafeMarketDataBudget/);
assert.match(dispatcher, /chargeMarketDataWorkBudget/);
assert.match(dispatcher, /subrequestBudget:\s*remainingSubrequests/);
assert.match(dispatcher, /storageMode:\s*"HISTORY_COMPRESSED"/);

assert.match(schedule, /DAILY_INSTITUTIONAL/);
assert.match(schedule, /DAILY_LATE/);
assert.match(schedule, /DAILY_RECOVERY/);
assert.match(schedule, /PREVIOUS_DAY_FINAL_AUDIT/);
assert.match(schedule, /HISTORY_BOOTSTRAP/);
assert.doesNotMatch(schedule, /TRADING_EVENING_EXTENDED/);
assert.doesNotMatch(schedule, /PREVIOUS_DAY_OVERNIGHT_CATCHUP/);
assert.match(wrangler, /"crons": \["\*\/5 \* \* \* \*"\]/);
assert.match(entrypoint, /async scheduled\(controller: ScheduledController/);
assert.match(entrypoint, /runExtendedScheduledMarketDataController/);
assert.match(deployWorkflow, /npx wrangler deploy/);

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T18:00:00")), {
  tradeDate: "2026-08-21",
  finalAudit: false,
  lane: "DAILY",
  allowedKinds: ["institutional"],
  checkpointStartedAt: "2026-08-21T10:00:00.000Z",
  reason: "DAILY_INSTITUTIONAL",
});

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T18:05:00")), {
  tradeDate: "2026-08-21",
  finalAudit: false,
  lane: "DAILY",
  allowedKinds: ["institutional"],
  checkpointStartedAt: "2026-08-21T10:00:00.000Z",
  reason: "DAILY_INSTITUTIONAL",
});

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T20:00:00")), {
  tradeDate: "2026-08-21",
  finalAudit: false,
  lane: "HISTORY",
  allowedKinds: [],
  checkpointStartedAt: null,
  reason: "HISTORY_BOOTSTRAP",
});

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T21:15:00")), {
  tradeDate: "2026-08-21",
  finalAudit: false,
  lane: "DAILY",
  allowedKinds: ["margin", "securities_lending", "sbl_short_sale"],
  checkpointStartedAt: "2026-08-21T13:15:00.000Z",
  reason: "DAILY_LATE",
});

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T21:20:00")), {
  tradeDate: "2026-08-21",
  finalAudit: false,
  lane: "DAILY",
  allowedKinds: ["margin", "securities_lending", "sbl_short_sale"],
  checkpointStartedAt: "2026-08-21T13:15:00.000Z",
  reason: "DAILY_LATE",
});

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-21T22:15:00")), {
  tradeDate: "2026-08-21",
  finalAudit: false,
  lane: "DAILY",
  allowedKinds: ["institutional", "margin", "securities_lending", "sbl_short_sale"],
  checkpointStartedAt: "2026-08-21T14:15:00.000Z",
  reason: "DAILY_RECOVERY",
});

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-22T08:30:00")), {
  tradeDate: "2026-08-21",
  finalAudit: true,
  lane: "DAILY",
  allowedKinds: ["institutional", "margin", "securities_lending", "sbl_short_sale"],
  checkpointStartedAt: "2026-08-22T00:30:00.000Z",
  reason: "PREVIOUS_DAY_FINAL_AUDIT",
});

assert.deepEqual(decideExtendedMarketDataSchedule(taipei("2026-08-22T12:00:00")), {
  tradeDate: "2026-08-21",
  finalAudit: false,
  lane: "HISTORY",
  allowedKinds: [],
  checkpointStartedAt: null,
  reason: "HISTORY_BOOTSTRAP",
});

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

console.log("market-data staged daily checkpoints + adaptive history/publisher scheduler contract passed");
