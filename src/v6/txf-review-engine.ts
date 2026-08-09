export const TXF_REVIEW_ENGINE_VERSION = "diamond-txf-review/v1.0.0";
export const TXF_REVIEW_SCHEMA_VERSION = "diamond-txf-review-result/v1";
export const TXF_REPLAY_ENGINE_VERSION = "diamond-txf-selective-1m-replay/v1.0.0";
export const TXF_CONTEXT_ENGINE_VERSION = "diamond-stock-txf-context/v1.0.0";
export const TXF_DATASET_SCHEMA_VERSION = "ohlc-dataset/v1";
export const TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT = 200;
export const TXF_TICK_SIZE_POINTS = 1;

const TXF_COLUMNS = [
  "trade_date","bar_time_tw","ts_ms","symbol","contract_symbol","settlement_date","session","timeframe",
  "open","high","low","close","volume","average","source","source_version","verification","ingest_id",
] as const;

type Side = "LONG" | "SHORT";
export type TxfSession = "REGULAR" | "AFTERHOURS";

export type TxfBar = {
  trade_date:string;
  bar_time_tw:string;
  ts_ms:number|string;
  symbol:string;
  contract_symbol:string;
  settlement_date?:string;
  session:TxfSession|string;
  timeframe:"1m"|"5m"|"1d"|string;
  open:number|string; high:number|string; low:number|string; close:number|string; volume:number|string;
  [key:string]:unknown;
};

export type TxfDataset = {
  schema_version:string;
  dataset_id:string;
  dataset_version:string;
  dataset_hash:string;
  frozen_view:boolean;
  complete_view:boolean;
  truncated:boolean;
  review_eligible?:boolean;
  formal_research_eligible:boolean;
  row_count:number;
  total_validated_rows:number;
  source:string;
  source_files?:Array<{path?:string;sha?:string;trade_date?:string|null}>;
  provenance:{market:string;symbol:string;timeframe:string;review_eligible?:boolean;formal_research_eligible?:boolean;[key:string]:unknown};
};

export type TxfReviewSignal = {
  signal_id:string;
  signal_version:string;
  logical_symbol:"TXF"|string;
  contract_symbol?:string|null;
  trade_date:string;
  session:TxfSession;
  side:Side;
  signal_ts_ms:number;
  atr:number;
  strategy?:string|null;
  stage?:string|null;
};

export type TxfReviewParameters = {
  parameter_schema_version?:string;
  entry_rule?:"NEXT_BAR_OPEN";
  stop_atr?:number;
  target_atr?:number;
  max_bars?:number;
  tie_break?:"STOP_FIRST";
  contract_multiplier_twd_per_point?:number;
  tick_size_points?:number;
  all_in_round_trip_cost_twd?:number|null;
  slippage_points_round_trip?:number|null;
};

export const DEFAULT_TXF_REVIEW_PARAMETERS = Object.freeze({
  parameter_schema_version:"txf-review-parameters/v1",
  entry_rule:"NEXT_BAR_OPEN" as const,
  stop_atr:1,
  target_atr:1.5,
  max_bars:12,
  tie_break:"STOP_FIRST" as const,
  contract_multiplier_twd_per_point:TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT,
  tick_size_points:TXF_TICK_SIZE_POINTS,
  all_in_round_trip_cost_twd:null,
  slippage_points_round_trip:null,
});

export class TxfReviewError extends Error {
  readonly code:string; readonly detail?:Record<string,unknown>;
  constructor(code:string,message:string,detail?:Record<string,unknown>){super(message);this.name="TxfReviewError";this.code=code;this.detail=detail;}
}

