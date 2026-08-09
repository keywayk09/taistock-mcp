import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ExperimentLedgerError,
  recordExperiment,
  recordExperimentDecision,
  reviewHypothesisHistory,
} from "../src/v6/experiment-ledger.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });

class FakeStatement {
  private params: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...params: unknown[]) { const copy = new FakeStatement(this.db, this.sql); copy.params = params; return copy; }
  compact() { return this.sql.replace(/\s+/g, " ").trim(); }

  async run() {
    const compact = this.compact();
    if (compact.startsWith("CREATE ")) return { success:true };
    if (compact.startsWith("INSERT OR IGNORE INTO experiment_ledger")) {
      const [experiment_ledger_id,experiment_id,experiment_version,hypothesis,hypothesis_hash,source,strategy_id,strategy_version,signal_refs_json,dataset_refs_json,parameters_json,result_json,profit_factor,win_rate,expectancy_pct,mfe_pct,mae_pct,regime,validation_status,rejection_reason,content_hash,recorded_at] = this.params;
      const key=`${experiment_id}\u0000${experiment_version}`;
      if (!this.db.experiments.has(key)) this.db.experiments.set(key,{experiment_ledger_id,experiment_id,experiment_version,hypothesis,hypothesis_hash,source,strategy_id,strategy_version,signal_refs_json,dataset_refs_json,parameters_json,result_json,profit_factor,win_rate,expectancy_pct,mfe_pct,mae_pct,regime,validation_status,rejection_reason,content_hash,recorded_at});
      return { success:true };
    }
    if (compact.startsWith("INSERT OR IGNORE INTO experiment_decision_ledger")) {
      const [decision_ledger_id,decision_id,decision_version,experiment_id,experiment_version,action,actor_type,rationale,payload_json,content_hash,recorded_at]=this.params;
      const key=`${decision_id}\u0000${decision_version}`;
      if (!this.db.decisions.has(key)) this.db.decisions.set(key,{decision_ledger_id,decision_id,decision_version,experiment_id,experiment_version,action,actor_type,rationale,payload_json,content_hash,recorded_at});
      return { success:true };
    }
    throw new Error(`unhandled run SQL: ${compact}`);
  }

  async first<T>() {
    const compact=this.compact();
    if (compact.includes("FROM experiment_ledger WHERE experiment_id=? AND experiment_version=?")) {
      return (this.db.experiments.get(`${this.params[0]}\u0000${this.params[1]}`) ?? null) as T | null;
    }
    throw new Error(`unhandled first SQL: ${compact}`);
  }

  async all<T>() {
    const compact=this.compact();
    if (compact.includes("FROM experiment_ledger WHERE hypothesis_hash=?")) {
      const hash=String(this.params[0]);
      return { results:[...this.db.experiments.values()].filter((row)=>row.hypothesis_hash===hash) as T[] };
    }
    if (compact.includes("FROM experiment_decision_ledger")) {
      const [id,version]=this.params;
      return { results:[...this.db.decisions.values()].filter((row)=>row.experiment_id===id&&row.experiment_version===version) as T[] };
    }
    return { results:[] as T[] };
  }
}

class FakeD1 {
  experiments=new Map<string,Record<string,unknown>>();
  decisions=new Map<string,Record<string,unknown>>();
  prepare(sql:string){return new FakeStatement(this,sql);}
  async batch(statements:FakeStatement[]){return Promise.all(statements.map((statement)=>statement.run()));}
}

function env(db=new FakeD1()){return {RESEARCH_DB:db} as unknown as Env;}

const base={
  experiment_id:"exp-v55-l2-001",
  hypothesis:"L2 趨勢回踩在特定 Regime 有正期望",
  source:"diamond-review",
  strategy_id:"V55-L2",
  strategy_version:"dev-1",
  signal_refs:[{signal_id:"sig-1",signal_version:"v1"}],
  dataset_refs:[{dataset_id:"tw-stock:2330:5m:x",dataset_hash:"a".repeat(64),dataset_version:`sha256:${"a".repeat(64)}`,symbol:"2330",timeframe:"5m"}],
  parameters:{stop_atr:1,target_atr:1.5},
  result:{sample_size:120},
  metrics:{profit_factor:1.42,win_rate:0.43,expectancy_pct:0.12,mfe_pct:0.8,mae_pct:-0.4},
  regime:"TRENDING_UP",
  validation_status:"VALIDATED" as const,
};

