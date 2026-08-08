import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BatchBacktestError,
  runDeterministicBatchBacktest5m,
  type BatchSignalRecord,
} from "../src/v6/batch-backtester.ts";
import type { FrozenDatasetManifest, Intraday5mBar } from "../src/v6/deterministic-backtester.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });

const COLUMNS = [
  "symbol", "bar_time_tw", "ts_ms", "open", "high", "low", "close", "volume",
  "source", "updated_at_ms", "ema_5", "ema_10", "ema_20", "rsi_14", "macd",
  "macd_signal", "macd_hist", "updated_at", "day_volume_total", "vol_slope",
  "real_body_ratio", "upper_wick_ratio", "lower_wick_ratio", "k_9", "d_3",
] as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = stableValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value === undefined ? null : value;
}

async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

const BASE = 1783990800000;
function bar(symbol: string, index: number, values: { open?: number; high?: number; low?: number; close?: number } = {}): Intraday5mBar {
  const open = values.open ?? 100;
  const high = values.high ?? 100.3;
  const low = values.low ?? 99.7;
  const close = values.close ?? 100;
  return {
    symbol,
    bar_time_tw: `2026-07-14 09:${String(index * 5).padStart(2, "0")}:00+08:00`,
    ts_ms: String(BASE + index * 300_000),
    open:String(open),high:String(high),low:String(low),close:String(close),volume:"1000",
    source:"fugle_intraday_5m",updated_at_ms:"1784017098832",ema_5:"100",ema_10:"100",ema_20:"100",rsi_14:"50",macd:"0",macd_signal:"0",macd_hist:"0",updated_at:"2026-07-14T08:00:00.000Z",day_volume_total:"1000",vol_slope:"0",real_body_ratio:"0.1",upper_wick_ratio:"0.1",lower_wick_ratio:"0.1",k_9:"50",d_3:"50",
  };
}

async function dataset(symbol: string, bars: Intraday5mBar[], suffix: string): Promise<FrozenDatasetManifest> {
  const sourceFiles = [{ path:`data/OHLC/tw/5m/2026/07/14/${symbol}.csv`,sha:suffix.repeat(40).slice(0,40),trade_date:"2026-07-14",year:null }];
  const canonicalFiles = sourceFiles.map((file) => ({ ...file })).sort((a,b)=>`${a.path}|${a.sha}`.localeCompare(`${b.path}|${b.sha}`));
  const rows = bars.map((row) => COLUMNS.map((key) => row[key] === undefined || row[key] === null ? "" : String(row[key])));
  const first=String(Number(bars[0].ts_ms)); const last=String(Number(bars.at(-1)!.ts_ms));
  const hash=await sha256Hex({schema_version:"ohlc-dataset/v1",market:"tw-stock",symbol,timeframe:"5m",source:"github_historical",columns:[...COLUMNS],source_files:canonicalFiles,scope:{first,last,row_count:bars.length},rows});
  return {schema_version:"ohlc-dataset/v1",dataset_id:`tw-stock:${symbol}:5m:${first}:${last}:${bars.length}`,dataset_version:`sha256:${hash}`,dataset_hash:hash,frozen_view:true,complete_view:true,truncated:false,formal_research_eligible:true,row_count:bars.length,total_validated_rows:bars.length,source:"github_historical",source_files:sourceFiles,provenance:{market:"tw-stock",symbol,timeframe:"5m",source:"github_historical"}};
}

function signal(id:string,symbol:string,side:"LONG"|"SHORT"): BatchSignalRecord {
  return {signal_id:id,signal_version:"v1",symbol,trade_date:"2026-07-14",timeframe:"5m",side,signal_ts_ms:BASE+60_000,atr:1,strategy:"golden",stage:"COMMITTED",event_refs:[]};
}

const longBars=[bar("2330",0),bar("2330",1,{open:100,high:101.7,low:99.5,close:101.5})];
const ambiguousBars=[bar("2317",0),bar("2317",1,{open:100,high:102,low:98,close:100})];
const longDataset=await dataset("2330",longBars,"a");
const ambiguousDataset=await dataset("2317",ambiguousBars,"b");
const datasets=[{dataset:longDataset,bars:longBars},{dataset:ambiguousDataset,bars:ambiguousBars}];
const cases=[
  {signal:signal("sig-b","2317","LONG"),evaluation_dataset_version:ambiguousDataset.dataset_version},
  {signal:signal("sig-a","2330","LONG"),evaluation_dataset_version:longDataset.dataset_version},
];

{
  const a=await runDeterministicBatchBacktest5m({datasets,cases});
  const b=await runDeterministicBatchBacktest5m({datasets:[...datasets].reverse(),cases:[...cases].reverse()});
  assert.equal(a.batch_run_id,b.batch_run_id,"input order must not drift deterministic batch identity");
  assert.deepEqual(a.results,b.results,"result order must be canonical");
  assert.equal(a.case_count,2);
  assert.equal(a.summary.total,2);
  assert.equal(a.summary.wins,1);
  assert.equal(a.summary.losses,1);
  assert.equal(a.summary.win_rate_pct,50);
  assert.equal(a.summary.ambiguous_intrabar_count,1);
  assert.equal(a.summary.requires_1m_replay_count,1);
  assert.equal(a.replay_queue.length,1);
  assert.equal(a.replay_queue[0].signal_id,"sig-b");
  assert.match(a.batch_run_id,/^btbatch:[0-9a-f]{64}$/);
}

{
  await assert.rejects(runDeterministicBatchBacktest5m({datasets,cases:[cases[0],cases[0]]}),
    (error:unknown)=>error instanceof BatchBacktestError&&error.code==="DUPLICATE_CASE");
}
{
  await assert.rejects(runDeterministicBatchBacktest5m({datasets:[datasets[0]],cases:[cases[1],{...cases[0],evaluation_dataset_version:"sha256:"+"c".repeat(64)}]}),
    (error:unknown)=>error instanceof BatchBacktestError&&error.code==="EVALUATION_DATASET_NOT_FOUND");
}
{
  const badSignal={...cases[1].signal,atr:null};
  await assert.rejects(runDeterministicBatchBacktest5m({datasets,cases:[{signal:badSignal,evaluation_dataset_version:longDataset.dataset_version}]}),
    (error:unknown)=>error instanceof BatchBacktestError&&error.code==="MISSING_SIGNAL_ATR");
}
{
  const source=await readFile(new URL("../src/v6/batch-backtester.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/\bfetch\s*\(/,"P5 compute layer must never fetch OHLC");
  assert.doesNotMatch(source,/Date\.now\s*\(|new Date\s*\(/,"P5 batch identity must not use current time");
  assert.match(source,/cases.*sort|sortedCases/);
  assert.match(source,/replay_queue/);
  assert.match(source,/profit_factor/);
}

console.log("P5 deterministic batch backtest regression tests passed.");