function finite(value:unknown,field:string){const n=Number(value);if(!Number.isFinite(n))throw new TxfReviewError("INVALID_INPUT",`${field} must be finite`);return n;}
function positive(value:unknown,field:string){const n=finite(value,field);if(n<=0)throw new TxfReviewError("INVALID_INPUT",`${field} must be > 0`);return n;}
function nonNegativeOptional(value:unknown,field:string){if(value===undefined||value===null||value==="")return null;const n=finite(value,field);if(n<0)throw new TxfReviewError("INVALID_INPUT",`${field} must be >= 0`);return n;}
function round(value:number,digits=10){const f=10**digits;return Math.round((value+Number.EPSILON)*f)/f;}
function stableValue(value:unknown):unknown{if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==="object"){const src=value as Record<string,unknown>,out:Record<string,unknown>={};for(const k of Object.keys(src).sort())out[k]=stableValue(src[k]);return out;}if(value===undefined)return null;if(typeof value==="number"&&!Number.isFinite(value))return String(value);return value;}
function stableJson(value:unknown){return JSON.stringify(stableValue(value));}
async function sha256(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");}

function canonicalSourceFiles(files:TxfDataset["source_files"]){return (Array.isArray(files)?files:[]).map(f=>({path:String(f?.path??""),sha:String(f?.sha??""),trade_date:f?.trade_date?String(f.trade_date):null})).filter(f=>f.path||f.sha).sort((a,b)=>`${a.path}|${a.sha}`.localeCompare(`${b.path}|${b.sha}`));}
function canonicalRows(bars:TxfBar[]){return bars.map(row=>TXF_COLUMNS.map(k=>{const v=row[k];return v===undefined||v===null?"":(typeof v==="number"?(Number.isFinite(v)?v:String(v)):String(v));}));}

async function recomputeDatasetHash(dataset:TxfDataset,bars:TxfBar[]){
  const p=dataset.provenance??({} as TxfDataset["provenance"]);
  const fingerprint={
    schema_version:TXF_DATASET_SCHEMA_VERSION,market:"txf",symbol:"TXF",timeframe:String(p.timeframe??""),
    source:String(dataset.source??p.source??""),columns:[...TXF_COLUMNS],source_files:canonicalSourceFiles(dataset.source_files),
    scope:{first:bars[0]?.ts_ms??null,last:bars.at(-1)?.ts_ms??null,row_count:bars.length},rows:canonicalRows(bars)
  };
  return sha256(stableJson(fingerprint));
}

function normalizeParameters(input?:TxfReviewParameters):Required<Omit<TxfReviewParameters,"all_in_round_trip_cost_twd"|"slippage_points_round_trip">>&{all_in_round_trip_cost_twd:number|null;slippage_points_round_trip:number|null}{
  const p={...DEFAULT_TXF_REVIEW_PARAMETERS,...(input??{})};
  if(p.entry_rule!=="NEXT_BAR_OPEN")throw new TxfReviewError("INVALID_PARAMETERS","entry_rule must be NEXT_BAR_OPEN");
  if(p.tie_break!=="STOP_FIRST")throw new TxfReviewError("INVALID_PARAMETERS","tie_break must be STOP_FIRST");
  const maxBars=finite(p.max_bars,"max_bars");if(!Number.isInteger(maxBars)||maxBars<1||maxBars>200)throw new TxfReviewError("INVALID_PARAMETERS","max_bars must be integer 1..200");
  const multiplier=positive(p.contract_multiplier_twd_per_point,"contract_multiplier_twd_per_point");
  if(multiplier!==TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT)throw new TxfReviewError("INVALID_PARAMETERS","TXF contract multiplier is fixed at TWD 200 per point in this engine version");
  const tick=positive(p.tick_size_points,"tick_size_points");if(tick!==TXF_TICK_SIZE_POINTS)throw new TxfReviewError("INVALID_PARAMETERS","TXF tick size is fixed at 1 point in this engine version");
  return {parameter_schema_version:String(p.parameter_schema_version),entry_rule:"NEXT_BAR_OPEN",stop_atr:positive(p.stop_atr,"stop_atr"),target_atr:positive(p.target_atr,"target_atr"),max_bars:maxBars,tie_break:"STOP_FIRST",contract_multiplier_twd_per_point:multiplier,tick_size_points:tick,all_in_round_trip_cost_twd:nonNegativeOptional(p.all_in_round_trip_cost_twd,"all_in_round_trip_cost_twd"),slippage_points_round_trip:nonNegativeOptional(p.slippage_points_round_trip,"slippage_points_round_trip")};
}

async function validateDataset(dataset:TxfDataset,bars:TxfBar[],timeframe:"5m"|"1m",tradeDate?:string,session?:TxfSession){
  if(!dataset||typeof dataset!=="object")throw new TxfReviewError("INVALID_DATASET","dataset is required");
  if(dataset.schema_version!==TXF_DATASET_SCHEMA_VERSION)throw new TxfReviewError("INVALID_DATASET","unsupported dataset schema_version");
  if(!dataset.frozen_view||!dataset.complete_view||dataset.truncated)throw new TxfReviewError("DATASET_NOT_FROZEN_COMPLETE","TXF review requires exact frozen, complete, non-truncated dataset");
  if(dataset.review_eligible!==true&&dataset.provenance?.review_eligible!==true)throw new TxfReviewError("DATASET_NOT_REVIEW_ELIGIBLE","TXF dataset is not review_eligible");
  if(String(dataset.provenance?.market)!=="txf"||String(dataset.provenance?.symbol)!=="TXF"||String(dataset.provenance?.timeframe)!==timeframe)throw new TxfReviewError("INVALID_DATASET","TXF dataset provenance mismatch");
  if(!/^sha256:[0-9a-f]{64}$/.test(String(dataset.dataset_version??""))||!/^[0-9a-f]{64}$/.test(String(dataset.dataset_hash??""))||dataset.dataset_version!==`sha256:${dataset.dataset_hash}`)throw new TxfReviewError("INVALID_DATASET_VERSION","dataset_version/hash must be a valid SHA-256 pair");
  if(Number(dataset.row_count)!==bars.length||Number(dataset.total_validated_rows)!==bars.length)throw new TxfReviewError("DATASET_ROW_COUNT_MISMATCH","bars must be exact dataset view");
  if(!bars.length)throw new TxfReviewError("DATASET_EMPTY","TXF bars are empty");
  let prev=-Infinity; const seen=new Set<string>();
  for(let i=0;i<bars.length;i++){
    const b=bars[i]; const ts=finite(b.ts_ms,`bars[${i}].ts_ms`); const key=`${b.contract_symbol}|${b.session}|${ts}`;
    if(seen.has(key))throw new TxfReviewError("DUPLICATE_BAR","duplicate TXF bar",{key});seen.add(key);
    if(ts<=prev)throw new TxfReviewError("UNSORTED_BARS","TXF bars must be strictly chronological");prev=ts;
    if(String(b.symbol).toUpperCase()!=="TXF"||String(b.timeframe)!==timeframe)throw new TxfReviewError("BAR_SCHEMA_MISMATCH","TXF bar logical symbol/timeframe mismatch",{index:i});
    if(!/^TXF[A-Z0-9]{2,12}$/i.test(String(b.contract_symbol)))throw new TxfReviewError("BAR_SCHEMA_MISMATCH","TXF actual contract missing/invalid",{index:i});
    if(!["REGULAR","AFTERHOURS"].includes(String(b.session)))throw new TxfReviewError("BAR_SCHEMA_MISMATCH","TXF session invalid",{index:i});
    if(tradeDate&&String(b.trade_date)!==tradeDate)throw new TxfReviewError("TRADE_DATE_MISMATCH","dataset contains wrong TXF trading date",{index:i});
    if(session&&String(b.session)!==session)throw new TxfReviewError("SESSION_MISMATCH","dataset view must be filtered to the signal session",{index:i});
    const o=positive(b.open,`bars[${i}].open`),h=positive(b.high,`bars[${i}].high`),l=positive(b.low,`bars[${i}].low`),c=positive(b.close,`bars[${i}].close`),v=finite(b.volume,`bars[${i}].volume`);
    if(v<0||h<Math.max(o,l,c)||l>Math.min(o,h,c))throw new TxfReviewError("INVALID_OHLC","invalid TXF OHLCV",{index:i});
  }
  const hash=await recomputeDatasetHash(dataset,bars);if(hash!==dataset.dataset_hash)throw new TxfReviewError("DATASET_HASH_MISMATCH","TXF dataset rows/provenance do not reproduce dataset hash");
}

function direction(side:Side){return side==="LONG"?1:-1;}
function hit(bar:TxfBar,price:number,kind:"STOP"|"TARGET",side:Side){const h=Number(bar.high),l=Number(bar.low);if(side==="LONG")return kind==="STOP"?l<=price:h>=price;return kind==="STOP"?h>=price:l<=price;}
function points(side:Side,entry:number,exit:number){return round((exit-entry)*direction(side),6);}

export async function runTxfReview5m(input:{dataset:TxfDataset;bars:TxfBar[];signal:TxfReviewSignal;parameters?:TxfReviewParameters}){
  const s=input?.signal;if(!s)throw new TxfReviewError("INVALID_SIGNAL","signal is required");
  if(String(s.logical_symbol).toUpperCase()!=="TXF")throw new TxfReviewError("INVALID_SIGNAL","logical_symbol must be TXF");
  if(!["LONG","SHORT"].includes(String(s.side)))throw new TxfReviewError("INVALID_SIGNAL","review side must be LONG or SHORT");
  if(!["REGULAR","AFTERHOURS"].includes(String(s.session)))throw new TxfReviewError("INVALID_SIGNAL","invalid TXF session");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s.trade_date)))throw new TxfReviewError("INVALID_SIGNAL","trade_date must be YYYY-MM-DD");
  const atr=positive(s.atr,"signal.atr"), signalTs=positive(s.signal_ts_ms,"signal.signal_ts_ms");
  await validateDataset(input.dataset,input.bars,"5m",s.trade_date,s.session);
  const p=normalizeParameters(input.parameters);
  const bars=input.bars;
  const signalIndex=bars.findLastIndex(b=>Number(b.ts_ms)<=signalTs);
  if(signalIndex<0)throw new TxfReviewError("SIGNAL_BEFORE_DATASET","signal occurs before TXF dataset");
  const entryIndex=signalIndex+1;if(entryIndex>=bars.length)throw new TxfReviewError("NO_NEXT_BAR","no next TXF 5m bar after signal");
  const entryBar=bars[entryIndex];
  if(String(entryBar.trade_date)!==s.trade_date||String(entryBar.session)!==s.session)throw new TxfReviewError("NO_NEXT_BAR_IN_SESSION","next TXF bar is outside signal trading date/session");
  if(s.contract_symbol&&String(entryBar.contract_symbol).toUpperCase()!==String(s.contract_symbol).toUpperCase())throw new TxfReviewError("CONTRACT_MISMATCH","signal contract differs from evaluation contract");
  const contractSymbol=String(entryBar.contract_symbol).toUpperCase();
  const entry=positive(entryBar.open,"entry.open"),dir=direction(s.side as Side);
  const stop=round(entry-dir*p.stop_atr*atr,6),target=round(entry+dir*p.target_atr*atr,6);
  let maxFav=0,maxAdv=0,exitBar=entryBar,exit=entry,exitReason:"STOP"|"TARGET"|"MAX_BARS"|"SESSION_END"="MAX_BARS",ambiguous=false,barsHeld=0;
  const maxIndex=Math.min(bars.length-1,entryIndex+p.max_bars-1);
  for(let i=entryIndex;i<=maxIndex;i++){
    const b=bars[i];
    if(String(b.trade_date)!==s.trade_date||String(b.session)!==s.session||String(b.contract_symbol).toUpperCase()!==contractSymbol){exitBar=bars[Math.max(entryIndex,i-1)];exit=Number(exitBar.close);exitReason="SESSION_END";break;}
    barsHeld=i-entryIndex+1;
    const fav=s.side==="LONG"?Number(b.high)-entry:entry-Number(b.low); const adv=s.side==="LONG"?entry-Number(b.low):Number(b.high)-entry;
    maxFav=Math.max(maxFav,fav);maxAdv=Math.max(maxAdv,adv);
    const hs=hit(b,stop,"STOP",s.side as Side),ht=hit(b,target,"TARGET",s.side as Side);
    exitBar=b;
    if(hs&&ht){ambiguous=true;exit=stop;exitReason="STOP";break;}
    if(hs){exit=stop;exitReason="STOP";break;}
    if(ht){exit=target;exitReason="TARGET";break;}
    if(i===maxIndex){exit=Number(b.close);exitReason=i===bars.length-1?"SESSION_END":"MAX_BARS";}
  }
  const grossPoints=points(s.side as Side,entry,exit),grossTwd=round(grossPoints*p.contract_multiplier_twd_per_point,2);
  const costComplete=p.all_in_round_trip_cost_twd!==null&&p.slippage_points_round_trip!==null;
  const netPoints=costComplete?round(grossPoints-(p.slippage_points_round_trip??0)-(p.all_in_round_trip_cost_twd??0)/p.contract_multiplier_twd_per_point,6):null;
  const netTwd=netPoints===null?null:round(netPoints*p.contract_multiplier_twd_per_point,2);
  const parameterHash=await sha256(stableJson(p)); const parameterVersion=`sha256:${parameterHash}`;
  const identity={schema_version:TXF_REVIEW_SCHEMA_VERSION,engine_version:TXF_REVIEW_ENGINE_VERSION,dataset_version:input.dataset.dataset_version,signal_id:s.signal_id,signal_version:s.signal_version,parameters:p};
  const runHash=await sha256(stableJson(identity));
  return {
    schema_version:TXF_REVIEW_SCHEMA_VERSION,engine_version:TXF_REVIEW_ENGINE_VERSION,review_run_id:`txfreview:${runHash}`,deterministic:true,status:"OK" as const,
    market:"txf" as const,logical_symbol:"TXF" as const,contract_symbol:contractSymbol,trade_date:s.trade_date,session:s.session,side:s.side,
    signal_id:s.signal_id,signal_version:s.signal_version,strategy:s.strategy??null,stage:s.stage??null,signal_ts_ms:signalTs,atr,
    dataset_id:input.dataset.dataset_id,dataset_version:input.dataset.dataset_version,dataset_hash:input.dataset.dataset_hash,dataset_formal_research_eligible:input.dataset.formal_research_eligible,
    review_eligible:true,formal_research_result:false,production_promotion:"FORBIDDEN" as const,
    parameter_version:parameterVersion,parameter_hash:parameterHash,parameters:p,
    entry_ts_ms:Number(entryBar.ts_ms),entry_bar_time_tw:String(entryBar.bar_time_tw),entry_price:entry,stop_price:stop,target_price:target,
    exit_ts_ms:Number(exitBar.ts_ms),exit_bar_time_tw:String(exitBar.bar_time_tw),exit_price:exit,exit_reason:exitReason,bars_held:barsHeld,
    gross_points:grossPoints,gross_twd:grossTwd,cost_model_complete:costComplete,net_points:netPoints,net_twd:netTwd,
    mfe_points:round(maxFav,6),mae_points:round(maxAdv,6),mfe_r:round(maxFav/atr,6),mae_r:round(maxAdv/atr,6),
    ambiguous_intrabar:ambiguous,intrabar_status:ambiguous?"AMBIGUOUS_INTRABAR":"RESOLVED_5M",conservative_resolution:ambiguous?"STOP_FIRST":null,requires_1m_replay:ambiguous,
    provenance:{dataset_id:input.dataset.dataset_id,dataset_version:input.dataset.dataset_version,dataset_hash:input.dataset.dataset_hash,signal_id:s.signal_id,signal_version:s.signal_version,parameter_version:parameterVersion,engine_version:TXF_REVIEW_ENGINE_VERSION}
  };
}

