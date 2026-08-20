import {
  GitHubDataStoreError,
  listIndexedRecords,
  putIndexedImmutableRecord,
  readIndexedRecord,
  readCollectionIndex,
} from "./github-data-store.ts";

export const SIGNAL_EVENT_LEDGER_SCHEMA_VERSION = "signal-event-ledger/v2-github";

export type LedgerEventRef = { event_id: string; event_version: string };
export type RecordEventInput = {
  event_id: string; event_version: string; symbol?: string | null; event_type: string;
  event_ts_ms: number; available_ts_ms: number; source: string; title?: string | null;
  payload?: Record<string, unknown>;
};
export type RecordSignalInput = {
  signal_id: string; signal_version: string; symbol: string; trade_date: string; timeframe: string;
  side: "LONG" | "SHORT" | "NEUTRAL"; strategy: string; stage: string; signal_ts_ms: number;
  knowledge_cutoff_ts_ms: number; data_watermark_ts_ms: number; price?: number | null; atr?: number | null;
  source: string; dataset_id?: string | null; dataset_version?: string | null; dataset_hash?: string | null;
  event_refs?: LedgerEventRef[]; reason_codes?: string[]; payload?: Record<string, unknown>;
};

export class LedgerError extends Error {
  readonly code: string; readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) { super(message); this.name="LedgerError"; this.code=code; this.detail=detail; }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") { const s=value as Record<string,unknown>, o:Record<string,unknown>={}; for(const k of Object.keys(s).sort())o[k]=stableValue(s[k]); return o; }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}
