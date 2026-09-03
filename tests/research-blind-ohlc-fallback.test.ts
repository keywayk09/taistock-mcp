import assert from "node:assert/strict";
import { readResearchBlindOhlcFallback } from "../src/v6/research-blind-ohlc-fallback.ts";

const HEADER_1M = "symbol,bar_time_tw,ts_ms,open,high,low,close,volume,source,updated_at_ms,trade_date,updated_at,ingest_id,export_batch,export_status";
const HEADER_5M_DERIVED = "symbol,bar_time_tw,ts_ms,open,high,low,close,volume,source,updated_at_ms,ema_5,ema_10,ema_20,rsi_14,macd,macd_signal,macd_hist,updated_at,day_volume_total,vol_slope,real_body_ratio,upper_wick_ratio,lower_wick_ratio,k_9,d_3,bb_mid_20,bb_upper_20_2,bb_lower_20_2,bb_width_20_2,bb_pct_b_20_2,indicator_schema_version";

function ts(date: string, hhmm: string) {
  return Date.parse(`${date}T${hhmm}:00+08:00`);
}

function row(symbol: string, date: string, hhmm: string, price = 100) {
  const t = ts(date, hhmm);
  return [
    symbol,
    `${date} ${hhmm}:00`,
    t,
    price,
    price + 1,
    price - 1,
    price + 0.5,
    1000,
    "test_canonical",
    t + 20_000_000,
    date,
    `${date} 14:00:00`,
    `${symbol}|${t}`,
    "",
    "",
  ].join(",");
}

function derived5mRow(symbol: string, date: string, hhmm: string, price = 100) {
  const t = ts(date, hhmm);
  return [
    symbol,
    `${date} ${hhmm}:00`,
    t,
    price,
    price + 1,
    price - 1,
    price + 0.5,
    1000,
    "derived_from_1m",
    t + 20_000_000,
    "", "", "", "", "", "", "",
    `${date} 14:00:00`,
    1000,
    "", "", "", "", "", "", "", "", "", "", "",
    2,
  ].join(",");
}

function memoryEnv(path: string, text: string) {
  return {
    GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
    GITHUB_DATA_BRANCH: "main",
    __GITHUB_DATA_MEMORY: new Map([[path, { sha: "fixture-source-sha", text }]]),
  } as any;
}

const symbol = "2426";
const date = "2026-08-27";
const path1m = `data/OHLC/tw/1m/2026/08/27/${symbol}.csv`;

// 09:03 cutoff: 09:00, 09:01, 09:02 are closed. 09:03 itself is still
// unfinished. Future 09:04/09:05 rows deliberately exist in the canonical file
// and must never escape the server-side response.
const oneMinuteCsv = [
  HEADER_1M,
  row(symbol, date, "09:00", 100),
  row(symbol, date, "09:01", 101),
  row(symbol, date, "09:02", 102),
  row(symbol, date, "09:03", 103),
  row(symbol, date, "09:04", 104),
  row(symbol, date, "09:05", 105),
  "",
].join("\n");

const pass1m = await readResearchBlindOhlcFallback(memoryEnv(path1m, oneMinuteCsv), {
  symbol,
  trade_date: date,
  timeframe: "1m",
  decision_time: "09:03",
  limit: 300,
});
assert.equal(pass1m.ok, true);
assert.equal(pass1m.blocked, false);
assert.equal(pass1m.leakage_validated, true);
assert.equal(pass1m.cutoff.expected_bar_count, 3);
assert.equal(pass1m.row_count, 3);
assert.equal(pass1m.returned, 3);
assert.deepEqual(pass1m.rows.map((x: any) => x.bar_time_tw), [
  `${date} 09:00:00`,
  `${date} 09:01:00`,
  `${date} 09:02:00`,
]);
assert.equal(Number(pass1m.cutoff.max_returned_close_ts_ms) <= Number(pass1m.cutoff.cutoff_ts_ms), true);
assert.equal(pass1m.cutoff.prefix_completeness_basis, "SPARSE_CANONICAL_EVENT_PREFIX");
assert.equal(pass1m.cutoff.sparse_clock_slots_allowed, true);
assert.equal(pass1m.formal_blind_eligible, false);
assert.equal(pass1m.formal_research_eligible, false);
assert.equal(pass1m.scorecard_eligible, false);
assert.equal(pass1m.eligibility_reason, "OHLC_OFFICIAL_VERIFICATION_RECEIPT_NOT_AVAILABLE_CROSS_ACCOUNT");