export async function resolveTxfReviewWith1m(input:{original_review:Awaited<ReturnType<typeof runTxfReview5m>>;dataset:TxfDataset;bars:TxfBar[]}){
  const original=input?.original_review;if(!original||!original.requires_1m_replay||!original.ambiguous_intrabar)throw new TxfReviewError("NOT_SELECTIVE_REPLAY_CASE","TXF 1m replay only accepts ambiguous 5m review results");
  await validateDataset(input.dataset,input.bars,"1m",original.trade_date,original.session);
  const fiveStart=original.exit_ts_ms,fiveEnd=fiveStart+5*60*1000;
  const window=input.bars.filter(b=>Number(b.ts_ms)>=fiveStart&&Number(b.ts_ms)<fiveEnd&&String(b.contract_symbol).toUpperCase()===original.contract_symbol);
  if(!window.length)throw new TxfReviewError("REPLAY_DATA_NOT_FOUND","no TXF 1m bars in ambiguous 5m bucket");
  let resolution:"TARGET"|"STOP"|"AMBIGUOUS_1M"|"REPLAY_INCONSISTENT_WITH_5M"="REPLAY_INCONSISTENT_WITH_5M",resolutionTs:number|null=null;
  for(const b of window){const hs=hit(b,original.stop_price,"STOP",original.side),ht=hit(b,original.target_price,"TARGET",original.side);if(hs&&ht){resolution="AMBIGUOUS_1M";resolutionTs=Number(b.ts_ms);break;}if(hs){resolution="STOP";resolutionTs=Number(b.ts_ms);break;}if(ht){resolution="TARGET";resolutionTs=Number(b.ts_ms);break;}}
  const resolvedExit=resolution==="TARGET"?original.target_price:original.stop_price;
  const resolvedGross=resolution==="REPLAY_INCONSISTENT_WITH_5M"?null:points(original.side,original.entry_price,resolvedExit);
  const replayIdentity={engine_version:TXF_REPLAY_ENGINE_VERSION,original_review_run_id:original.review_run_id,dataset_version:input.dataset.dataset_version,resolution,resolution_ts_ms:resolutionTs};
  const hash=await sha256(stableJson(replayIdentity));
  return {schema_version:"diamond-txf-1m-replay-result/v1",engine_version:TXF_REPLAY_ENGINE_VERSION,replay_run_id:`txfreplay:${hash}`,deterministic:true,original_5m_result_preserved:true,original_review:original,dataset_id:input.dataset.dataset_id,dataset_version:input.dataset.dataset_version,dataset_hash:input.dataset.dataset_hash,resolution,resolution_ts_ms:resolutionTs,resolved_exit_price:resolution==="REPLAY_INCONSISTENT_WITH_5M"?null:resolvedExit,resolved_gross_points:resolvedGross,resolved_gross_twd:resolvedGross===null?null:round(resolvedGross*TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT,2),formal_research_result:false,production_promotion:"FORBIDDEN" as const};
}