function stableJson(value: unknown) { return JSON.stringify(stableValue(value)); }
async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");}
function requiredText(value:unknown,field:string,max=200){const t=String(value??"").trim();if(!t)throw new LedgerError("INVALID_INPUT",`${field} is required`);if(t.length>max)throw new LedgerError("INVALID_INPUT",`${field} is too long`);return t;}
function optionalSymbol(value:unknown){if(value===undefined||value===null||value==="")return null;const s=String(value).trim();if(!/^\d{4,6}$/.test(s))throw new LedgerError("INVALID_INPUT","symbol must be 4-6 digits");return s;}
function requiredSymbol(value:unknown){const s=optionalSymbol(value);if(!s)throw new LedgerError("INVALID_INPUT","symbol is required");return s;}
function positiveInteger(value:unknown,field:string){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new LedgerError("INVALID_INPUT",`${field} must be a positive safe integer`);return n;}
function optionalFinite(value:unknown,field:string,positive=false){if(value===undefined||value===null||value==="")return null;const n=Number(value);if(!Number.isFinite(n))throw new LedgerError("INVALID_INPUT",`${field} must be finite`);if(positive&&n<=0)throw new LedgerError("INVALID_INPUT",`${field} must be > 0`);return n;}
function taipeiDateFromEpoch(tsMs:number){return new Date(tsMs+8*60*60*1000).toISOString().slice(0,10);}
function normalizeTradeDate(value:unknown){const d=String(value??"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(d))throw new LedgerError("INVALID_INPUT","trade_date must be YYYY-MM-DD");return d;}
function canonicalEventRefs(refs:LedgerEventRef[]|undefined){const m=new Map<string,LedgerEventRef>();for(const r of refs??[]){const event_id=requiredText(r?.event_id,"event_refs.event_id",240),event_version=requiredText(r?.event_version,"event_refs.event_version",160);m.set(`${event_id}\u0000${event_version}`,{event_id,event_version});}return [...m.values()].sort((a,b)=>`${a.event_id}\u0000${a.event_version}`.localeCompare(`${b.event_id}\u0000${b.event_version}`));}
function canonicalReasonCodes(codes:string[]|undefined){return [...new Set((codes??[]).map(c=>requiredText(c,"reason_code",120)))].sort();}
function validateDatasetReference(input:RecordSignalInput){const values=[input.dataset_id,input.dataset_version,input.dataset_hash];const count=values.filter(v=>v!==undefined&&v!==null&&String(v).trim()!=="").length;if(count===0)return{dataset_id:null,dataset_version:null,dataset_hash:null};if(count!==3)throw new LedgerError("INVALID_DATASET_REFERENCE","dataset_id, dataset_version and dataset_hash must be supplied together");const dataset_id=requiredText(input.dataset_id,"dataset_id",500),dataset_version=requiredText(input.dataset_version,"dataset_version",80),dataset_hash=requiredText(input.dataset_hash,"dataset_hash",64);if(!/^sha256:[0-9a-f]{64}$/.test(dataset_version)||!/^[0-9a-f]{64}$/.test(dataset_hash)||dataset_version!==`sha256:${dataset_hash}`)throw new LedgerError("INVALID_DATASET_REFERENCE","dataset_version/hash must be the P2 SHA-256 pair");return{dataset_id,dataset_version,dataset_hash};}
function wrapStoreError(error:unknown):never{if(error instanceof GitHubDataStoreError)throw new LedgerError(error.code,error.message,error.detail);throw error;}

export async function ensureSignalEventLedgerSchema(_env:Env):Promise<void>{ /* GitHub JSON is schema-on-read; no database schema. */ }

export async function recordLedgerEvent(env:Env,raw:RecordEventInput){
  const event_id=requiredText(raw.event_id,"event_id",240),event_version=requiredText(raw.event_version,"event_version",160),symbol=optionalSymbol(raw.symbol),event_type=requiredText(raw.event_type,"event_type",120),event_ts_ms=positiveInteger(raw.event_ts_ms,"event_ts_ms"),available_ts_ms=positiveInteger(raw.available_ts_ms,"available_ts_ms");
  if(available_ts_ms<event_ts_ms)throw new LedgerError("INVALID_EVENT_TIME","available_ts_ms cannot be earlier than event_ts_ms",{event_ts_ms,available_ts_ms});
  const source=requiredText(raw.source,"source",160),title=raw.title==null?null:String(raw.title).trim().slice(0,1000),payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:SIGNAL_EVENT_LEDGER_SCHEMA_VERSION,event_id,event_version,symbol,event_type,event_ts_ms,available_ts_ms,source,title,payload};
  const content_hash=await sha256Hex(stableJson(canonical)),ledger_id=`evt:${content_hash}`,recorded_at=new Date().toISOString();
  const record={...canonical,ledger_id,content_hash,recorded_at,storage:"GITHUB_ONLY"};
  try{const w=await putIndexedImmutableRecord(env,{collection:"research/event-ledger",key:`${event_id}\u0000${event_version}`,record,metadata:{event_id,event_version,symbol,event_type,available_ts_ms,event_ts_ms}});return{ok:true,immutable:true,idempotent:w.idempotent,ledger_id,content_hash,event_id,event_version,recorded_at,storage:"GITHUB_ONLY"};}catch(e){wrapStoreError(e);}
}

async function getEventExact(env:Env,event_id:string,event_version:string){return await readIndexedRecord<any>(env,"research/event-ledger",`${event_id}\u0000${event_version}`);}
async function validateReferencedEvents(env:Env,refs:LedgerEventRef[],knowledgeCutoff:number){const resolved:Array<{event_id:string;event_version:string;available_ts_ms:number;ledger_id:string}>=[];for(const ref of refs){const row=await getEventExact(env,ref.event_id,ref.event_version);if(!row)throw new LedgerError("EVENT_REF_NOT_FOUND","referenced event is not present in immutable event ledger",ref);const available=Number(row.available_ts_ms);if(!Number.isSafeInteger(available)||available>knowledgeCutoff)throw new LedgerError("LOOKAHEAD_BIAS","referenced event was not available by signal knowledge cutoff",{...ref,event_available_ts_ms:row.available_ts_ms,knowledge_cutoff_ts_ms:knowledgeCutoff});resolved.push({event_id:ref.event_id,event_version:ref.event_version,available_ts_ms:available,ledger_id:String(row.ledger_id)});}return resolved;}

export async function recordSignalLedger(env:Env,raw:RecordSignalInput){
  const signal_id=requiredText(raw.signal_id,"signal_id",240),signal_version=requiredText(raw.signal_version,"signal_version",160),symbol=requiredSymbol(raw.symbol),trade_date=normalizeTradeDate(raw.trade_date),timeframe=requiredText(raw.timeframe,"timeframe",32),side=String(raw.side??"").toUpperCase();
  if(!["LONG","SHORT","NEUTRAL"].includes(side))throw new LedgerError("INVALID_INPUT","side must be LONG, SHORT or NEUTRAL");
  const strategy=requiredText(raw.strategy,"strategy",200),stage=requiredText(raw.stage,"stage",120),signal_ts_ms=positiveInteger(raw.signal_ts_ms,"signal_ts_ms"),knowledge_cutoff_ts_ms=positiveInteger(raw.knowledge_cutoff_ts_ms,"knowledge_cutoff_ts_ms"),data_watermark_ts_ms=positiveInteger(raw.data_watermark_ts_ms,"data_watermark_ts_ms");
  if(data_watermark_ts_ms>knowledge_cutoff_ts_ms||knowledge_cutoff_ts_ms>signal_ts_ms)throw new LedgerError("LOOKAHEAD_BIAS","required ordering is data_watermark <= knowledge_cutoff <= signal timestamp",{data_watermark_ts_ms,knowledge_cutoff_ts_ms,signal_ts_ms});
  if(taipeiDateFromEpoch(signal_ts_ms)!==trade_date)throw new LedgerError("TRADE_DATE_MISMATCH","trade_date must match signal timestamp in Asia/Taipei",{trade_date,signal_taipei_date:taipeiDateFromEpoch(signal_ts_ms)});
  const price=optionalFinite(raw.price,"price",true),atr=optionalFinite(raw.atr,"atr",true),source=requiredText(raw.source,"source",160),dataset=validateDatasetReference(raw),event_refs=canonicalEventRefs(raw.event_refs),resolved_events=await validateReferencedEvents(env,event_refs,knowledge_cutoff_ts_ms),reason_codes=canonicalReasonCodes(raw.reason_codes),payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:SIGNAL_EVENT_LEDGER_SCHEMA_VERSION,signal_id,signal_version,symbol,trade_date,timeframe,side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,...dataset,event_refs,reason_codes,payload};
  const content_hash=await sha256Hex(stableJson(canonical)),ledger_id=`sig:${content_hash}`,recorded_at=new Date().toISOString(),record={...canonical,ledger_id,content_hash,recorded_at,storage:"GITHUB_ONLY"};
  try{const w=await putIndexedImmutableRecord(env,{collection:"research/signal-ledger",key:`${signal_id}\u0000${signal_version}`,record,metadata:{signal_id,signal_version,symbol,trade_date,strategy,stage,signal_ts_ms}});return{ok:true,immutable:true,idempotent:w.idempotent,ledger_id,content_hash,signal_id,signal_version,knowledge_cutoff_ts_ms,data_watermark_ts_ms,referenced_events:resolved_events,recorded_at,storage:"GITHUB_ONLY"};}catch(e){wrapStoreError(e);}
}

