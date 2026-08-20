import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT,
  buildStockTxfContext,
  resolveTxfReviewWith1m,
  runTxfBatchReview5m,
  runTxfReview5m,
  type TxfBar,
  type TxfDataset,
} from "../src/v6/txf-review-engine.ts";

const columns=["trade_date","bar_time_tw","ts_ms","symbol","contract_symbol","settlement_date","session","timeframe","open","high","low","close","volume","average","source","source_version","verification","ingest_id"];
function stableValue(value:any):any{if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==="object"){const out:any={};for(const k of Object.keys(value).sort())out[k]=stableValue(value[k]);return out;}if(value===undefined)return null;return value;}
async function hash(value:any){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(stableValue(value))));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");}
const baseTs=Date.parse("2026-08-07T00:45:00Z"); // 08:45 Taipei
function bar(min:number,o:number,h:number,l:number,c:number,tf:"5m"|"1m"="5m"):TxfBar{
  const ts=baseTs+min*60000;
  return {trade_date:"2026-08-07",bar_time_tw:new Date(ts+8*3600000).toISOString().replace("Z","+08:00"),ts_ms:ts,symbol:"TXF",contract_symbol:"TXFQ6",settlement_date:"2026-08-19",session:"REGULAR",timeframe:tf,open:o,high:h,low:l,close:c,volume:100,average:"",source:tf==="1m"?"fugle_futopt_intraday":"derived_from_txf_1m",source_version:"txf-forward-capture/v1.0.0",verification:tf==="1m"?"FUGLE_PROVIDER_CAPTURED":"DERIVED_FROM_CAPTURED_1M",ingest_id:`TXF|TXFQ6|REGULAR|${tf}|${ts}`};
}
async function dataset(bars:TxfBar[],tf:"5m"|"1m"):Promise<TxfDataset>{
  const source="github_historical_txf_forward_capture",source_files=[{path:`data/OHLC/tw/txf/${tf}/2026/08/07/TXF.csv`,sha:"abc",trade_date:"2026-08-07"}];
  const fingerprint={schema_version:"ohlc-dataset/v1",market:"txf",symbol:"TXF",timeframe:tf,source,columns,source_files,scope:{first:bars[0].ts_ms,last:bars.at(-1)!.ts_ms,row_count:bars.length},rows:bars.map(r=>columns.map(k=>(r as any)[k]??""))};
  const h=await hash(fingerprint);
  return {schema_version:"ohlc-dataset/v1",dataset_id:`txf:TXF:${tf}:2026-08-07:${bars.length}`,dataset_version:`sha256:${h}`,dataset_hash:h,frozen_view:true,complete_view:true,truncated:false,review_eligible:true,formal_research_eligible:false,row_count:bars.length,total_validated_rows:bars.length,source,source_files,provenance:{market:"txf",symbol:"TXF",timeframe:tf,source,review_eligible:true,formal_research_eligible:false}};
}
const signal={signal_id:"txf-s1",signal_version:"tv-txf/v1",logical_symbol:"TXF",trade_date:"2026-08-07",session:"REGULAR" as const,side:"LONG" as const,signal_ts_ms:baseTs,atr:10,strategy:"TXF-L1",stage:"FORMAL_LABEL"};

{
  const bars=[bar(0,100,102,99,101),bar(5,101,103,100,102),bar(10,102,118,101,116),bar(15,116,119,115,118)];
  const d=await dataset(bars,"5m");
  const r=await runTxfReview5m({dataset:d,bars,signal});
  assert.equal(r.entry_price,101); assert.equal(r.stop_price,91); assert.equal(r.target_price,116);
  assert.equal(r.exit_reason,"TARGET"); assert.equal(r.gross_points,15); assert.equal(r.gross_twd,3000);
  assert.equal(r.cost_model_complete,false); assert.equal(r.net_points,null); assert.equal(r.formal_research_result,false);
}