function summarizeResults(results:Array<Awaited<ReturnType<typeof runTxfReview5m>>>) {
  const wins=results.filter(r=>r.gross_points>0),losses=results.filter(r=>r.gross_points<0),flat=results.length-wins.length-losses.length;
  const gp=wins.reduce((s,r)=>s+r.gross_points,0),gl=Math.abs(losses.reduce((s,r)=>s+r.gross_points,0));
  const netComplete=results.length>0&&results.every(r=>r.cost_model_complete&&r.net_points!==null);
  return {total:results.length,wins:wins.length,losses:losses.length,breakeven:flat,win_rate:results.length?round(wins.length/results.length,6):null,expectancy_points:results.length?round(results.reduce((s,r)=>s+r.gross_points,0)/results.length,6):null,profit_factor:gl>0?round(gp/gl,6):(gp>0?null:0),profit_factor_finite:gl>0,avg_mfe_r:results.length?round(results.reduce((s,r)=>s+r.mfe_r,0)/results.length,6):null,avg_mae_r:results.length?round(results.reduce((s,r)=>s+r.mae_r,0)/results.length,6):null,ambiguous_count:results.filter(r=>r.ambiguous_intrabar).length,ambiguous_rate:results.length?round(results.filter(r=>r.ambiguous_intrabar).length/results.length,6):null,net_costs_complete:netComplete,net_expectancy_points:netComplete?round(results.reduce((s,r)=>s+(r.net_points??0),0)/results.length,6):null};
}

