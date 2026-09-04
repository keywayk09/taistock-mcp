import assert from "node:assert/strict";
import {
  getTwBrokerRankedWindowBundleOnDemand,
  resetTwBrokerRankedCacheForTests,
} from "../src/v6/tw-broker-ranked-on-demand.ts";
import { resetTwseTradingCalendarCacheForTests } from "../src/v6/twse-trading-calendar-on-demand.ts";

resetTwBrokerRankedCacheForTests();
resetTwseTradingCalendarCacheForTests();
const bundle = await getTwBrokerRankedWindowBundleOnDemand({
  symbol: "2419",
  as_of: "2026-09-04",
  windows: [1, 5, 10, 20, 60],
});

assert.equal(bundle.status, "READY");
assert.equal(bundle.ready_window_count, 5);
assert.equal(bundle.previous_day_substitution, false);
for (const days of [1, 5, 10, 20, 60] as const) {
  const row: any = bundle.windows[`${days}D`];
  assert.equal(row.status, "READY", `${days}D must be READY`);
  assert.equal(row.source_date, "2026-09-04", `${days}D must prove requested source date`);
  assert.equal(row.source_date_verified, true);
  assert.equal(row.source_range_verified, true);
  assert.ok(["concords.moneydj.com", "5850web.moneydj.com"].includes(row.source_host));
  assert.ok((row.rank_count?.buy ?? 0) > 0);
  assert.ok((row.rank_count?.sell ?? 0) > 0);
}
console.log("MONEYDJ_2419_LIVE_SMOKE", JSON.stringify({
  status: bundle.status,
  ready_window_count: bundle.ready_window_count,
  windows: Object.fromEntries([1, 5, 10, 20, 60].map((days) => {
    const row: any = bundle.windows[`${days}D`];
    return [`${days}D`, { source_host: row.source_host, source_date: row.source_date, buy: row.rank_count?.buy, sell: row.rank_count?.sell }];
  })),
}));
