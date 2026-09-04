import assert from "node:assert/strict";
import { buildFamilyBrokerWindowRenderRows } from "../src/v6/family-broker-window-render.ts";

const requested = [1, 5, 10, 20, 60, 120] as const;
const broker = {
  canonical_provider_id: "MONEYDJ",
  canonical_provider_name: "MoneyDJ",
  requested_as_of: "2026-09-04",
  requested_windows: [...requested],
  windows: Object.fromEntries(requested.map((days) => [`${days}D`, {
    provider_id: "MONEYDJ",
    provider_name: "MoneyDJ",
    window_days: days,
    status: days === 120 ? "PENDING" : "READY",
    source_date: days === 120 ? "2026-09-03" : "2026-09-04",
    source_date_verified: days !== 120,
    source_range_verified: days !== 120,
    top_net_buyers: days === 120 ? [] : [{ broker_branch: `BUY-${days}`, net_lots: days }],
    top_net_sellers: days === 120 ? [] : [{ broker_branch: `SELL-${days}`, net_lots: -days }],
    error: days === 120 ? "source_date_mismatch" : null,
  }])) as Record<string, any>,
};

const rows = buildFamilyBrokerWindowRenderRows({
  requested_windows: requested,
  broker,
});

assert.deepEqual(rows.map((row) => row.window_days), [...requested]);
assert.equal(rows.length, requested.length, "every requested broker window must have one render row");
assert.ok(rows.every((row) => row.must_render === true));
assert.equal(rows.find((row) => row.window_days === 60)?.status, "READY");
assert.equal(rows.find((row) => row.window_days === 120)?.status, "PENDING");
assert.equal(rows.find((row) => row.window_days === 120)?.source_date, "2026-09-03");
assert.equal(rows.find((row) => row.window_days === 120)?.error, "source_date_mismatch");
assert.equal(rows.find((row) => row.window_days === 120)?.top_net_buyers.length, 0);
assert.equal(rows.find((row) => row.window_days === 120)?.top_net_sellers.length, 0);

console.log("family broker render completeness contract passed");
