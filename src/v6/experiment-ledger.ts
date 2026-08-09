export const EXPERIMENT_LEDGER_SCHEMA_VERSION = "diamond-experiment-ledger/v1";
export const EXPERIMENT_DECISION_SCHEMA_VERSION = "diamond-experiment-decision/v1";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS experiment_ledger (
    experiment_ledger_id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL,
    experiment_version TEXT NOT NULL,
    hypothesis TEXT NOT NULL,
    hypothesis_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    strategy_id TEXT,
    strategy_version TEXT,
    signal_refs_json TEXT NOT NULL,
    dataset_refs_json TEXT NOT NULL,
    parameters_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    profit_factor REAL,
    win_rate REAL,
    expectancy_pct REAL,
    mfe_pct REAL,
    mae_pct REAL,
    regime TEXT,
    validation_status TEXT NOT NULL,
    rejection_reason TEXT,
    content_hash TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(experiment_id, experiment_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_experiment_hypothesis_hash ON experiment_ledger(hypothesis_hash, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS idx_experiment_strategy ON experiment_ledger(strategy_id, strategy_version, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS idx_experiment_validation ON experiment_ledger(validation_status, recorded_at)`,
  `CREATE TABLE IF NOT EXISTS experiment_decision_ledger (
    decision_ledger_id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL,
    decision_version TEXT NOT NULL,
    experiment_id TEXT NOT NULL,
    experiment_version TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    rationale TEXT,
    payload_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(decision_id, decision_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_experiment_decision_target ON experiment_decision_ledger(experiment_id, experiment_version, recorded_at)`,
] as const;

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

export async function ensureExperimentLedgerSchema(env: Env) {
  if (!env.RESEARCH_DB) throw new ExperimentLedgerError("RESEARCH_DB_UNAVAILABLE", "RESEARCH_DB binding is required");
  await env.RESEARCH_DB.batch(SCHEMA_STATEMENTS.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

export async function recordExperiment(env: Env, raw: RecordExperimentInput) {
  await ensureExperimentLedgerSchema(env);
  const experiment_id = requiredText(raw.experiment_id, "experiment_id", 240);
  const hypothesis = requiredText(raw.hypothesis, "hypothesis", 5000);
  const normalizedHypothesis = hypothesis.replace(/\s+/g, " ").trim().toLowerCase();
  const hypothesis_hash = await sha256Hex(normalizedHypothesis);
  const source = requiredText(raw.source, "source", 200);
  const strategy_id = optionalText(raw.strategy_id, 240);
  const strategy_version = optionalText(raw.strategy_version, 160);
  if ((strategy_id && !strategy_version) || (!strategy_id && strategy_version)) {
    throw new ExperimentLedgerError("INVALID_STRATEGY_REFERENCE", "strategy_id and strategy_version must be supplied together");
  }
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
  if (metrics.win_rate !== null && (metrics.win_rate < 0 || metrics.win_rate > 1)) {
    throw new ExperimentLedgerError("INVALID_INPUT", "metrics.win_rate must be 0..1");
  }
  const regime = optionalText(raw.regime, 200);
  const validation_status = String(raw.validation_status ?? "").toUpperCase();
  if (!["DEVELOPMENT", "VALIDATED", "REJECTED", "CANDIDATE"].includes(validation_status)) {
    throw new ExperimentLedgerError("INVALID_VALIDATION_STATUS", "validation_status must be DEVELOPMENT, VALIDATED, REJECTED or CANDIDATE");
  }
  const rejection_reason = optionalText(raw.rejection_reason, 2000);
  if (validation_status === "REJECTED" && !rejection_reason) {
    throw new ExperimentLedgerError("REJECTION_REASON_REQUIRED", "REJECTED experiment requires rejection_reason");
  }

  const canonical = {
    schema_version: EXPERIMENT_LEDGER_SCHEMA_VERSION,
    experiment_id,
    hypothesis,
    hypothesis_hash,
    source,
    strategy_id,
    strategy_version,
    signal_refs,
    dataset_refs,
    parameters,
    result,
    metrics,
    regime,
    validation_status,
    rejection_reason,
  };
  const content_hash = await sha256Hex(stableJson(canonical));
  const experiment_version = `sha256:${content_hash}`;
  const experiment_ledger_id = `exp:${content_hash}`;
  const recorded_at = new Date().toISOString();

  await env.RESEARCH_DB.prepare(`
    INSERT OR IGNORE INTO experiment_ledger
      (experiment_ledger_id,experiment_id,experiment_version,hypothesis,hypothesis_hash,source,strategy_id,strategy_version,signal_refs_json,dataset_refs_json,parameters_json,result_json,profit_factor,win_rate,expectancy_pct,mfe_pct,mae_pct,regime,validation_status,rejection_reason,content_hash,recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    experiment_ledger_id, experiment_id, experiment_version, hypothesis, hypothesis_hash, source,
    strategy_id, strategy_version, stableJson(signal_refs), stableJson(dataset_refs), stableJson(parameters), stableJson(result),
    metrics.profit_factor, metrics.win_rate, metrics.expectancy_pct, metrics.mfe_pct, metrics.mae_pct,
    regime, validation_status, rejection_reason, content_hash, recorded_at,
  ).run();

  const row = await env.RESEARCH_DB.prepare(`SELECT * FROM experiment_ledger WHERE experiment_id=? AND experiment_version=?`).bind(experiment_id, experiment_version).first<Record<string, unknown>>();
  if (!row) throw new ExperimentLedgerError("LEDGER_WRITE_FAILED", "experiment was not persisted");
  if (String(row.content_hash) !== content_hash) throw new ExperimentLedgerError("IMMUTABLE_CONFLICT", "experiment version already exists with different content");
  return {
    ok: true as const,
    immutable: true as const,
    idempotent: String(row.experiment_ledger_id) === experiment_ledger_id,
    experiment_ledger_id,
    experiment_id,
    experiment_version,
    hypothesis_hash,
    validation_status,
    recorded_at: row.recorded_at,
    production_promotion: "FORBIDDEN" as const,
  };
}

type HydratedExperiment = Record<string, unknown> & {
  validation_status: unknown;
  signal_refs: unknown;
  dataset_refs: unknown;
  parameters: unknown;
  result: unknown;
};

function hydrateExperiment(row: Record<string, unknown>): HydratedExperiment {
  return {
    ...row,
    validation_status: row.validation_status,
    signal_refs: parseJson(row.signal_refs_json, []),
    dataset_refs: parseJson(row.dataset_refs_json, []),
    parameters: parseJson(row.parameters_json, {}),
    result: parseJson(row.result_json, {}),
  };
}

export async function getExperiment(env: Env, experimentId: string, experimentVersion?: string | null) {
  await ensureExperimentLedgerSchema(env);
  const experiment_id = requiredText(experimentId, "experiment_id", 240);
  const row = experimentVersion
    ? await env.RESEARCH_DB.prepare(`SELECT * FROM experiment_ledger WHERE experiment_id=? AND experiment_version=?`).bind(experiment_id, experimentVersion).first<Record<string, unknown>>()
    : await env.RESEARCH_DB.prepare(`SELECT * FROM experiment_ledger WHERE experiment_id=? ORDER BY recorded_at DESC, experiment_version DESC LIMIT 1`).bind(experiment_id).first<Record<string, unknown>>();
  return row ? { ok: true as const, found: true as const, experiment: hydrateExperiment(row) } : { ok: true as const, found: false as const, experiment: null };
}

export async function listExperiments(env: Env, filters: { strategy_id?: string; validation_status?: string; limit?: number } = {}) {
  await ensureExperimentLedgerSchema(env);
  const where: string[] = [];
  const args: unknown[] = [];
  if (filters.strategy_id) { where.push("strategy_id=?"); args.push(String(filters.strategy_id).trim()); }
  if (filters.validation_status) { where.push("validation_status=?"); args.push(String(filters.validation_status).toUpperCase()); }
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 50)));
  const sql = `SELECT * FROM experiment_ledger ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY recorded_at DESC, experiment_version DESC LIMIT ?`;
  args.push(limit);
  const out = await env.RESEARCH_DB.prepare(sql).bind(...args).all<Record<string, unknown>>();
  return { ok: true as const, count: out.results.length, experiments: out.results.map(hydrateExperiment) };
}

export async function reviewHypothesisHistory(env: Env, hypothesis: string, limit = 50) {
  await ensureExperimentLedgerSchema(env);
  const text = requiredText(hypothesis, "hypothesis", 5000);
  const hypothesis_hash = await sha256Hex(text.replace(/\s+/g, " ").trim().toLowerCase());
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const out = await env.RESEARCH_DB.prepare(`
    SELECT * FROM experiment_ledger WHERE hypothesis_hash=? ORDER BY recorded_at DESC, experiment_version DESC LIMIT ?
  `).bind(hypothesis_hash, safeLimit).all<Record<string, unknown>>();
  const rows = out.results.map(hydrateExperiment);
  const counts = { DEVELOPMENT: 0, VALIDATED: 0, REJECTED: 0, CANDIDATE: 0 } as Record<string, number>;
  for (const row of rows) counts[String(row.validation_status)] = (counts[String(row.validation_status)] ?? 0) + 1;
  return {
    ok: true as const,
    deterministic: true as const,
    hypothesis_hash,
    previously_tested: rows.length > 0,
    experiment_count: rows.length,
    status_counts: counts,
    warning: rows.some((row) => row.validation_status === "REJECTED") ? "HYPOTHESIS_PREVIOUSLY_REJECTED" : null,
    experiments: rows,
  };
}

export async function recordExperimentDecision(env: Env, raw: RecordExperimentDecisionInput) {
  await ensureExperimentLedgerSchema(env);
  const decision_id = requiredText(raw.decision_id, "decision_id", 240);
  const experiment_id = requiredText(raw.experiment_id, "experiment_id", 240);
  const experiment_version = requiredText(raw.experiment_version, "experiment_version", 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(experiment_version)) throw new ExperimentLedgerError("INVALID_EXPERIMENT_VERSION", "experiment_version must be sha256:<64 hex>");
  const target = await env.RESEARCH_DB.prepare(`SELECT experiment_ledger_id FROM experiment_ledger WHERE experiment_id=? AND experiment_version=?`).bind(experiment_id, experiment_version).first<Record<string, unknown>>();
  if (!target) throw new ExperimentLedgerError("EXPERIMENT_NOT_FOUND", "decision target experiment does not exist");
  const action = String(raw.action ?? "").toUpperCase();
  if (!["KEEP_RESEARCH", "MARK_CANDIDATE", "REJECT", "NOTE"].includes(action)) {
    throw new ExperimentLedgerError("PRODUCTION_PROMOTION_FORBIDDEN", "only KEEP_RESEARCH, MARK_CANDIDATE, REJECT and NOTE are supported; Production promotion is intentionally outside this API");
  }
  const actor_type = String(raw.actor_type ?? "").toUpperCase();
  if (!["HUMAN", "SYSTEM", "AI_REVIEW"].includes(actor_type)) throw new ExperimentLedgerError("INVALID_ACTOR_TYPE", "invalid actor_type");
  if (action === "MARK_CANDIDATE" && actor_type === "AI_REVIEW") {
    throw new ExperimentLedgerError("HUMAN_GATE_REQUIRED", "AI_REVIEW cannot promote an experiment to Candidate; human/system approval gate is required");
  }
  const rationale = optionalText(raw.rationale, 3000);
  const payload = stableValue(raw.payload ?? {}) as Record<string, unknown>;
  const canonical = {
    schema_version: EXPERIMENT_DECISION_SCHEMA_VERSION,
    decision_id,
    experiment_id,
    experiment_version,
    action,
    actor_type,
    rationale,
    payload,
  };
  const content_hash = await sha256Hex(stableJson(canonical));
  const decision_version = `sha256:${content_hash}`;
  const decision_ledger_id = `expdec:${content_hash}`;
  const recorded_at = new Date().toISOString();
  await env.RESEARCH_DB.prepare(`
    INSERT OR IGNORE INTO experiment_decision_ledger
      (decision_ledger_id,decision_id,decision_version,experiment_id,experiment_version,action,actor_type,rationale,payload_json,content_hash,recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).bind(decision_ledger_id, decision_id, decision_version, experiment_id, experiment_version, action, actor_type, rationale, stableJson(payload), content_hash, recorded_at).run();
  const row = await env.RESEARCH_DB.prepare(`SELECT * FROM experiment_decision_ledger WHERE decision_id=? AND decision_version=?`).bind(decision_id, decision_version).first<Record<string, unknown>>();
  if (!row) throw new ExperimentLedgerError("LEDGER_WRITE_FAILED", "experiment decision was not persisted");
  if (String(row.content_hash) !== content_hash) throw new ExperimentLedgerError("IMMUTABLE_CONFLICT", "decision version already exists with different content");
  return {
    ok: true as const,
    immutable: true as const,
    decision_ledger_id,
    decision_id,
    decision_version,
    experiment_id,
    experiment_version,
    action,
    actor_type,
    recorded_at: row.recorded_at,
    production_promotion: "FORBIDDEN" as const,
  };
}

export async function listExperimentDecisions(env: Env, experimentId: string, experimentVersion: string) {
  await ensureExperimentLedgerSchema(env);
  const out = await env.RESEARCH_DB.prepare(`
    SELECT * FROM experiment_decision_ledger WHERE experiment_id=? AND experiment_version=? ORDER BY recorded_at ASC, decision_version ASC
  `).bind(experimentId, experimentVersion).all<Record<string, unknown>>();
  return { ok: true as const, count: out.results.length, decisions: out.results.map((row) => ({ ...row, payload: parseJson(row.payload_json, {}) })) };
}