export async function getSignalLedger(env:Env,signalId:string,signalVersion?:string){const id=requiredText(signalId,"signal_id",240);if(signalVersion)return await readIndexedRecord<any>(env,"research/signal-ledger",`${id}\u0000${signalVersion}`);const idx=await readCollectionIndex(env,"research/signal-ledger");const hit=idx.records.filter(x=>x.signal_id===id).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))[0];return hit?(await readIndexedRecord<any>(env,"research/signal-ledger",hit.key)):null;}
export async function getEventLedger(env:Env,eventId:string,eventVersion?:string){const id=requiredText(eventId,"event_id",240);if(eventVersion)return await readIndexedRecord<any>(env,"research/event-ledger",`${id}\u0000${eventVersion}`);const idx=await readCollectionIndex(env,"research/event-ledger");const hit=idx.records.filter(x=>x.event_id===id).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))[0];return hit?(await readIndexedRecord<any>(env,"research/event-ledger",hit.key)):null;}
export async function listSignalLedger(env:Env,filters:{trade_date?:string;symbol?:string;strategy?:string;stage?:string;limit?:number}){const tradeDate=filters.trade_date?normalizeTradeDate(filters.trade_date):undefined,symbol=filters.symbol?requiredSymbol(filters.symbol):undefined,strategy=filters.strategy?requiredText(filters.strategy,"strategy",200):undefined,stage=filters.stage?requiredText(filters.stage,"stage",120):undefined,limit=Math.max(1,Math.min(500,Number(filters.limit??100)));const rows=await listIndexedRecords<any>(env,"research/signal-ledger",e=>(!tradeDate||e.trade_date===tradeDate)&&(!symbol||e.symbol===symbol)&&(!strategy||e.strategy===strategy)&&(!stage||e.stage===stage),limit);return rows.sort((a,b)=>Number(a.signal_ts_ms)-Number(b.signal_ts_ms)||String(a.signal_id).localeCompare(String(b.signal_id)));}
export async function listEventLedger(env:Env,filters:{symbol?:string;event_type?:string;available_before_ts_ms?:number;limit?:number}){const symbol=filters.symbol?requiredSymbol(filters.symbol):undefined,eventType=filters.event_type?requiredText(filters.event_type,"event_type",120):undefined,before=filters.available_before_ts_ms?positiveInteger(filters.available_before_ts_ms,"available_before_ts_ms"):undefined,limit=Math.max(1,Math.min(500,Number(filters.limit??100)));const rows=await listIndexedRecords<any>(env,"research/event-ledger",e=>(!symbol||e.symbol===symbol)&&(!eventType||e.event_type===eventType)&&(!before||Number(e.available_ts_ms)<=before),limit);return rows.sort((a,b)=>Number(a.available_ts_ms)-Number(b.available_ts_ms)||String(a.event_id).localeCompare(String(b.event_id)));}
