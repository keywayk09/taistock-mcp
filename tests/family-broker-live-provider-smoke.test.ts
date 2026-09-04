// Opt-in live-provider canary. Intentionally excluded from the default
// `npm run test:research` suite because it depends on external public providers.
// Run manually with:
//   node --experimental-strip-types tests/family-broker-live-provider-smoke.test.ts
//
// This test is read-only: it calls the same MoneyDJ/TWSE adapter used by the
// runtime, requires no Family/Production credential, persists nothing, and must
// never substitute FinMind or a previous trading day for the requested date.
import assert from "node:assert/strict";
import { getTwBrokerRankedWindowBundleOnDemand } from "../src/v6/tw-broker-ranked-on-demand.ts";

const cases = [
  {
    name: "2330 2026-09-03 1D",
    symbol: "2330",
    as_of: "2026-09-03",
    windows: [1] as const,
    expectedFirstBuy: ["凱基-台北", 700] as const,
    expectedFirstSell: ["花旗環球", -906] as const,
  },
  {
    name: "2330 2026-09-04 1D",
    symbol: "2330",
    as_of: "2026-09-04",
    windows: [1] as const,
  },
  {
    name: "2330 2026-09-04 1/5/10/20/60/120D",
    symbol: "2330",
    as_of: "2026-09-04",
    windows: [1, 5, 10, 20, 60, 120] as const,
  },
  {
    name: "2377 2026-09-04 1/5/10/20/60/120D",
    symbol: "2377",
    as_of: "2026-09-04",
    windows: [1, 5, 10, 20, 60, 120] as const,
  },
  {
    name: "2330 2026-09-03 1/5/10/20/60D",
    symbol: "2330",
    as_of: "2026-09-03",
    windows: [1, 5, 10, 20, 60] as const,
  },
];

for (const testCase of cases) {
  const bundle = await getTwBrokerRankedWindowBundleOnDemand({
    symbol: testCase.symbol,
    as_of: testCase.as_of,
    windows: testCase.windows,
  });

  assert.ok(bundle.status === "READY" || bundle.status === "DEGRADED", `${testCase.name}: bundle status=${bundle.status}`);
  assert.equal(bundle.symbol, testCase.symbol, `${testCase.name}: symbol`);
  assert.equal(bundle.requested_as_of, testCase.as_of, `${testCase.name}: requested_as_of`);
  assert.deepEqual(bundle.requested_windows, [...testCase.windows], `${testCase.name}: requested_windows`);
  assert.equal(bundle.tier, "PUBLIC_SECONDARY", `${testCase.name}: tier`);
  assert.equal(bundle.completeness, "RANKED_ONLY", `${testCase.name}: completeness`);
  assert.equal(bundle.persistence, "NONE", `${testCase.name}: persistence`);
  assert.equal(bundle.daily_rank_summing, false, `${testCase.name}: daily_rank_summing`);
  assert.equal(bundle.missing_branch_means_zero, false, `${testCase.name}: missing_branch_means_zero`);
  assert.equal(bundle.previous_day_substitution, false, `${testCase.name}: previous_day_substitution`);

  for (const days of testCase.windows) {
    const result = bundle.windows[`${days}D`];
    assert.ok(result, `${testCase.name}: missing ${days}D`);
    assert.equal(result.status, "READY", `${testCase.name}: ${days}D status=${result.status} error=${"error" in result ? result.error : null}`);
    assert.equal(result.source_date, testCase.as_of, `${testCase.name}: ${days}D source_date`);
    assert.equal(result.source_date_verified, true, `${testCase.name}: ${days}D source_date_verified`);
    assert.equal(result.source_window_verified, true, `${testCase.name}: ${days}D source_window_verified`);
    assert.equal(result.source_range_verified, true, `${testCase.name}: ${days}D source_range_verified`);
  }

  const oneDay = bundle.windows["1D"];
  if (testCase.expectedFirstBuy) {
    assert.equal(oneDay.buys[0]?.broker_branch, testCase.expectedFirstBuy[0], `${testCase.name}: first buy broker`);
    assert.equal(oneDay.buys[0]?.net_lots, testCase.expectedFirstBuy[1], `${testCase.name}: first buy lots`);
  }
  if (testCase.expectedFirstSell) {
    assert.equal(oneDay.sells[0]?.broker_branch, testCase.expectedFirstSell[0], `${testCase.name}: first sell broker`);
    assert.equal(oneDay.sells[0]?.net_lots, testCase.expectedFirstSell[1], `${testCase.name}: first sell lots`);
  }

  console.log(`PASS ${testCase.name} status=${bundle.status} windows=${testCase.windows.join("/")}`);
}

console.log("FAMILY_BROKER_LIVE_PROVIDER_SMOKE=PASS");
console.log("SOURCE=MoneyDJ PUBLIC_SECONDARY RANKED_ONLY");
console.log("PRODUCTION_MUTATION=NONE");
