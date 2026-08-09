export const TXF_SIGNAL_LEDGER_SCHEMA_VERSION = "txf-signal-ledger/v1";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS txf_signal_ledger (
    ledger_id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL,
    signal_version TEXT NOT NULL,
    logical_symbol TEXT NOT NULL,
    contract_symbol TEXT,
    trade_date TEXT NOT NULL,
    session TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    side TEXT NOT NULL,
    strategy TEXT NOT NULL,
    stage TEXT NOT NULL,
    signal_ts_ms INTEGER NOT NULL,
    knowledge_cutoff_ts_ms INTEGER NOT NULL,
    data_watermark_ts_ms INTEGER NOT NULL,
    price REAL,
    atr REAL,
    source TEXT NOT NULL,
    reason_codes_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(signal_id, signal_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_txf_signal_date_time ON txf_signal_ledger(trade_date, session, signal_ts_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_txf_signal_strategy ON txf_signal_ledger(strategy, trade_date, signal_ts_ms)`,
] as const;

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

export async function ensureTxfSignalLedgerSchema(env:Env){
  if(!env.RESEARCH_DB) throw new TxfSignalLedgerError("RESEARCH_DB_UNAVAILABLE","RESEARCH_DB binding is required");
  await env.RESEARCH_DB.batch(SCHEMA.map(sql=>env.RESEARCH_DB.prepare(sql)));
}

export async function recordTxfSignal(env:Env, raw:RecordTxfSignalInput){
  await ensureTxfSignalLedgerSchema(env);
  const signal_id=text(raw.signal_id,"signal_id",240);
  const signal_version=text(raw.signal_version,"signal_version",160);
  const contract_symbol=contract(raw.contract_symbol);
  const trade_date=date(raw.trade_date);
  const session=String(raw.session??"").toUpperCase() as TxfSession;
  if(!["REGULAR","AFTERHOURS"].includes(session)) throw new TxfSignalLedgerError("INVALID_INPUT","session must be REGULAR or AFTERHOURS");
  if(raw.timeframe!=="5m") throw new TxfSignalLedgerError("INVALID_INPUT","TXF review signal timeframe must be 5m");
  const side=String(raw.side??"").toUpperCase() as TxfSide;
  if(!["LONG","SHORT","NEUTRAL"].includes(side)) throw new TxfSignalLedgerError("INVALID_INPUT","side must be LONG, SHORT or NEUTRAL");
  const strategy=text(raw.strategy,"strategy",200), stage=text(raw.stage,"stage",120), source=text(raw.source,"source",200);
  const signal_ts_ms=positiveInt(raw.signal_ts_ms,"signal_ts_ms");
  const knowledge_cutoff_ts_ms=positiveInt(raw.knowledge_cutoff_ts_ms,"knowledge_cutoff_ts_ms");
  const data_watermark_ts_ms=positiveInt(raw.data_watermark_ts_ms,"data_watermark_ts_ms");
  if(data_watermark_ts_ms>knowledge_cutoff_ts_ms||knowledge_cutoff_ts_ms>signal_ts_ms) throw new TxfSignalLedgerError("LOOKAHEAD_BIAS","required ordering is data_watermark <= knowledge_cutoff <= signal timestamp");
  const price=finiteOptional(raw.price,"price",true), atr=finiteOptional(raw.atr,"atr",true);
  const reason_codes=Array.from(new Set((raw.reason_codes??[]).map(x=>text(x,"reason_code",120)))).sort();
  const payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:TXF_SIGNAL_LEDGER_SCHEMA_VERSION,signal_id,signal_version,logical_symbol:"TXF",contract_symbol,trade_date,session,timeframe:"5m",side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,reason_codes,payload};
  const content_hash=await sha256(stableJson(canonical));
  const ledger_id=`txfsig:${content_hash}`;
  const recorded_at=new Date().toISOString();
  await env.RESEARCH_DB.prepare(`INSERT OR IGNORE INTO txf_signal_ledger(
    ledger_id,signal_id,signal_version,logical_symbol,contract_symbol,trade_date,session,timeframe,side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,reason_codes_json,payload_json,content_hash,recorded_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    ledger_id,signal_id,signal_version,"TXF",contract_symbol,trade_date,session,"5m",side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,stableJson(reason_codes),stableJson(payload),content_hash,recorded_at
  ).run();
  const existing=await env.RESEARCH_DB.prepare(`SELECT * FROM txf_signal_ledger WHERE signal_id=? AND signal_version=?`).bind(signal_id,signal_version).first<Record<string,unknown>>();
  if(!existing) throw new TxfSignalLedgerError("LEDGER_WRITE_FAILED","TXF signal row was not persisted");
  if(String(existing.content_hash)!==content_hash) throw new TxfSignalLedgerError("IMMUTABLE_CONFLICT","signal_id + signal_version already exists with different immutable content",{signal_id,signal_version});
  return {ok:true,immutable:true,ledger_id:String(existing.ledger_id),signal_id,signal_version,content_hash,recorded_at:existing.recorded_at};
}

function parseRow(row:Record<string,unknown>|null){
  if(!row) return null;
  let reason_codes:string[]=[]; let payload:Record<string,unknown>={};
  try{reason_codes=JSON.parse(String(row.reason_codes_json??"[]"));}catch{}
  try{payload=JSON.parse(String(row.payload_json??"{}"));}catch{}
  return {...row,reason_codes,payload};
}

export async function getTxfSignal(env:Env, signalId:string, signalVersion:string){
  await ensureTxfSignalLedgerSchema(env);
  return parseRow(await env.RESEARCH_DB.prepare(`SELECT * FROM txf_signal_ledger WHERE signal_id=? AND signal_version=?`).bind(text(signalId,"signal_id",240),text(signalVersion,"signal_version",160)).first<Record<string,unknown>>());
}

export async function listTxfSignals(env:Env,input:{trade_date?:string;session?:TxfSession;strategy?:string;limit?:number}={}){
  await ensureTxfSignalLedgerSchema(env);
  const clauses:string[]=[], args:unknown[]=[];
  if(input.trade_date){clauses.push("trade_date=?");args.push(date(input.trade_date));}
  if(input.session){const s=String(input.session).toUpperCase();if(!["REGULAR","AFTERHOURS"].includes(s)) throw new TxfSignalLedgerError("INVALID_INPUT","invalid session");clauses.push("session=?");args.push(s);}
  if(input.strategy){clauses.push("strategy=?");args.push(text(input.strategy,"strategy",200));}
  const limit=Math.max(1,Math.min(500,Math.floor(Number(input.limit??100))));
  const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
  const result=await env.RESEARCH_DB.prepare(`SELECT * FROM txf_signal_ledger ${where} ORDER BY trade_date DESC, signal_ts_ms DESC LIMIT ?`).bind(...args,limit).all<Record<string,unknown>>();
  return {ok:true,count:result.results.length,signals:result.results.map(row=>parseRow(row))};
}