{
  const db=new FakeD1(); const e=env(db);
  const a=await recordExperiment(e,base);
  const b=await recordExperiment(e,{...base,parameters:{target_atr:1.5,stop_atr:1}});
  assert.equal(a.experiment_version,b.experiment_version,"object key order must not drift experiment identity");
  assert.equal(db.experiments.size,1);
  assert.match(a.experiment_version,/^sha256:[0-9a-f]{64}$/);

  const changed=await recordExperiment(e,{...base,result:{sample_size:121}});
  assert.notEqual(changed.experiment_version,a.experiment_version,"changed immutable content must create a new version");
  assert.equal(db.experiments.size,2);
}

{
  await assert.rejects(
    recordExperiment(env(),{...base,dataset_refs:[{...base.dataset_refs[0],dataset_version:`sha256:${"b".repeat(64)}`}] }),
    (error:unknown)=>error instanceof ExperimentLedgerError&&error.code==="INVALID_DATASET_REFERENCE",
  );
  await assert.rejects(
    recordExperiment(env(),{...base,validation_status:"REJECTED",rejection_reason:null}),
    (error:unknown)=>error instanceof ExperimentLedgerError&&error.code==="REJECTION_REASON_REQUIRED",
  );
}

{
  const db=new FakeD1(); const e=env(db);
  const rejected=await recordExperiment(e,{...base,experiment_id:"exp-rejected",validation_status:"REJECTED",rejection_reason:"walk-forward failed"});
  const review=await reviewHypothesisHistory(e,"  L2 趨勢回踩在特定   Regime 有正期望  ");
  assert.equal(review.previously_tested,true);
  assert.equal(review.warning,"HYPOTHESIS_PREVIOUSLY_REJECTED");
  assert.equal(review.status_counts.REJECTED,1);

  await assert.rejects(
    recordExperimentDecision(e,{decision_id:"d-ai",experiment_id:"exp-rejected",experiment_version:rejected.experiment_version,action:"MARK_CANDIDATE",actor_type:"AI_REVIEW",rationale:"looks good"}),
    (error:unknown)=>error instanceof ExperimentLedgerError&&error.code==="HUMAN_GATE_REQUIRED",
  );
  const decision=await recordExperimentDecision(e,{decision_id:"d-human",experiment_id:"exp-rejected",experiment_version:rejected.experiment_version,action:"KEEP_RESEARCH",actor_type:"HUMAN",rationale:"collect more samples"});
  assert.equal(decision.production_promotion,"FORBIDDEN");
  assert.equal(db.decisions.size,1);

  await assert.rejects(
    recordExperimentDecision(e,{decision_id:"d-prod",experiment_id:"exp-rejected",experiment_version:rejected.experiment_version,action:"APPROVE_PRODUCTION" as never,actor_type:"HUMAN"}),
    (error:unknown)=>error instanceof ExperimentLedgerError&&error.code==="PRODUCTION_PROMOTION_FORBIDDEN",
  );
}

{
  const moduleSource=await readFile(new URL("../src/v6/experiment-ledger.ts",import.meta.url),"utf8");
  const migration=await readFile(new URL("../migrations/0003_experiment_ledger.sql",import.meta.url),"utf8");
  assert.doesNotMatch(moduleSource,/\bUPDATE\s+experiment_/i,"Experiment Memory must be append-only");
  assert.doesNotMatch(moduleSource,/\bDELETE\s+FROM\s+experiment_/i,"Experiment Memory must be append-only");
  assert.doesNotMatch(moduleSource,/fetch\s*\(/,"Experiment Memory must not fetch market data");
  assert.match(moduleSource,/PRODUCTION_PROMOTION_FORBIDDEN/);
  assert.match(moduleSource,/HUMAN_GATE_REQUIRED/);
  assert.match(migration,/UNIQUE\(experiment_id, experiment_version\)/);
  assert.match(migration,/experiment_decision_ledger/);
}

console.log("Experiment Ledger immutability, duplicate-memory, and promotion gates passed.");
