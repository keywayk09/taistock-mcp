import assert from "node:assert/strict";
import { readFormalBlindOhlc } from "../src/v6/formal-blind-ohlc-reader.ts";

const HEADER = "symbol,bar_time_tw,ts_ms,open,high,low,close,volume,source,updated_at_ms,trade_date,updated_at,ingest_id,export_batch,export_status";
const symbol = "2426";
const date = "2026-08-27";
const path = `data/OHLC/tw/1m/2026/08/27/${symbol}.csv`;
const ts = (hhmm: string) => Date.parse(`${date}T${hhmm}:00+08:00`);
const row = (hhmm: string, price: number) => [symbol, `${date} ${hhmm}:00`, ts(hhmm), price, price + 1, price - 1, price + 0.5, 1000, "fixture", ts(hhmm) + 1000, date, `${date} 14:00:00`, `${symbol}|${ts(hhmm)}`, "", ""].join(",");
const csv = [HEADER, row("09:00",100), row("09:01",101), row("09:02",102), row("09:03",103), row("09:04",104), ""].join("\n");
const env = {
  GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
  GITHUB_DATA_BRANCH: "main",
  __GITHUB_DATA_MEMORY: new Map([[path, { sha: "fixture-source-sha", text: csv }]]),
} as any;
const input = { symbol, trade_date: date, timeframe: "1m" as const, decision_time: "09:03", limit: 300 };

const goodFetch = async () => new Response(JSON.stringify({
  ok:true,
  formal_blind_eligible:true,
  symbol,
  timeframe:"1m",
  trade_date:date,
  decision_time:"09:03:00",
  cutoff:{ leakage_validated:true, prefix_completeness:true },
  verification:{ accepted_for_research:true, level:"official_day_verified" },
  dataset_hash:"canonical-proof-hash"
}), { status:200, headers:{ "content-type":"application/json" } });

const pass = await readFormalBlindOhlc(env, input, goodFetch as any);
assert.equal(pass.ok, true);
assert.equal(pass.formal_blind_eligible, true);
assert.equal(pass.formal_research_eligible, true);
assert.equal(pass.scorecard_eligible, true);
assert.equal(pass.research_disposition, "TRADABLE_VERIFIED");
assert.equal(pass.research_sample_resolved, true);
assert.equal(pass.sample_accounted, true);
assert.equal(pass.tradable, true);
assert.equal(pass.retryable_transport_error, false);
assert.equal(pass.rows.length, 3);
assert.deepEqual(pass.rows.map((x:any) => x.bar_time_tw), [
  `${date} 09:00:00`, `${date} 09:01:00`, `${date} 09:02:00`
]);
assert.equal(pass.canonical_verification_receipt.formal_blind_eligible, true);

// VERIFIED_NO_TRADE must resolve before any local OHLC file read. The frozen
// member remains accounted, but is never tradable or scorecard eligible.
const noTradeInput = { symbol: "5371", trade_date: "2026-09-03", timeframe: "5m" as const, decision_time: "09:35", limit: 300 };
const noTradeEnv = {
  GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
  GITHUB_DATA_BRANCH: "main",
  __GITHUB_DATA_MEMORY: new Map(),
} as any;
const noTradeFetch = async () => new Response(JSON.stringify({
  ok:true,
  symbol:"5371",
  timeframe:"5m",
  trade_date:"2026-09-03",
  decision_time:"09:35:00",
  data_status:"NO_TRADE_CONFIRMED",
  research_disposition:"NO_TRADE_CONFIRMED",
  research_sample_resolved:true,
  sample_accounted:true,
  tradable:false,
  formal_blind_eligible:false,
  cutoff:{ leakage_validated:true, prefix_completeness:false, no_trade:true },
  verification:{
    accepted_for_research:true,
    official_verified:true,
    runtime_official_fetch:false,
    verification_mode:"github_immutable_no_trade_receipt"
  },
  eligibility_reason:"OFFICIAL_NO_TRADE_CONFIRMED"
}), { status:200, headers:{ "content-type":"application/json" } });
const noTrade = await readFormalBlindOhlc(noTradeEnv, noTradeInput, noTradeFetch as any);
assert.equal(noTrade.ok, true);
assert.equal(noTrade.blocked, false);
assert.equal(noTrade.data_status, "NO_TRADE_CONFIRMED");
assert.equal(noTrade.research_disposition, "NO_TRADE_CONFIRMED");
assert.equal(noTrade.research_sample_resolved, true);
assert.equal(noTrade.sample_accounted, true);
assert.equal(noTrade.tradable, false);
assert.equal(noTrade.formal_blind_eligible, false);
assert.equal(noTrade.formal_research_eligible, false);
assert.equal(noTrade.scorecard_eligible, false);
assert.equal(noTrade.eligibility_reason, "OFFICIAL_NO_TRADE_CONFIRMED");
assert.equal(noTrade.returned, 0);
assert.deepEqual(noTrade.rows, []);
assert.equal(noTrade.retryable_transport_error, false);