// A missing clock slot is not automatically missing data. TW minute bars are
// event based, so 09:01 can legitimately be absent when the stock did not trade.
// Structural validity and cutoff remain strict; immutable FORMAL verification is
// the separate authority that binds the canonical dataset/fingerprint.
const sparse1mCsv = [
  HEADER_1M,
  row(symbol, date, "09:00", 100),
  row(symbol, date, "09:02", 102),
  row(symbol, date, "09:03", 103),
  "",
].join("\n");
const sparse1m = await readResearchBlindOhlcFallback(memoryEnv(path1m, sparse1mCsv), {
  symbol,
  trade_date: date,
  timeframe: "1m",
  decision_time: "09:03",
});
assert.equal(sparse1m.ok, true);
assert.equal(sparse1m.blocked, false);
assert.equal(sparse1m.cutoff.prefix_completeness, true);
assert.equal(sparse1m.cutoff.missing_slot_count, 0);
assert.equal(sparse1m.row_count, 2);
assert.deepEqual(sparse1m.rows.map((x: any) => x.bar_time_tw), [
  `${date} 09:00:00`,
  `${date} 09:02:00`,
]);

// Duplicate canonical slots are corruption, not something the reader may silently dedupe.
const duplicateCsv = [
  HEADER_1M,
  row(symbol, date, "09:00", 100),
  row(symbol, date, "09:00", 100),
  row(symbol, date, "09:01", 101),
  row(symbol, date, "09:02", 102),
  "",
].join("\n");
const duplicate = await readResearchBlindOhlcFallback(memoryEnv(path1m, duplicateCsv), {
  symbol,
  trade_date: date,
  timeframe: "1m",
  decision_time: "09:03",
});
assert.equal(duplicate.ok, false);
assert.equal(duplicate.error, "CORRUPTED_PREFIX_SOURCE");
assert.equal(duplicate.duplicate_count, 1);
assert.deepEqual(duplicate.rows, []);

// Real derived 5m canonical schema does not contain a trade_date column. The
// date is already bound by the canonical path and bar_time_tw, so the blind
// reader must accept it without weakening cutoff or structural validation.
const path5m = `data/OHLC/tw/5m/2026/08/27/${symbol}.csv`;
const fiveMinuteCsv = [
  HEADER_5M_DERIVED,
  derived5mRow(symbol, date, "09:00", 100),
  derived5mRow(symbol, date, "09:05", 101),
  derived5mRow(symbol, date, "09:10", 102),
  derived5mRow(symbol, date, "09:15", 103),
  "",
].join("\n");
const pass5m = await readResearchBlindOhlcFallback(memoryEnv(path5m, fiveMinuteCsv), {
  symbol,
  trade_date: date,
  timeframe: "5m",
  decision_time: "09:12",
});
assert.equal(pass5m.ok, true);
assert.equal(pass5m.row_count, 2);
assert.deepEqual(pass5m.rows.map((x: any) => x.bar_time_tw), [
  `${date} 09:00:00`,
  `${date} 09:05:00`,
]);
assert.equal(pass5m.leakage_validated, true);
assert.equal(pass5m.formal_blind_eligible, false);

// Regression for sparse 6275-like trading. There are no 09:15/09:20 bars
// because there were no trades in those intervals. At decision_time=09:35 the
// 09:30 bar is closed and eligible; the 09:35 bar itself is still future/open.
const sparse5mCsv = [
  HEADER_5M_DERIVED,
  derived5mRow(symbol, date, "09:00", 100),
  derived5mRow(symbol, date, "09:05", 101),
  derived5mRow(symbol, date, "09:10", 102),
  derived5mRow(symbol, date, "09:25", 103),
  derived5mRow(symbol, date, "09:30", 104),
  derived5mRow(symbol, date, "09:35", 105),
  "",
].join("\n");
const sparse5m = await readResearchBlindOhlcFallback(memoryEnv(path5m, sparse5mCsv), {
  symbol,
  trade_date: date,
  timeframe: "5m",
  decision_time: "09:35",
});
assert.equal(sparse5m.ok, true);
assert.equal(sparse5m.blocked, false);
assert.equal(sparse5m.row_count, 5);
assert.deepEqual(sparse5m.rows.map((x: any) => x.bar_time_tw), [
  `${date} 09:00:00`,
  `${date} 09:05:00`,
  `${date} 09:10:00`,
  `${date} 09:25:00`,
  `${date} 09:30:00`,
]);
assert.equal(sparse5m.cutoff.prefix_completeness, true);
assert.equal(sparse5m.cutoff.prefix_completeness_basis, "SPARSE_CANONICAL_EVENT_PREFIX");

// A derived 5m row from another trade date must not be admitted merely because
// the file path was requested for this date.
const wrongDateCsv = [
  HEADER_5M_DERIVED,
  derived5mRow(symbol, "2026-08-26", "09:00", 100),
  derived5mRow(symbol, "2026-08-26", "09:05", 101),
  "",
].join("\n");
const wrongDate = await readResearchBlindOhlcFallback(memoryEnv(path5m, wrongDateCsv), {
  symbol,
  trade_date: date,
  timeframe: "5m",
  decision_time: "09:12",
});
assert.equal(wrongDate.ok, false);
assert.equal(wrongDate.error, "CANONICAL_OHLC_EMPTY");

console.log("research-blind-ohlc-fallback: PASS");
