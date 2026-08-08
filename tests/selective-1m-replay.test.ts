import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DeterministicBacktestResult, FrozenDatasetManifest } from "../src/v6/deterministic-backtester.ts";
import { resolveAmbiguousBacktestWith1m, SelectiveReplayError } from "../src/v6/selective-1m-replay.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });

const COLUMNS=["symbol","bar_time_tw","ts_ms","open","high","low","close","volume","source","updated_at_ms","trade_date","updated_at","ingest_id","export_batch","export_status"] as const;
const BUCKET=1783991100000;

function stable(value:unknown):unknown{if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object"){const out:Record<string,unknown>={};for(const k of Object.keys(value as Record<string,unknown>).sort())out[k]=stable((value as Record<string,unknown>)[k]);return out;}return value===undefined?null:value;}
async function hash(value:unknown){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(stable(value))));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");}
function bar(i:number, high:number, low:number){const ts=BUCKET+i*60_000;return {symbol:"2330",bar_time_tw:`2026-07-14 09:${String(5+i).padStart(2,"0")}:00+08:00`,ts_ms:String(ts),open:"100",high:String(high),low:String(low),close:"100",volume:"100",source:"fugle_intraday_1m",updated_at_ms:"1784017000000",trade_date:"2026-07-14",updated_at:"2026-07-14T08:00:00.000Z",ingest_id:`2330|${ts}`,export_batch:"b1",export_status:"verified"};}
async function dataset(rows:ReturnType<typeof bar>[]):Promise<FrozenDatasetManifest>{const sourceFiles=[{path:"data/OHLC/tw/1m/2026/07/14/2330.csv",sha:"a".repeat(40),trade_date:"2026-07-14"}];const canonicalFiles=sourceFiles.map(f=>({path:f.path,sha:f.sha,trade_date:f.trade_date,year:null}));const first=String(Number(rows[0].ts_ms)),last=String(Number(rows.at(-1)!.ts_ms));const rowsCanon=rows.map(r=>COLUMNS.map(k=>String(r[k])));const h=await hash({schema_version:"ohlc-dataset/v1",market:"tw-stock",symbol:"2330",timeframe:"1m",source:"github_historical",columns:[...COLUMNS],source_files:canonicalFiles,scope:{first,last,row_count:rows.length},rows:rowsCanon});return {schema_version:"ohlc-dataset/v1",dataset_id:`tw-stock:2330:1m:${first}:${last}:${rows.length}`,dataset_version:`sha256:${h}`,dataset_hash:h,frozen_view:true,complete_view:true,truncated:false,formal_research_eligible:true,row_count:rows.length,total_validated_rows:rows.length,source:"github_historical",source_files:sourceFiles,provenance:{market:"tw-stock",symbol:"2330",timeframe:"1m",source:"github_historical"}};}
function original():DeterministicBacktestResult{return {schema_version:"diamond-backtest-result/v1",engine_version:"diamond-intraday-5m/v1.0.0",backtest_run_id:"bt:"+"b".repeat(64),deterministic:true,status:"OK",dataset_id:"d5",dataset_version:"sha256:"+"c".repeat(64),dataset_hash:"c".repeat(64),signal_id:"sig1",signal_version:"v1",symbol:"2330",side:"LONG",strategy:"golden",event:null,signal_ts_ms:BUCKET-60_000,parameter_version:"sha256:"+"d".repeat(64),parameter_hash:"d".repeat(64),parameters:{parameter_schema_version:"intraday-5m-parameters/v1",entry_rule:"NEXT_BAR_OPEN",stop_atr:1,target_atr:1.5,max_bars:12,cost_rate_round_trip:0.0004,tie_break:"STOP_FIRST",end_of_day_exit:true},atr:1,entry_ts_ms:BUCKET,entry_bar_time_tw:"2026-07-14 09:05:00+08:00",entry_price:100,stop_price:99,target_price:101.5,exit_ts_ms:BUCKET,exit_bar_time_tw:"2026-07-14 09:05:00+08:00",exit_price:99,exit_reason:"STOP",bars_held:1,gross_return_pct:-1,cost_pct:0.04,net_return_pct:-1.04,mfe_pct:2,mae_pct:-2,mfe_r:2,mae_r:-2,ambiguous_intrabar:true,intrabar_status:"AMBIGUOUS_INTRABAR",conservative_resolution:"STOP_FIRST",requires_1m_replay:true,provenance:{dataset_id:"d5",dataset_version:"sha256:"+"c".repeat(64),dataset_hash:"c".repeat(64),signal_id:"sig1",signal_version:"v1",parameter_version:"sha256:"+"d".repeat(64),engine_version:"diamond-intraday-5m/v1.0.0"}};}

