import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { LedgerError, getEventLedger, getSignalLedger, listEventLedger, listSignalLedger, recordLedgerEvent, recordSignalLedger } from "../src/v6/signal-event-ledger.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
function env(){return {__GITHUB_DATA_MEMORY:new Map(),GITHUB_DATA_REPO:"keywayk09/taistock-mcp",GITHUB_DATA_BRANCH:"diamond-data"} as unknown as Env;}
const ts=(x:string)=>Date.parse(x);
const eventBase={event_id:"evt-2330-earnings-2026q2",event_version:"v1",symbol:"2330",event_type:"EARNINGS",event_ts_ms:ts("2026-08-07T14:00:00+08:00"),available_ts_ms:ts("2026-08-07T14:00:05+08:00"),source:"mops",title:"Q2 result",payload:{eps:12.3,tags:["q2","official"]}};
{
  const e=env(); const a=await recordLedgerEvent(e,eventBase); const b=await recordLedgerEvent(e,{...eventBase,payload:{tags:["q2","official"],eps:12.3}});
  assert.equal(a.ledger_id,b.ledger_id); assert.equal((await getEventLedger(e,eventBase.event_id,eventBase.event_version))?.event_id,eventBase.event_id); assert.equal((await listEventLedger(e,{symbol:"2330",limit:10})).length,1);
  await assert.rejects(recordLedgerEvent(e,{...eventBase,title:"changed without version bump"}),(x:unknown)=>x instanceof LedgerError&&x.code==="IMMUTABLE_CONFLICT");
}
await assert.rejects(recordLedgerEvent(env(),{...eventBase,available_ts_ms:eventBase.event_ts_ms-1}),(x:unknown)=>x instanceof LedgerError&&x.code==="INVALID_EVENT_TIME");
const signalTs=ts("2026-08-07T14:05:00+08:00");
const signalBase={signal_id:"sig-2330-v55-001",signal_version:"V55-10-dev1",symbol:"2330",trade_date:"2026-08-07",timeframe:"5m",side:"LONG" as const,strategy:"V55",stage:"COMMITTED",signal_ts_ms:signalTs,knowledge_cutoff_ts_ms:signalTs,data_watermark_ts_ms:ts("2026-08-07T14:00:00+08:00"),price:100,atr:2,source:"diamond-signal-engine",dataset_id:"tw-stock:2330:5m:1:2:2",dataset_hash:"a".repeat(64),dataset_version:`sha256:${"a".repeat(64)}`,reason_codes:["TREND","VOLUME"],payload:{score:0.82}};
{
  const e=env(); await recordLedgerEvent(e,eventBase);
  const refs=[{event_id:eventBase.event_id,event_version:eventBase.event_version}];
  const a=await recordSignalLedger(e,{...signalBase,event_refs:refs}); const b=await recordSignalLedger(e,{...signalBase,reason_codes:["VOLUME","TREND","VOLUME"],event_refs:refs});
  assert.equal(a.ledger_id,b.ledger_id); assert.equal(a.referenced_events.length,1); assert.equal((await getSignalLedger(e,signalBase.signal_id,signalBase.signal_version))?.signal_id,signalBase.signal_id); assert.equal((await listSignalLedger(e,{symbol:"2330",limit:10})).length,1);
  await assert.rejects(recordSignalLedger(e,{...signalBase,payload:{score:0.83},event_refs:refs}),(x:unknown)=>x instanceof LedgerError&&x.code==="IMMUTABLE_CONFLICT");
}
await assert.rejects(recordSignalLedger(env(),{...signalBase,data_watermark_ts_ms:signalTs+1}),(x:unknown)=>x instanceof LedgerError&&x.code==="LOOKAHEAD_BIAS");
await assert.rejects(recordSignalLedger(env(),{...signalBase,knowledge_cutoff_ts_ms:signalTs+1}),(x:unknown)=>x instanceof LedgerError&&x.code==="LOOKAHEAD_BIAS");
{
  const e=env(); const future={...eventBase,event_id:"evt-future",event_ts_ms:signalTs+1000,available_ts_ms:signalTs+2000}; await recordLedgerEvent(e,future);
  await assert.rejects(recordSignalLedger(e,{...signalBase,event_refs:[{event_id:"evt-future",event_version:"v1"}]}),(x:unknown)=>x instanceof LedgerError&&x.code==="LOOKAHEAD_BIAS");
}
await assert.rejects(recordSignalLedger(env(),{...signalBase,event_refs:[{event_id:"missing",event_version:"v1"}]}),(x:unknown)=>x instanceof LedgerError&&x.code==="EVENT_REF_NOT_FOUND");
await assert.rejects(recordSignalLedger(env(),{...signalBase,trade_date:"2026-08-08"}),(x:unknown)=>x instanceof LedgerError&&x.code==="TRADE_DATE_MISMATCH");
await assert.rejects(recordSignalLedger(env(),{...signalBase,dataset_hash:null}),(x:unknown)=>x instanceof LedgerError&&x.code==="INVALID_DATASET_REFERENCE");
await assert.rejects(recordSignalLedger(env(),{...signalBase,dataset_version:`sha256:${"b".repeat(64)}`}),(x:unknown)=>x instanceof LedgerError&&x.code==="INVALID_DATASET_REFERENCE");
{
  const source=await readFile(new URL("../src/v6/signal-event-ledger.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/D1Database|RESEARCH_DB|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i); assert.match(source,/research\/event-ledger/); assert.match(source,/research\/signal-ledger/); assert.match(source,/GITHUB_ONLY/); assert.match(source,/data_watermark_ts_ms>knowledge_cutoff_ts_ms\|\|knowledge_cutoff_ts_ms>signal_ts_ms/); assert.match(source,/event_available_ts_ms/);
}
console.log("Signal/Event Ledger GitHub-only immutability and knowledge-cutoff tests passed.");
