import assert from "node:assert/strict";
import {
  chargeMarketDataWorkBudget,
  createMarketDataWorkBudget,
  hasSafeMarketDataBudget,
} from "../src/v6/market-data-work-budget.ts";

const fast = createMarketDataWorkBudget({ nowMs: 0, sliceMs: 40_000, subrequestBudget: 42 });
let fastUnits = 0;
let fastNow = 0;
while (hasSafeMarketDataBudget(fast, { nowMs: fastNow, nextEstimatedSubrequests: 4 })) {
  chargeMarketDataWorkBudget(fast, 4);
  fastUnits += 1;
  fastNow += 1_000;
}
assert.ok(fastUnits > 3, `fast lane should not be capped at three units; got ${fastUnits}`);

const expensive = createMarketDataWorkBudget({ nowMs: 0, sliceMs: 40_000, subrequestBudget: 42 });
let expensiveUnits = 0;
let expensiveNow = 0;
while (hasSafeMarketDataBudget(expensive, { nowMs: expensiveNow, nextEstimatedSubrequests: 12 })) {
  chargeMarketDataWorkBudget(expensive, 12);
  expensiveUnits += 1;
  expensiveNow += 1_000;
}
assert.ok(expensiveUnits < fastUnits, "higher-cost work must yield earlier without a fixed step ceiling");

const slow = createMarketDataWorkBudget({ nowMs: 0, sliceMs: 10_000, subrequestBudget: 100 });
assert.equal(hasSafeMarketDataBudget(slow, { nowMs: 9_000, nextEstimatedSubrequests: 1 }), true);
assert.equal(hasSafeMarketDataBudget(slow, { nowMs: 10_000, nextEstimatedSubrequests: 1 }), false);

console.log("market-data adaptive work budget tests passed");
