import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ExperimentLedgerError, listExperimentDecisions, recordExperiment, recordExperimentDecision, reviewHypothesisHistory } from "../src/v6/experiment-ledger.ts";
if(!globalThis.crypto)Object.defineProperty(globalThis,"crypto",{value:webcrypto});
function env(){return{__GITHUB_DATA_MEMORY:new Map(),GITHUB_DATA_BRANCH:"diamond-data"} as unknown as Env;}
const base={experiment_id:"exp-v55-l2-001",hypothesis:"L2 趨勢回踩在特定 Regime 有正期望",source:"diamond-review",strategy_id:"V55-L2",strategy_version:"dev-1",signal_refs:[{signal_id:"sig-1",signal_version:"v1"}],dataset_refs:[{dataset_id:"tw-stock:2330:5m:x",dataset_hash:"a".repeat(64),dataset_version:`sha256:${"a".repeat(64)}`,symbol:"2330",timeframe:"5m"}],parameters:{stop_atr:1,target_atr:1.5},result:{sample_size:120},metrics:{profit_factor:1.42,win_rate:0.43,expectancy_pct:0.12,mfe_pct:0.8,mae_pct:-0.4},regime:"TRENDING_UP",validation_status:"VALIDATED" as const};
{
 const e=env();const a=await recordExperiment(e,base);const b=await recordExperiment(e,{...base,parameters:{target_atr:1.5,stop_atr:1}});assert.equal(a.experiment_version,b.experiment_version);assert.match(a.experiment_version,/^sha256:[0-9a-f]{64}$/);const changed=await recordExperiment(e,{...base,result:{sample_size:121}});assert.notEqual(changed.experiment_version,a.experiment_version);
}
await assert.rejects(recordExperiment(env(),{...base,dataset_refs:[{...base.dataset_refs[0],dataset_version:`sha256:${"b".repeat(64)}`}] }),(x:unknown)=>x instanceof ExperimentLedgerError&&x.code==="INVALID_DATASET_REFERENCE");
await assert.rejects(recordExperiment(env(),{...base,validation_status:"REJECTED",rejection_reason:null}),(x:unknown)=>x instanceof ExperimentLedgerError&&x.code==="REJECTION_REASON_REQUIRED");
{
 const e=env();const rejected=await recordExperiment(e,{...base,experiment_id:"exp-rejected",validation_status:"REJECTED",rejection_reason:"walk-forward failed"});const review=await reviewHypothesisHistory(e,"  L2 趨勢回踩在特定   Regime 有正期望  ");assert.equal(review.previously_tested,true);assert.equal(review.warning,"HYPOTHESIS_PREVIOUSLY_REJECTED");assert.equal(review.status_counts.REJECTED,1);
 await assert.rejects(recordExperimentDecision(e,{decision_id:"d-ai",experiment_id:"exp-rejected",experiment_version:rejected.experiment_version,action:"MARK_CANDIDATE",actor_type:"AI_REVIEW",rationale:"looks good"}),(x:unknown)=>x instanceof ExperimentLedgerError&&x.code==="HUMAN_GATE_REQUIRED");
 const d=await recordExperimentDecision(e,{decision_id:"d-human",experiment_id:"exp-rejected",experiment_version:rejected.experiment_version,action:"KEEP_RESEARCH",actor_type:"HUMAN",rationale:"collect more samples"});assert.equal(d.production_promotion,"FORBIDDEN");assert.equal((await listExperimentDecisions(e,"exp-rejected",rejected.experiment_version)).count,1);
 await assert.rejects(recordExperimentDecision(e,{decision_id:"d-prod",experiment_id:"exp-rejected",experiment_version:rejected.experiment_version,action:"APPROVE_PRODUCTION" as never,actor_type:"HUMAN"}),(x:unknown)=>x instanceof ExperimentLedgerError&&x.code==="PRODUCTION_PROMOTION_FORBIDDEN");
}
{
 const source=await readFile(new URL("../src/v6/experiment-ledger.ts",import.meta.url),"utf8");assert.doesNotMatch(source,/D1Database|RESEARCH_DB|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);assert.match(source,/research\/experiment-ledger/);assert.match(source,/research\/experiment-decisions/);assert.match(source,/GITHUB_ONLY/);assert.match(source,/PRODUCTION_PROMOTION_FORBIDDEN/);assert.match(source,/HUMAN_GATE_REQUIRED/);
}
console.log("Experiment Ledger GitHub-only immutability, duplicate-memory, and promotion gates passed.");
