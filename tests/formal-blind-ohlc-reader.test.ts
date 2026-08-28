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
assert.equal(pass.rows.length, 3);
assert.deepEqual(pass.rows.map((x:any) => x.bar_time_tw), [
  `${date} 09:00:00`, `${date} 09:01:00`, `${date} 09:02:00`
]);
assert.equal(pass.canonical_verification_receipt.formal_blind_eligible, true);

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

const httpFail = await readFormalBlindOhlc(env, input, (async () => new Response("down", { status:503 })) as any);
assert.equal(httpFail.formal_blind_eligible, false);
assert.equal(httpFail.scorecard_eligible, false);

console.log("formal-blind-ohlc-reader: PASS");