// Semantic verification rejection stays fail-closed and must not be advertised
// as retryable transport.
const rejectFetch = async () => new Response(JSON.stringify({
  ok:true,
  formal_blind_eligible:false,
  symbol,
  timeframe:"1m",
  trade_date:date,
  decision_time:"09:03:00",
  cutoff:{ leakage_validated:true, prefix_completeness:true },
  verification:{ accepted_for_research:false },
  eligibility_reason:"OFFICIAL_NOT_VERIFIED"
}), { status:200, headers:{ "content-type":"application/json" } });
const rejected = await readFormalBlindOhlc(env, input, rejectFetch as any);
assert.equal(rejected.formal_blind_eligible, false);
assert.equal(rejected.scorecard_eligible, false);
assert.equal(rejected.eligibility_reason, "OFFICIAL_NOT_VERIFIED");
assert.notEqual(rejected.retryable_transport_error, true);

const mismatchFetch = async () => new Response(JSON.stringify({
  ok:true,
  formal_blind_eligible:true,
  symbol:"9999",
  timeframe:"1m",
  trade_date:date,
  decision_time:"09:03:00",
  cutoff:{ leakage_validated:true, prefix_completeness:true },
  verification:{ accepted_for_research:true }
}), { status:200, headers:{ "content-type":"application/json" } });
const mismatch = await readFormalBlindOhlc(env, input, mismatchFetch as any);
assert.equal(mismatch.formal_blind_eligible, false);
assert.equal(mismatch.scorecard_eligible, false);
assert.notEqual(mismatch.retryable_transport_error, true);

// Verification 503 is an availability/transport failure, not evidence that the
// immutable receipt is semantically ineligible. It remains blocked for this
// attempt but is explicitly safe for bounded same-input retry.
const httpFail = await readFormalBlindOhlc(env, input, (async () => new Response("down", { status:503 })) as any);
assert.equal(httpFail.formal_blind_eligible, false);
assert.equal(httpFail.scorecard_eligible, false);
assert.equal(httpFail.retryable_transport_error, true);
assert.equal(httpFail.transport_error_class, "TRANSIENT_TRANSPORT");
assert.equal(httpFail.eligibility_reason, "CANONICAL_VERIFICATION_HTTP_503");

// A non-transient client/contract HTTP failure is not retryable.
const badRequest = await readFormalBlindOhlc(env, input, (async () => new Response("bad", { status:404 })) as any);
assert.equal(badRequest.formal_blind_eligible, false);
assert.notEqual(badRequest.retryable_transport_error, true);
assert.equal(badRequest.eligibility_reason, "CANONICAL_VERIFICATION_HTTP_404");

// Network exception is retryable, while still returning no formal eligibility.
const networkFail = await readFormalBlindOhlc(env, input, (async () => { throw new Error("fetch failed: ECONNRESET"); }) as any);
assert.equal(networkFail.formal_blind_eligible, false);
assert.equal(networkFail.retryable_transport_error, true);
assert.equal(networkFail.transport_error_class, "TRANSIENT_TRANSPORT");

console.log("formal-blind-ohlc-reader: PASS");
