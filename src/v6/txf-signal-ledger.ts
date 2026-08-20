import { GitHubDataStoreError, listIndexedRecords, putIndexedImmutableRecord, readIndexedRecord } from "./github-data-store.ts";

export const TXF_SIGNAL_LEDGER_SCHEMA_VERSION = "txf-signal-ledger/v2-github";

export type TxfSession = "REGULAR" | "AFTERHOURS";
export type TxfSide = "LONG" | "SHORT" | "NEUTRAL";

export type RecordTxfSignalInput = {
  signal_id: string;
  signal_version: string;
  contract_symbol?: string | null;
  trade_date: string;
  session: TxfSession;
  timeframe: "5m";
  side: TxfSide;
  strategy: string;
  stage: string;
  signal_ts_ms: number;
  knowledge_cutoff_ts_ms: number;
  data_watermark_ts_ms: number;
  price?: number | null;
  atr?: number | null;
  source: string;
  reason_codes?: string[];
  payload?: Record<string, unknown>;
};

export class TxfSignalLedgerError extends Error {
  readonly code:string;
  readonly detail?:Record<string, unknown>;
  constructor(code:string,message:string,detail?:Record<string,unknown>) {
    super(message); this.name="TxfSignalLedgerError"; this.code=code; this.detail=detail;
  }
}

function text(value:unknown, field:string, max=300) {
  const out=String(value??"").trim();
  if (!out || out.length>max) throw new TxfSignalLedgerError("INVALID_INPUT",`${field} is required and must be <= ${max} chars`);
  return out;
}
function date(value:unknown) {
  const out=text(value,"trade_date",10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out) || Number.isNaN(Date.parse(`${out}T00:00:00Z`))) throw new TxfSignalLedgerError("INVALID_INPUT","trade_date must be YYYY-MM-DD");
  return out;
}
function positiveInt(value:unknown,field:string) {
  const n=Number(value); if(!Number.isSafeInteger(n)||n<=0) throw new TxfSignalLedgerError("INVALID_INPUT",`${field} must be a positive safe integer`); return n;
}
function finiteOptional(value:unknown,field:string,positive=false) {
  if(value===undefined||value===null||value==="") return null;
  const n=Number(value); if(!Number.isFinite(n)||(positive&&n<=0)) throw new TxfSignalLedgerError("INVALID_INPUT",`${field} must be ${positive?"> 0":"finite"}`); return n;
}
function contract(value:unknown) {
  if(value===undefined||value===null||value==="") return null;
  const out=String(value).trim().toUpperCase();
  if(!/^TXF[A-Z0-9]{2,12}$/.test(out)) throw new TxfSignalLedgerError("INVALID_INPUT","contract_symbol must be an actual TXF contract code when supplied");
  return out;
}
function stableValue(value:unknown):unknown {
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==="object") { const src=value as Record<string,unknown>, out:Record<string,unknown>={}; for(const k of Object.keys(src).sort()) out[k]=stableValue(src[k]); return out; }
  if(value===undefined) return null;
  if(typeof value==="number"&&!Number.isFinite(value)) return String(value);
  return value;
}
function stableJson(value:unknown){return JSON.stringify(stableValue(value));}
async function sha256(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");}

function wrapStore(error:unknown):never{if(error instanceof GitHubDataStoreError)throw new TxfSignalLedgerError(error.code,error.message,error.detail);throw error;}
export async function ensureTxfSignalLedgerSchema(_env:Env){ /* GitHub-only persistence; no DB schema. */ }

export async function recordTxfSignal(env:Env, raw:RecordTxfSignalInput){
  const signal_id=text(raw.signal_id,"signal_id",240),signal_version=text(raw.signal_version,"signal_version",160),contract_symbol=contract(raw.contract_symbol),trade_date=date(raw.trade_date),session=String(raw.session??"").toUpperCase() as TxfSession;
  if(!["REGULAR","AFTERHOURS"].includes(session)) throw new TxfSignalLedgerError("INVALID_INPUT","session must be REGULAR or AFTERHOURS");
  if(raw.timeframe!=="5m") throw new TxfSignalLedgerError("INVALID_INPUT","TXF review signal timeframe must be 5m");
  const side=String(raw.side??"").toUpperCase() as TxfSide;
  if(!["LONG","SHORT","NEUTRAL"].includes(side)) throw new TxfSignalLedgerError("INVALID_INPUT","side must be LONG, SHORT or NEUTRAL");
  const strategy=text(raw.strategy,"strategy",200),stage=text(raw.stage,"stage",120),source=text(raw.source,"source",200),signal_ts_ms=positiveInt(raw.signal_ts_ms,"signal_ts_ms"),knowledge_cutoff_ts_ms=positiveInt(raw.knowledge_cutoff_ts_ms,"knowledge_cutoff_ts_ms"),data_watermark_ts_ms=positiveInt(raw.data_watermark_ts_ms,"data_watermark_ts_ms");
  if(data_watermark_ts_ms>knowledge_cutoff_ts_ms||knowledge_cutoff_ts_ms>signal_ts_ms) throw new TxfSignalLedgerError("LOOKAHEAD_BIAS","required ordering is data_watermark <= knowledge_cutoff <= signal timestamp");
  const price=finiteOptional(raw.price,"price",true),atr=finiteOptional(raw.atr,"atr",true),reason_codes=Array.from(new Set((raw.reason_codes??[]).map(x=>text(x,"reason_code",120)))).sort(),payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:TXF_SIGNAL_LEDGER_SCHEMA_VERSION,signal_id,signal_version,logical_symbol:"TXF",contract_symbol,trade_date,session,timeframe:"5m",side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,reason_codes,payload};
  const content_hash=await sha256(stableJson(canonical)),ledger_id=`txfsig:${content_hash}`,recorded_at=new Date().toISOString(),record={...canonical,content_hash,ledger_id,recorded_at,storage:"GITHUB_ONLY"};
  try{const w=await putIndexedImmutableRecord(env,{collection:"research/txf-signal-ledger",key:`${signal_id}\u0000${signal_version}`,record,metadata:{signal_id,signal_version,trade_date,session,strategy,signal_ts_ms}});return{ok:true,immutable:true,idempotent:w.idempotent,ledger_id,signal_id,signal_version,content_hash,recorded_at,storage:"GITHUB_ONLY"};}catch(e){wrapStore(e);}
}
export async function getTxfSignal(env:Env,signalId:string,signalVersion:string){return await readIndexedRecord<any>(env,"research/txf-signal-ledger",`${text(signalId,"signal_id",240)}\u0000${text(signalVersion,"signal_version",160)}`);}
export async function listTxfSignals(env:Env,input:{trade_date?:string;session?:TxfSession;strategy?:string;limit?:number}={}){const tradeDate=input.trade_date?date(input.trade_date):undefined;let session:string|undefined;if(input.session){session=String(input.session).toUpperCase();if(!["REGULAR","AFTERHOURS"].includes(session))throw new TxfSignalLedgerError("INVALID_INPUT","invalid session");}const strategy=input.strategy?text(input.strategy,"strategy",200):undefined,limit=Math.max(1,Math.min(500,Math.floor(Number(input.limit??100))));const signals=await listIndexedRecords<any>(env,"research/txf-signal-ledger",e=>(!tradeDate||e.trade_date===tradeDate)&&(!session||e.session===session)&&(!strategy||e.strategy===strategy),limit);signals.sort((a,b)=>String(b.trade_date).localeCompare(String(a.trade_date))||Number(b.signal_ts_ms)-Number(a.signal_ts_ms));return{ok:true,count:signals.length,signals,storage:"GITHUB_ONLY"};}
