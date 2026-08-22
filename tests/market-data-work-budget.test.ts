import assert from "node:assert/strict";
import type { MarketDataBackfillState } from "../src/v6/market-data-backfill-policy.ts";
import { shouldWaitForHistoryMonth } from "../src/v6/market-data-publish-history-fence.ts";
import {
  DEFAULT_MARKET_DATA_WORK_SLICE_MS,
  chargeMarketDataWorkBudget,
  createMarketDataWorkBudget,
  hasSafeMarketDataBudget,
} from "../src/v6/market-data-work-budget.ts";

// Cloudflare Cron Triggers that run more frequently than hourly have a 30s CPU
// ceiling. Our own scheduler window must end materially before that ceiling so
// a final raw/snapshot/reconcile unit cannot be hard-killed mid-persistence.
assert.ok(DEFAULT_MARKET_DATA_WORK_SLICE_MS <= 24_000, `cron-safe work slice must leave platform CPU headroom; got ${DEFAULT_MARKET_DATA_WORK_SLICE_MS}`);

const fast = createMarketDataWorkBudget({ nowMs: 0, sliceMs: 24_000, subrequestBudget: 42 });
let fastUnits = 0;
let fastNow = 0;
while (hasSafeMarketDataBudget(fast, { nowMs: fastNow, nextEstimatedSubrequests: 4 })) {
  chargeMarketDataWorkBudget(fast, 4);
  fastUnits += 1;
  fastNow += 1_000;
}
assert.ok(fastUnits > 3, `fast lane should not be capped at three units; got ${fastUnits}`);

const expensive = createMarketDataWorkBudget({ nowMs: 0, sliceMs: 24_000, subrequestBudget: 42 });
let expensiveUnits = 0;
let expensiveNow = 0;
while (hasSafeMarketDataBudget(expensive, { nowMs: expensiveNow, nextEstimatedSubrequests: 12 })) {
  chargeMarketDataWorkBudget(expensive, 12);
  expensiveUnits += 1;
  expensiveNow += 1_000;
}
assert.ok(expensiveUnits < fastUnits, "higher-cost work must yield earlier without a fixed step ceiling");
assert.ok(expensive.estimated_subrequests <= expensive.subrequest_budget, "budget guard must not overshoot the safety ceiling");

const slow = createMarketDataWorkBudget({ nowMs: 0, sliceMs: 10_000, subrequestBudget: 100 });
assert.equal(hasSafeMarketDataBudget(slow, { nowMs: 9_000, nextEstimatedSubrequests: 1 }), true);
assert.equal(hasSafeMarketDataBudget(slow, { nowMs: 10_000, nextEstimatedSubrequests: 1 }), false);

// A History layer may still need several seconds for immutable raw + compressed
// snapshot + manifest reconcile. Do not start the unit when the remaining wall
// window is smaller than the requested completion guard, even though now < deadline.
const guarded = createMarketDataWorkBudget({ nowMs: 0, sliceMs: 24_000, subrequestBudget: 42 });
assert.equal(
  hasSafeMarketDataBudget(guarded, { nowMs: 13_000, nextEstimatedSubrequests: 10, minimumRemainingMs: 10_000 }),
  true,
);
assert.equal(
  hasSafeMarketDataBudget(guarded, { nowMs: 14_001, nextEstimatedSubrequests: 10, minimumRemainingMs: 10_000 }),
  false,
  "must yield before starting a persistence unit that cannot safely finish inside the cron-safe slice",
);

const runningAugust: MarketDataBackfillState = {
  schema_version: "diamond-market-data-backfill-state/v2",
  anchor_trade_date: "2026-08-21",
  target_start_date: "2025-08-27",
  cursor_date: "2026-08-12",
  status: "RUNNING",
  processed_dates: 6,
  updated_at: "2026-08-21T12:00:00.000Z",
  completed_at: null,
};
assert.equal(shouldWaitForHistoryMonth(runningAugust, "2026-08-21"), true);
assert.equal(shouldWaitForHistoryMonth({ ...runningAugust, cursor_date: "2026-07-31" }, "2026-08-21"), false);
assert.equal(shouldWaitForHistoryMonth({ ...runningAugust, status: "COMPLETE", completed_at: "2026-08-21T13:00:00.000Z" }, "2026-08-21"), false);
assert.equal(shouldWaitForHistoryMonth(null, "2026-08-21"), false);

console.log("market-data cron CPU-safe adaptive work budget + history publish fence tests passed");
