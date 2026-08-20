import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTwseHolidayCsv } from "../src/v6/market-data-incremental-controller.ts";

const runner = fs.readFileSync("src/v6/market-data-cloudflare-runner.ts", "utf8");
const dispatcher = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
const entrypoint = fs.readFileSync("src/index-v6.ts", "utf8");
const deployWorkflow = fs.readFileSync(".github/workflows/deploy-cloudflare-production.yml", "utf8");

assert.match(runner, /dueLayerKeys/);
assert.match(runner, /mergeReadyMonotonic/);
assert.match(runner, /retries: 8/);
assert.match(dispatcher, /hour === 18 && minute >= 15/);
assert.match(dispatcher, /hour >= 19 && hour <= 23/);
assert.match(dispatcher, /hour === 23 && minute === 55/);
assert.match(dispatcher, /PREVIOUS_DAY_FINAL_AUDIT/);
assert.match(dispatcher, /WEEKEND_PREFLIGHT/);
assert.match(dispatcher, /runMarketDataCloudflareCapture/);
assert.match(wrangler, /"crons": \["\*\/5 \* \* \* \*"\]/);
assert.match(entrypoint, /async scheduled\(controller: ScheduledController/);
assert.match(entrypoint, /runExtendedScheduledMarketDataController/);
assert.match(entrypoint, /CLOUDFLARE_CRON_CANONICAL_WRITER/);
assert.match(entrypoint, /NO_2230_HARD_STOP/);
assert.match(deployWorkflow, /npx wrangler deploy/);
assert.match(deployWorkflow, /CLOUDFLARE_API_TOKEN/);
assert.match(deployWorkflow, /tmp\/deploy-receipts\/taistock-mcp-cloudflare\.json/);

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

console.log("market-data-cloudflare-cron tests passed");
