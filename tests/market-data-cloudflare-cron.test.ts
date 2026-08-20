import assert from "node:assert/strict";
import { decideMarketDataCron } from "../src/v6/market-data-cloudflare-runner.ts";
import { parseTwseHolidayCsv } from "../src/v6/market-data-incremental-controller.ts";

function utc(taipeiIsoWithoutOffset: string) {
  return new Date(`${taipeiIsoWithoutOffset}+08:00`);
}

const first = decideMarketDataCron(utc("2026-08-20T18:15:00"));
assert.deepEqual(first, { tradeDate: "2026-08-20", finalAudit: false, reason: "TRADING_EVENING" });
assert.equal(decideMarketDataCron(utc("2026-08-20T18:20:00"))?.tradeDate, "2026-08-20");
assert.equal(decideMarketDataCron(utc("2026-08-20T22:30:00"))?.finalAudit, true);
assert.deepEqual(decideMarketDataCron(utc("2026-08-21T08:30:00")), { tradeDate: "2026-08-20", finalAudit: true, reason: "PREVIOUS_DAY_FINAL_AUDIT" });
assert.deepEqual(decideMarketDataCron(utc("2026-08-22T18:15:00")), { tradeDate: "2026-08-22", finalAudit: false, reason: "WEEKEND_PREFLIGHT" });
assert.equal(decideMarketDataCron(utc("2026-08-22T18:20:00")), null);
assert.equal(decideMarketDataCron(utc("2026-08-20T12:00:00")), null);
assert.equal(decideMarketDataCron(utc("2026-08-20T22:35:00")), null);

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
