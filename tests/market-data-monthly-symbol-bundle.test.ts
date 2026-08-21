import assert from "node:assert/strict";
import {
  buildMonthlySymbolBundle,
  estimatePhysicalWriteAmplification,
  monthlySymbolBundleLogicalPath,
  monthlySymbolBundleSeries,
} from "../src/v6/market-data-monthly-symbol-bundle.ts";

const symbol = "3003";
const month = "2026-08";
const state = {
  institutional: [
    { trade_date: "2026-08-19", symbol, foreign_net_shares: -429415 },
    { trade_date: "2026-08-20", symbol, foreign_net_shares: -139923 },
  ],
  margin: [
    { trade_date: "2026-08-19", symbol, margin_balance_lots: 2299, short_balance_lots: 17 },
    { trade_date: "2026-08-20", symbol, margin_balance_lots: 2310, short_balance_lots: 17 },
  ],
  securities_lending: [
    { trade_date: "2026-08-19", symbol, balance_shares: 2372000 },
    { trade_date: "2026-08-20", symbol, balance_shares: 2362000 },
  ],
  sbl_short_sale: [
    { trade_date: "2026-08-19", symbol, sold_shares: 50000, balance_shares: 1731000 },
    { trade_date: "2026-08-20", symbol, sold_shares: 0, balance_shares: 1730000 },
  ],
};

const bundle = buildMonthlySymbolBundle({ month, symbol, state });
assert.equal(bundle.schema_version, "diamond-market-data-monthly-symbol-bundle/v1");
assert.equal(bundle.symbol, "3003");
assert.deepEqual(Object.keys(bundle.days), ["2026-08-19", "2026-08-20"]);
assert.equal((bundle.days["2026-08-20"].margin as any).margin_balance_lots, 2310);
assert.equal((bundle.days["2026-08-20"].securities_lending as any).balance_shares, 2362000);
assert.equal((bundle.days["2026-08-20"].sbl_short_sale as any).sold_shares, 0);
assert.equal(monthlySymbolBundleLogicalPath(month, symbol), "market-data/2026/08/3003.json");

const series = monthlySymbolBundleSeries(bundle);
assert.equal(series.institutional.length, 2);
assert.equal(series.margin.length, 2);
assert.equal(series.securities_lending.length, 2);
assert.equal(series.sbl_short_sale.length, 2);
assert.equal(series.institutional[1].trade_date, "2026-08-20");

assert.throws(
  () => buildMonthlySymbolBundle({
    month,
    symbol,
    state: { margin: [{ trade_date: "2026-07-31", symbol }] },
  }),
  /trade_date_outside_month/,
);
assert.throws(
  () => buildMonthlySymbolBundle({
    month,
    symbol,
    state: { margin: [{ trade_date: "2026-08-20", symbol: "2330" }] },
  }),
  /symbol_mismatch/,
);
assert.throws(
  () => buildMonthlySymbolBundle({
    month,
    symbol,
    state: { margin: [
      { trade_date: "2026-08-20", symbol },
      { trade_date: "2026-08-20", symbol },
    ] },
  }),
  /duplicate_kind_day/,
);

// Real 2026-08 canonical lower bound: institutional listed 1231 + OTC 810 = 2041 symbols/rows,
// while the index manifest has 70 prefixes. Physically writing one file per symbol every generation
// would therefore require at least ~29x more GitHub file writes than the prefix representation.
const amp = estimatePhysicalWriteAmplification({ symbolCount: 2041, prefixCount: 70 });
assert.equal(amp.symbol_files_per_generation, 2041);
assert.equal(amp.prefix_files_per_generation, 70);
assert.ok(amp.multiplier > 29);

console.log("PASS monthly symbol bundle: logical month/stock view; physical per-stock persistence rejected by write-amplification gate");