// Target occurs first in chronological 1m sequence.
{
 const rows=[bar(0,101.6,99.2),bar(1,100.5,98.8)]; const ds=await dataset(rows); const a=await resolveAmbiguousBacktestWith1m({original_5m_result:original(),dataset_1m:ds,bars_1m:rows}); const b=await resolveAmbiguousBacktestWith1m({original_5m_result:original(),dataset_1m:ds,bars_1m:rows});
 assert.deepEqual(a,b); assert.equal(a.resolution_1m,"TARGET"); assert.equal(a.resolved_exit_reason,"TARGET"); assert.equal(a.resolved_net_return_pct,1.46); assert.equal(a.original_5m.conservative_exit_reason,"STOP"); assert.equal(a.original_5m.preserved,true); assert.equal(a.still_ambiguous_at_1m,false); assert.match(a.replay_run_id,/^replay1m:[0-9a-f]{64}$/);
}
// Stop occurs first.
{
 const rows=[bar(0,101.0,98.8),bar(1,101.6,99.5)]; const ds=await dataset(rows); const r=await resolveAmbiguousBacktestWith1m({original_5m_result:original(),dataset_1m:ds,bars_1m:rows}); assert.equal(r.resolution_1m,"STOP"); assert.equal(r.resolved_net_return_pct,-1.04);
}
// Same 1m touches both: cannot infer sub-minute ordering; keep conservative stop.
{
 const rows=[bar(0,102,98)]; const ds=await dataset(rows); const r=await resolveAmbiguousBacktestWith1m({original_5m_result:original(),dataset_1m:ds,bars_1m:rows}); assert.equal(r.resolution_1m,"AMBIGUOUS_1M"); assert.equal(r.still_ambiguous_at_1m,true); assert.equal(r.conservative_if_still_ambiguous,"STOP_FIRST"); assert.equal(r.resolved_exit_reason,"STOP");
}
// A 5m ambiguity that cannot be reproduced from 1m is a data/replay inconsistency, not a win/loss.
{
 const rows=[bar(0,101.0,99.2),bar(1,101.2,99.1)]; const ds=await dataset(rows); await assert.rejects(resolveAmbiguousBacktestWith1m({original_5m_result:original(),dataset_1m:ds,bars_1m:rows}),(e:unknown)=>e instanceof SelectiveReplayError&&e.code==="REPLAY_INCONSISTENT_WITH_5M");
}
// Tampered bars cannot reuse a frozen dataset version.
{
 const rows=[bar(0,101.6,99.2)]; const ds=await dataset(rows); const tampered=rows.map(r=>({...r,close:"100.1"})); await assert.rejects(resolveAmbiguousBacktestWith1m({original_5m_result:original(),dataset_1m:ds,bars_1m:tampered}),(e:unknown)=>e instanceof SelectiveReplayError&&e.code==="DATASET_VERSION_MISMATCH");
}
// Replay is selective only.
{
 const rows=[bar(0,101.6,99.2)]; const ds=await dataset(rows); const noReplay={...original(),ambiguous_intrabar:false,requires_1m_replay:false,intrabar_status:"RESOLVED_5M" as const,conservative_resolution:null}; await assert.rejects(resolveAmbiguousBacktestWith1m({original_5m_result:noReplay,dataset_1m:ds,bars_1m:rows}),(e:unknown)=>e instanceof SelectiveReplayError&&e.code==="REPLAY_NOT_REQUIRED");
}
// Pure layer must not fetch or read runtime time.
{
 const src=await readFile(new URL("../src/v6/selective-1m-replay.ts",import.meta.url),"utf8"); assert.doesNotMatch(src,/\bfetch\s*\(/); assert.doesNotMatch(src,/Date\.now\s*\(|new Date\s*\(/); assert.match(src,/bucketEnd = bucketStart \+ 5 \* 60_000/); assert.match(src,/preserved: true/);
}
console.log("P6 selective 1m replay golden/regression tests passed.");