let ambiguous:any;
{
  const bars=[bar(0,100,102,99,101),bar(5,101,103,100,102),bar(10,102,118,89,100),bar(15,100,101,98,99)];
  const d=await dataset(bars,"5m");
  ambiguous=await runTxfReview5m({dataset:d,bars,signal,parameters:{all_in_round_trip_cost_twd:120,slippage_points_round_trip:2}});
  assert.equal(ambiguous.ambiguous_intrabar,true);assert.equal(ambiguous.exit_reason,"STOP");assert.equal(ambiguous.gross_points,-10);assert.equal(ambiguous.cost_model_complete,true);assert.equal(ambiguous.net_points,-12.6);
}

{
  const one=[
    bar(10,102,110,101,109,"1m"),bar(11,109,117,108,116,"1m"),bar(12,116,117,100,105,"1m"),bar(13,105,106,90,92,"1m"),bar(14,92,95,91,94,"1m"),
  ];
  const d=await dataset(one,"1m");
  const replay=await resolveTxfReviewWith1m({original_review:ambiguous,dataset:d,bars:one});
  assert.equal(replay.resolution,"TARGET");assert.equal(replay.original_5m_result_preserved,true);assert.equal(replay.original_review.exit_reason,"STOP");
}

{
  const winBars=[bar(0,100,102,99,101),bar(5,101,103,100,102),bar(10,102,118,101,116)];
  const lossBars=[bar(0,100,102,99,101),bar(5,101,103,100,102),bar(10,102,104,90,92)];
  const a=await dataset(winBars,"5m"),b=await dataset(lossBars,"5m");
  const batch=await runTxfBatchReview5m({cases:[{dataset:b,bars:lossBars,signal:{...signal,signal_id:"b"}},{dataset:a,bars:winBars,signal:{...signal,signal_id:"a"}}]});
  assert.equal(batch.summary.total,2);assert.equal(batch.summary.wins,1);assert.equal(batch.summary.losses,1);assert.equal(batch.results[0].signal_id,"a");
}

{
  const bars=[bar(0,100,102,99,101),bar(5,101,104,100,103),bar(10,103,106,102,105),bar(15,105,108,104,107)];
  const d=await dataset(bars,"5m");
  const ctx=await buildStockTxfContext({dataset:d,bars,stock_signal:{symbol:"2330",signal_id:"stk-1",signal_version:"v1",signal_ts_ms:baseTs+15*60000,trade_date:"2026-08-07"}});
  assert.equal(ctx.no_lookahead,true);assert.equal(ctx.txf.asof_ts_ms,baseTs+15*60000);assert.equal(ctx.txf.session_return_points,7);assert.equal(ctx.txf.trend_3bar,"UP");
}

assert.equal(TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT,200);
const engineSource=fs.readFileSync(new URL("../src/v6/txf-review-engine.ts",import.meta.url),"utf8");
assert.doesNotMatch(engineSource,/fetch\(|Fugle|read_ohlc|read_txf_ohlc/);
assert.doesNotMatch(engineSource,/0\.0004|cost_rate_round_trip/);
assert.match(engineSource,/formal_research_result:false/);
assert.match(engineSource,/original_5m_result_preserved:true/);
const ledgerSource=fs.readFileSync(new URL("../src/v6/txf-signal-ledger.ts",import.meta.url),"utf8");
assert.match(ledgerSource,/research\/txf-signal-ledger/);assert.match(ledgerSource,/GITHUB_ONLY/);assert.doesNotMatch(ledgerSource,/D1Database|RESEARCH_DB|taipeiDateFromEpoch|TRADE_DATE_MISMATCH/);
const capabilitySource=fs.readFileSync(new URL("../src/v6/diamond-capability-p14.ts",import.meta.url),"utf8");
assert.match(capabilitySource,/read_txf_ohlc/);assert.match(capabilitySource,/txf_stock_cost_profile_reuse:\"FORBIDDEN\"/);assert.match(capabilitySource,/build_stock_txf_context/);
console.log("P14 TXF signal/review/replay/context regression passed");