export async function runTxfBatchReview5m(input:{cases:Array<{dataset:TxfDataset;bars:TxfBar[];signal:TxfReviewSignal;parameters?:TxfReviewParameters}>}){
  if(!Array.isArray(input?.cases)||!input.cases.length)throw new TxfReviewError("INVALID_INPUT","cases are required");
  if(input.cases.length>1000)throw new TxfReviewError("INVALID_INPUT","maximum 1000 TXF review cases per batch");
  const results=[] as Array<Awaited<ReturnType<typeof runTxfReview5m>>>; const ids=new Set<string>();
  for(const item of input.cases){const r=await runTxfReview5m(item);if(ids.has(r.review_run_id))throw new TxfReviewError("DUPLICATE_CASE","duplicate TXF review case",{review_run_id:r.review_run_id});ids.add(r.review_run_id);results.push(r);}
  results.sort((a,b)=>a.signal_ts_ms-b.signal_ts_ms||a.review_run_id.localeCompare(b.review_run_id));
  const batchHash=await sha256(stableJson({engine_version:TXF_REVIEW_ENGINE_VERSION,review_run_ids:results.map(r=>r.review_run_id)}));
  return {schema_version:"diamond-txf-review-batch/v1",engine_version:TXF_REVIEW_ENGINE_VERSION,batch_run_id:`txfbatch:${batchHash}`,deterministic:true,market:"txf",summary:summarizeResults(results),by_strategy:Object.fromEntries(Array.from(new Set(results.map(r=>r.strategy??"UNSPECIFIED"))).sort().map(strategy=>[strategy,summarizeResults(results.filter(r=>(r.strategy??"UNSPECIFIED")===strategy))])),replay_queue:results.filter(r=>r.requires_1m_replay).map(r=>({review_run_id:r.review_run_id,signal_id:r.signal_id,signal_version:r.signal_version,dataset_version:r.dataset_version,ambiguous_5m_ts_ms:r.exit_ts_ms})),results,formal_research_result:false,production_promotion:"FORBIDDEN" as const};
}

