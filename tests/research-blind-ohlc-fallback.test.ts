import assert from "node:assert/strict";
import { readResearchBlindOhlcFallback } from "../src/v6/research-blind-ohlc-fallback.ts";

const HEADER = "symbol,bar_time_tw,ts_ms,open,high,low,close,volume,source,updated_at_ms,trade_date,updated_at,ingest_id,export_batch,export_status";

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
  HEADER,
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
assert.equal(pass1m.formal_blind_eligible, false);
assert.equal(pass1m.formal_research_eligible, false);
assert.equal(pass1m.scorecard_eligible, false);
assert.equal(pass1m.eligibility_reason, "OHLC_OFFICIAL_VERIFICATION_RECEIPT_NOT_AVAILABLE_CROSS_ACCOUNT");

// Missing one already-closed prefix slot must fail closed and return no bars.
const missingCsv = [
  HEADER,
  row(symbol, date, "09:00", 100),
  row(symbol, date, "09:02", 102),
  row(symbol, date, "09:03", 103),
  "",
].join("\n");
const missing = await readResearchBlindOhlcFallback(memoryEnv(path1m, missingCsv), {
  symbol,
  trade_date: date,
  timeframe: "1m",
  decision_time: "09:03",
});
assert.equal(missing.ok, false);
assert.equal(missing.blocked, true);
assert.equal(missing.error, "CUTOFF_PREFIX_INCOMPLETE");
assert.equal(missing.missing_slot_count, 1);
assert.deepEqual(missing.missing_slots, ["09:01"]);
assert.deepEqual(missing.rows, []);
assert.equal(missing.formal_blind_eligible, false);

// Duplicate canonical slots are corruption, not something the reader may silently dedupe.
const duplicateCsv = [
  HEADER,
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

// 5m boundary: at 09:12 only 09:00 and 09:05 bars are closed; 09:10 closes at 09:15.
const path5m = `data/OHLC/tw/5m/2026/08/27/${symbol}.csv`;
const fiveMinuteCsv = [
  HEADER,
  row(symbol, date, "09:00", 100),
  row(symbol, date, "09:05", 101),
  row(symbol, date, "09:10", 102),
  row(symbol, date, "09:15", 103),
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

console.log("research-blind-ohlc-fallback: PASS");
