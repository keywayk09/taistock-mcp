import { GitHubDataStoreError, listIndexedRecords, putIndexedImmutableRecord, readCollectionIndex, readIndexedRecord } from "./github-data-store.ts";

export const EXPERIMENT_LEDGER_SCHEMA_VERSION = "diamond-experiment-ledger/v2-github";
export const EXPERIMENT_DECISION_SCHEMA_VERSION = "diamond-experiment-decision/v2-github";

export type ExperimentDatasetRef = {
  dataset_id: string;
  dataset_version: string;
  dataset_hash: string;
  symbol?: string;
  timeframe?: string;
};

export type ExperimentSignalRef = {
  signal_id: string;
  signal_version: string;
};

export type ExperimentMetrics = {
  profit_factor?: number | null;
  win_rate?: number | null;
  expectancy_pct?: number | null;
  mfe_pct?: number | null;
  mae_pct?: number | null;
};

export type RecordExperimentInput = {
  experiment_id: string;
  hypothesis: string;
  source: string;
  strategy_id?: string | null;
  strategy_version?: string | null;
  signal_refs?: ExperimentSignalRef[];
  dataset_refs?: ExperimentDatasetRef[];
  parameters?: Record<string, unknown>;
  result?: Record<string, unknown>;
  metrics?: ExperimentMetrics;
  regime?: string | null;
  validation_status: "DEVELOPMENT" | "VALIDATED" | "REJECTED" | "CANDIDATE";
  rejection_reason?: string | null;
};

export type RecordExperimentDecisionInput = {
  decision_id: string;
  experiment_id: string;
  experiment_version: string;
  action: "KEEP_RESEARCH" | "MARK_CANDIDATE" | "REJECT" | "NOTE";
  actor_type: "HUMAN" | "SYSTEM" | "AI_REVIEW";
  rationale?: string | null;
  payload?: Record<string, unknown>;
};

export class ExperimentLedgerError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ExperimentLedgerError";
    this.code = code;
    this.detail = detail;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableValue(source[key]);
    return out;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function requiredText(value: unknown, field: string, max = 1000): string {
  const text = String(value ?? "").trim();
  if (!text) throw new ExperimentLedgerError("INVALID_INPUT", `${field} is required`);
  if (text.length > max) throw new ExperimentLedgerError("INVALID_INPUT", `${field} is too long`);
  return text;
}

function optionalText(value: unknown, max = 1000): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function optionalFinite(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ExperimentLedgerError("INVALID_INPUT", `${field} must be finite`);
  return number;
}

function canonicalSignalRefs(refs: ExperimentSignalRef[] | undefined) {
  const map = new Map<string, ExperimentSignalRef>();
  for (const ref of refs ?? []) {
    const signal_id = requiredText(ref?.signal_id, "signal_refs.signal_id", 240);
    const signal_version = requiredText(ref?.signal_version, "signal_refs.signal_version", 160);
    map.set(`${signal_id}\u0000${signal_version}`, { signal_id, signal_version });
  }
  return Array.from(map.values()).sort((a, b) => `${a.signal_id}\u0000${a.signal_version}`.localeCompare(`${b.signal_id}\u0000${b.signal_version}`));
}

function canonicalDatasetRefs(refs: ExperimentDatasetRef[] | undefined) {
  const map = new Map<string, ExperimentDatasetRef>();
  for (const ref of refs ?? []) {
    const dataset_id = requiredText(ref?.dataset_id, "dataset_refs.dataset_id", 500);
    const dataset_version = requiredText(ref?.dataset_version, "dataset_refs.dataset_version", 80);
    const dataset_hash = requiredText(ref?.dataset_hash, "dataset_refs.dataset_hash", 64);
    if (!/^sha256:[0-9a-f]{64}$/.test(dataset_version) || !/^[0-9a-f]{64}$/.test(dataset_hash) || dataset_version !== `sha256:${dataset_hash}`) {
      throw new ExperimentLedgerError("INVALID_DATASET_REFERENCE", "dataset_version/hash must be a P2 SHA-256 pair", { dataset_id });
    }
    const normalized = {
      dataset_id,
      dataset_version,
      dataset_hash,
      ...(ref.symbol ? { symbol: String(ref.symbol).trim() } : {}),
      ...(ref.timeframe ? { timeframe: String(ref.timeframe).trim() } : {}),
    };
    map.set(dataset_version, normalized);
  }
  return Array.from(map.values()).sort((a, b) => a.dataset_version.localeCompare(b.dataset_version));
}

function parseJson(raw: unknown, fallback: unknown) {
  try { return JSON.parse(String(raw ?? "")); } catch { return fallback; }
}

function wrapStoreError(error: unknown): never {
  if (error instanceof GitHubDataStoreError) throw new ExperimentLedgerError(error.code, error.message, error.detail);
  throw error;
}