export async function buildStockTxfContext(input:{dataset:TxfDataset;bars:TxfBar[];stock_signal:{symbol:string;signal_id:string;signal_version:string;signal_ts_ms:number;trade_date:string};session?:TxfSession}){
  const session=input.session??"REGULAR"; await validateDataset(input.dataset,input.bars,"5m",input.stock_signal.trade_date,session);
  const signalTs=positive(input.stock_signal.signal_ts_ms,"stock_signal.signal_ts_ms");
  const eligible=input.bars.filter(b=>Number(b.ts_ms)<=signalTs&&String(b.session)===session);
  if(!eligible.length)throw new TxfReviewError("TXF_CONTEXT_NOT_AVAILABLE","no TXF bar available by stock signal time");
  const current=eligible.at(-1)!;const sessionOpen=Number(eligible[0].open),close=Number(current.close);
  const prev1=eligible.at(-2),prev3=eligible.at(-4);const window=eligible.slice(-12);const hi=Math.max(...window.map(b=>Number(b.high))),lo=Math.min(...window.map(b=>Number(b.low)));
  const one=prev1?close-Number(prev1.close):null,three=prev3?close-Number(prev3.close):null,sessionPts=close-sessionOpen;
  const trend=three===null?"INSUFFICIENT":three>0?"UP":three<0?"DOWN":"FLAT";
  const identity={engine_version:TXF_CONTEXT_ENGINE_VERSION,stock_signal_id:input.stock_signal.signal_id,stock_signal_version:input.stock_signal.signal_version,txf_dataset_version:input.dataset.dataset_version,txf_bar_ts_ms:Number(current.ts_ms),session};
  const hash=await sha256(stableJson(identity));
  return {schema_version:"diamond-stock-txf-context/v1",engine_version:TXF_CONTEXT_ENGINE_VERSION,context_id:`txfctx:${hash}`,deterministic:true,no_lookahead:true,stock_signal:{...input.stock_signal},txf:{dataset_id:input.dataset.dataset_id,dataset_version:input.dataset.dataset_version,dataset_hash:input.dataset.dataset_hash,contract_symbol:String(current.contract_symbol),session,asof_ts_ms:Number(current.ts_ms),close,session_open:sessionOpen,session_return_points:round(sessionPts,6),session_return_pct:round(sessionPts/sessionOpen,8),one_bar_return_points:one===null?null:round(one,6),three_bar_return_points:three===null?null:round(three,6),trend_3bar:trend,range_12_high:hi,range_12_low:lo,range_position_12:hi>lo?round((close-lo)/(hi-lo),6):null},formal_research_eligible:input.dataset.formal_research_eligible,usage:"MARKET_CONTEXT_ONLY",production_promotion:"FORBIDDEN" as const};
}