export async function ensureExperimentLedgerSchema(_env: Env) { /* GitHub JSON store requires no database schema. */ }

export async function recordExperiment(env: Env, raw: RecordExperimentInput) {
  const experiment_id = requiredText(raw.experiment_id, "experiment_id", 240);
  const hypothesis = requiredText(raw.hypothesis, "hypothesis", 5000);
  const normalizedHypothesis = hypothesis.replace(/\s+/g, " ").trim().toLowerCase();
  const hypothesis_hash = await sha256Hex(normalizedHypothesis);
  const source = requiredText(raw.source, "source", 200);
  const strategy_id = optionalText(raw.strategy_id, 240);
  const strategy_version = optionalText(raw.strategy_version, 160);
  if ((strategy_id && !strategy_version) || (!strategy_id && strategy_version)) throw new ExperimentLedgerError("INVALID_STRATEGY_REFERENCE", "strategy_id and strategy_version must be supplied together");
  const signal_refs = canonicalSignalRefs(raw.signal_refs);
  const dataset_refs = canonicalDatasetRefs(raw.dataset_refs);
  const parameters = stableValue(raw.parameters ?? {}) as Record<string, unknown>;
  const result = stableValue(raw.result ?? {}) as Record<string, unknown>;
  const metrics = {
    profit_factor: optionalFinite(raw.metrics?.profit_factor, "metrics.profit_factor"),
    win_rate: optionalFinite(raw.metrics?.win_rate, "metrics.win_rate"),
    expectancy_pct: optionalFinite(raw.metrics?.expectancy_pct, "metrics.expectancy_pct"),
    mfe_pct: optionalFinite(raw.metrics?.mfe_pct, "metrics.mfe_pct"),
    mae_pct: optionalFinite(raw.metrics?.mae_pct, "metrics.mae_pct"),
  };
  if (metrics.win_rate !== null && (metrics.win_rate < 0 || metrics.win_rate > 1)) throw new ExperimentLedgerError("INVALID_INPUT", "metrics.win_rate must be 0..1");
  const regime = optionalText(raw.regime, 200);
  const validation_status = String(raw.validation_status ?? "").toUpperCase();
  if (!["DEVELOPMENT", "VALIDATED", "REJECTED", "CANDIDATE"].includes(validation_status)) throw new ExperimentLedgerError("INVALID_VALIDATION_STATUS", "validation_status must be DEVELOPMENT, VALIDATED, REJECTED or CANDIDATE");
  const rejection_reason = optionalText(raw.rejection_reason, 2000);
  if (validation_status === "REJECTED" && !rejection_reason) throw new ExperimentLedgerError("REJECTION_REASON_REQUIRED", "REJECTED experiment requires rejection_reason");

  const canonical = { schema_version:EXPERIMENT_LEDGER_SCHEMA_VERSION, experiment_id, hypothesis, hypothesis_hash, source, strategy_id, strategy_version, signal_refs, dataset_refs, parameters, result, metrics, regime, validation_status, rejection_reason };
  const content_hash = await sha256Hex(stableJson(canonical));
  const experiment_version = `sha256:${content_hash}`;
  const experiment_ledger_id = `exp:${content_hash}`;
  const recorded_at = new Date().toISOString();
  const record = { ...canonical, experiment_ledger_id, experiment_version, content_hash, recorded_at, storage:"GITHUB_ONLY" };
  try {
    const write = await putIndexedImmutableRecord(env, {
      collection:"research/experiment-ledger",
      key:`${experiment_id}\u0000${experiment_version}`,
      record,
      metadata:{ experiment_id, experiment_version, hypothesis_hash, strategy_id, strategy_version, validation_status },
    });
    return { ok:true as const, immutable:true as const, idempotent:write.idempotent, experiment_ledger_id, experiment_id, experiment_version, hypothesis_hash, validation_status, recorded_at, storage:"GITHUB_ONLY" as const, production_promotion:"FORBIDDEN" as const };
  } catch (error) { wrapStoreError(error); }
}

export async function getExperiment(env: Env, experimentId: string, experimentVersion?: string | null) {
  const experiment_id = requiredText(experimentId, "experiment_id", 240);
  let experiment: any = null;
  if (experimentVersion) experiment = await readIndexedRecord<any>(env,"research/experiment-ledger",`${experiment_id}\u0000${experimentVersion}`);
  else {
    const index=await readCollectionIndex(env,"research/experiment-ledger");
    const hit=index.records.filter((x)=>x.experiment_id===experiment_id).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))[0];
    if(hit)experiment=await readIndexedRecord<any>(env,"research/experiment-ledger",hit.key);
  }
  return experiment ? { ok:true as const, found:true as const, experiment } : { ok:true as const, found:false as const, experiment:null };
}

export async function listExperiments(env: Env, filters: { strategy_id?: string; validation_status?: string; limit?: number } = {}) {
  const strategy=filters.strategy_id?String(filters.strategy_id).trim():undefined;
  const status=filters.validation_status?String(filters.validation_status).toUpperCase():undefined;
  const limit=Math.max(1,Math.min(200,Number(filters.limit||50)));
  const experiments=await listIndexedRecords<any>(env,"research/experiment-ledger",(e)=>(!strategy||e.strategy_id===strategy)&&(!status||e.validation_status===status),limit);
  return { ok:true as const, count:experiments.length, experiments };
}

export async function reviewHypothesisHistory(env: Env, hypothesis: string, limit = 50) {
  const text=requiredText(hypothesis,"hypothesis",5000), hypothesis_hash=await sha256Hex(text.replace(/\s+/g," ").trim().toLowerCase()), safeLimit=Math.max(1,Math.min(200,Number(limit||50)));
  const rows=await listIndexedRecords<any>(env,"research/experiment-ledger",(e)=>e.hypothesis_hash===hypothesis_hash,safeLimit);
  const counts={DEVELOPMENT:0,VALIDATED:0,REJECTED:0,CANDIDATE:0} as Record<string,number>;
  for(const row of rows)counts[String(row.validation_status)]=(counts[String(row.validation_status)]??0)+1;
  return {ok:true as const,deterministic:true as const,hypothesis_hash,previously_tested:rows.length>0,experiment_count:rows.length,status_counts:counts,warning:rows.some((row)=>row.validation_status==="REJECTED")?"HYPOTHESIS_PREVIOUSLY_REJECTED":null,experiments:rows};
}

export async function recordExperimentDecision(env: Env, raw: RecordExperimentDecisionInput) {
  const decision_id=requiredText(raw.decision_id,"decision_id",240), experiment_id=requiredText(raw.experiment_id,"experiment_id",240), experiment_version=requiredText(raw.experiment_version,"experiment_version",80);
  if(!/^sha256:[0-9a-f]{64}$/.test(experiment_version))throw new ExperimentLedgerError("INVALID_EXPERIMENT_VERSION","experiment_version must be sha256:<64 hex>");
  const target=await readIndexedRecord<any>(env,"research/experiment-ledger",`${experiment_id}\u0000${experiment_version}`);
  if(!target)throw new ExperimentLedgerError("EXPERIMENT_NOT_FOUND","decision target experiment does not exist");
  const action=String(raw.action??"").toUpperCase();
  if(!["KEEP_RESEARCH","MARK_CANDIDATE","REJECT","NOTE"].includes(action))throw new ExperimentLedgerError("PRODUCTION_PROMOTION_FORBIDDEN","only KEEP_RESEARCH, MARK_CANDIDATE, REJECT and NOTE are supported; Production promotion is intentionally outside this API");
  const actor_type=String(raw.actor_type??"").toUpperCase();
  if(!["HUMAN","SYSTEM","AI_REVIEW"].includes(actor_type))throw new ExperimentLedgerError("INVALID_ACTOR_TYPE","invalid actor_type");
  if(action==="MARK_CANDIDATE"&&actor_type==="AI_REVIEW")throw new ExperimentLedgerError("HUMAN_GATE_REQUIRED","AI_REVIEW cannot promote an experiment to Candidate; human/system approval gate is required");
  const rationale=optionalText(raw.rationale,3000),payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:EXPERIMENT_DECISION_SCHEMA_VERSION,decision_id,experiment_id,experiment_version,action,actor_type,rationale,payload};
  const content_hash=await sha256Hex(stableJson(canonical)),decision_version=`sha256:${content_hash}`,decision_ledger_id=`expdec:${content_hash}`,recorded_at=new Date().toISOString(),record={...canonical,decision_version,decision_ledger_id,content_hash,recorded_at,storage:"GITHUB_ONLY"};
  try{const write=await putIndexedImmutableRecord(env,{collection:"research/experiment-decisions",key:`${decision_id}\u0000${decision_version}`,record,metadata:{decision_id,decision_version,experiment_id,experiment_version,action,actor_type}});return{ok:true as const,immutable:true as const,idempotent:write.idempotent,decision_ledger_id,decision_id,decision_version,experiment_id,experiment_version,action,actor_type,recorded_at,storage:"GITHUB_ONLY" as const,production_promotion:"FORBIDDEN" as const};}catch(error){wrapStoreError(error);}
}

export async function listExperimentDecisions(env: Env, experimentId: string, experimentVersion: string) {
  const decisions=await listIndexedRecords<any>(env,"research/experiment-decisions",(e)=>e.experiment_id===experimentId&&e.experiment_version===experimentVersion,200);
  decisions.sort((a,b)=>String(a.recorded_at).localeCompare(String(b.recorded_at))||String(a.decision_version).localeCompare(String(b.decision_version)));
  return {ok:true as const,count:decisions.length,decisions};
}
