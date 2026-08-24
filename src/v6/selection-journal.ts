import {
  putIndexedImmutableRecord,
  readIndexedRecord,
  listIndexedRecords,
  sha256Hex,
  stableJson,
  type CollectionIndexEntry,
} from "./github-data-store.ts";

export const SELECTION_JOURNAL_VERSION = "diamond-selection-journal/v1.0.0";
export const SELECTION_EVIDENCE_VERSION = "diamond-selection-evidence/v1.0.0";
export const SELECTION_OUTCOME_VERSION = "diamond-selection-outcome/v1.0.0";
export const SELECTION_AUDIT_VERSION = "diamond-selection-audit-delta/v1.0.0";

export type SelectionType = "SWING" | "INTRADAY_REVIEW" | "NEXT_DAY_INTRADAY";
export type SelectionEvidenceSlot = "EOD_1830" | "FULL_2230";
export type SelectionSide = "LONG" | "SHORT" | "NEUTRAL" | "BOTH";

export type SelectionEvidenceRef = {
  evidence_id: string;
  evidence_version: string;
  source_trade_date: string;
  slot: SelectionEvidenceSlot;
  content_hash: string;
};

export type SelectionCandidate = {
  rank: number;
  symbol: string;
  name: string;
  market: "TWSE" | "TPEx";
  side: SelectionSide;
  tier: string;
  event_type?: string | null;
  score: number;
  score_components: Record<string, number | null>;
  reason_codes: string[];
  caution_codes: string[];
  features: Record<string, unknown>;
};

export type SelectionEvidenceRecord = {
  schema_version: typeof SELECTION_EVIDENCE_VERSION;
  evidence_id: string;
  source_trade_date: string;
  slot: SelectionEvidenceSlot;
  generated_at: string;
  generated_at_ms: number;
  knowledge_cutoff_ts_ms: number;
  data_watermark_ts_ms: number;
  source_manifest_path: string;
  source_manifest_sha: string | null;
  source_manifest_projection_hash: string;
  source_refs: Array<{
    kind: string;
    market: string;
    path: string;
    dataset_version: string | null;
    content_sha256: string | null;
    row_count: number | null;
  }>;
  market_snapshot: {
    source_contract: string;
    retrieved_at: string;
    listed_count: number;
    otc_count: number;
    quote_trade_date: string;
  };
  completeness: {
    status: "READY";
    required_layers: string[];
    ready_layers: string[];
    optional_missing_layers: string[];
  };
  universe_feature_schema: string;
  universe_features: Array<Record<string, unknown>>;
  content_hash: string;
  recorded_at: string;
  storage: "GITHUB_ONLY";
};

export type SelectionRunRecord = {
  schema_version: typeof SELECTION_JOURNAL_VERSION;
  selection_id: string;
  selection_type: SelectionType;
  selector_version: string;
  rule_hash: string;
  source_trade_date: string;
  target_session_date: string;
  generated_at: string;
  generated_at_ms: number;
  knowledge_cutoff_ts_ms: number;
  data_watermark_ts_ms: number;
  evidence_ref: SelectionEvidenceRef;
  status: "FINAL";
  universe_count: number;
  candidate_count: number;
  candidates: SelectionCandidate[];
  control_sample: Array<Record<string, unknown>>;
  policy: {
    immutable_prediction: true;
    future_data_forbidden: true;
    audit_may_rewrite_prediction: false;
    auto_order: false;
  };
  content_hash: string;
  recorded_at: string;
  storage: "GITHUB_ONLY";
};

export type SelectionOutcomeRecord = {
  schema_version: typeof SELECTION_OUTCOME_VERSION;
  outcome_id: string;
  selection_id: string;
  selection_type: SelectionType;
  symbol: string;
  horizon: string;
  target_trade_date: string;
  measured_at: string;
  dataset_refs: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  content_hash: string;
  recorded_at: string;
  storage: "GITHUB_ONLY";
};

export type SelectionAuditDeltaRecord = {
  schema_version: typeof SELECTION_AUDIT_VERSION;
  audit_id: string;
  source_trade_date: string;
  audited_at: string;
  original_selection_ids: string[];
  original_evidence_refs: SelectionEvidenceRef[];
  audited_source_manifest_sha: string | null;
  changed: boolean;
  deltas: Array<Record<string, unknown>>;
  policy: "AUDIT_ONLY_NEVER_REWRITE_SELECTION";
  content_hash: string;
  recorded_at: string;
  storage: "GITHUB_ONLY";
};

const COLLECTIONS: Record<SelectionType, string> = {
  SWING: "research/selection/swing",
  INTRADAY_REVIEW: "research/selection/intraday-review",
  NEXT_DAY_INTRADAY: "research/selection/next-day-intraday",
};

const EVIDENCE_COLLECTION = "research/selection/evidence";
const OUTCOME_COLLECTION = "research/selection/outcomes";
const AUDIT_COLLECTION = "research/selection/audit-delta";

function assertIsoDate(value: string, code: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new Error(code);
}

function assertFiniteMs(value: number, code: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

function assertNoLookahead(input: { generated_at_ms: number; knowledge_cutoff_ts_ms: number; data_watermark_ts_ms: number }) {
  assertFiniteMs(input.generated_at_ms, "selection_generated_at_invalid");
  assertFiniteMs(input.knowledge_cutoff_ts_ms, "selection_knowledge_cutoff_invalid");
  assertFiniteMs(input.data_watermark_ts_ms, "selection_data_watermark_invalid");
  if (input.data_watermark_ts_ms > input.knowledge_cutoff_ts_ms) throw new Error("selection_data_watermark_after_knowledge_cutoff");
  if (input.knowledge_cutoff_ts_ms > input.generated_at_ms) throw new Error("selection_knowledge_cutoff_after_generation");
}

function selectionKey(type: SelectionType, sourceTradeDate: string, targetSessionDate: string, selectorVersion: string) {
  return [type, sourceTradeDate, targetSessionDate, selectorVersion].join("\u0000");
}

export function selectionEvidenceKey(sourceTradeDate: string, slot: SelectionEvidenceSlot, evidenceVersion = SELECTION_EVIDENCE_VERSION) {
  return [sourceTradeDate, slot, evidenceVersion].join("\u0000");
}

function outcomeKey(input: Pick<SelectionOutcomeRecord, "selection_id" | "symbol" | "horizon" | "target_trade_date">) {
  return [input.selection_id, input.symbol, input.horizon, input.target_trade_date].join("\u0000");
}

async function hashWithout<T extends Record<string, unknown>>(record: T, excluded: string[]) {
  const copy: Record<string, unknown> = { ...record };
  for (const key of excluded) delete copy[key];
  return sha256Hex(stableJson(copy));
}

export async function getSelectionEvidence(env: Env, sourceTradeDate: string, slot: SelectionEvidenceSlot) {
  return readIndexedRecord<SelectionEvidenceRecord>(env, EVIDENCE_COLLECTION, selectionEvidenceKey(sourceTradeDate, slot));
}

export async function recordSelectionEvidence(env: Env, input: Omit<SelectionEvidenceRecord, "schema_version" | "content_hash" | "recorded_at" | "storage">) {
  assertIsoDate(input.source_trade_date, "selection_evidence_trade_date_invalid");
  assertNoLookahead(input);
  if (!input.evidence_id) throw new Error("selection_evidence_id_required");
  if (!input.source_manifest_path) throw new Error("selection_evidence_manifest_path_required");
  if (!Array.isArray(input.universe_features) || !input.universe_features.length) throw new Error("selection_evidence_universe_empty");
  const recordedAt = new Date().toISOString();
  const base = {
    schema_version: SELECTION_EVIDENCE_VERSION as SelectionEvidenceRecord["schema_version"],
    ...input,
    storage: "GITHUB_ONLY" as const,
    recorded_at: recordedAt,
  };
  const contentHash = await hashWithout(base, ["recorded_at"]);
  const record: SelectionEvidenceRecord = { ...base, content_hash: contentHash };
  await putIndexedImmutableRecord(env, {
    collection: EVIDENCE_COLLECTION,
    key: selectionEvidenceKey(input.source_trade_date, input.slot),
    record,
    metadata: {
      source_trade_date: input.source_trade_date,
      slot: input.slot,
      evidence_id: input.evidence_id,
      content_hash: contentHash,
    },
    message: `selection-evidence: ${input.source_trade_date} ${input.slot}`,
  });
  return record;
}

export async function getSelectionRun(env: Env, input: { selection_type: SelectionType; source_trade_date: string; target_session_date: string; selector_version: string }) {
  return readIndexedRecord<SelectionRunRecord>(
    env,
    COLLECTIONS[input.selection_type],
    selectionKey(input.selection_type, input.source_trade_date, input.target_session_date, input.selector_version),
  );
}

export async function recordSelectionRun(env: Env, input: Omit<SelectionRunRecord, "schema_version" | "content_hash" | "recorded_at" | "storage" | "policy" | "status">) {
  assertIsoDate(input.source_trade_date, "selection_source_trade_date_invalid");
  assertIsoDate(input.target_session_date, "selection_target_session_date_invalid");
  assertNoLookahead(input);
  if (!input.selection_id) throw new Error("selection_id_required");
  if (!input.selector_version || !input.rule_hash) throw new Error("selection_version_or_rule_hash_missing");
  if (!input.evidence_ref?.content_hash) throw new Error("selection_evidence_ref_missing");
  if (!Array.isArray(input.candidates)) throw new Error("selection_candidates_invalid");
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    if (!/^[1-9]\d{3}$/.test(candidate.symbol)) throw new Error(`selection_candidate_symbol_invalid:${candidate.symbol}`);
    if (seen.has(candidate.symbol)) throw new Error(`selection_candidate_duplicate:${candidate.symbol}`);
    seen.add(candidate.symbol);
    if (!Number.isInteger(candidate.rank) || candidate.rank < 1) throw new Error(`selection_candidate_rank_invalid:${candidate.symbol}`);
    if (!Number.isFinite(candidate.score)) throw new Error(`selection_candidate_score_invalid:${candidate.symbol}`);
  }
  const recordedAt = new Date().toISOString();
  const base = {
    schema_version: SELECTION_JOURNAL_VERSION as SelectionRunRecord["schema_version"],
    ...input,
    status: "FINAL" as const,
    policy: {
      immutable_prediction: true as const,
      future_data_forbidden: true as const,
      audit_may_rewrite_prediction: false as const,
      auto_order: false as const,
    },
    storage: "GITHUB_ONLY" as const,
    recorded_at: recordedAt,
  };
  const contentHash = await hashWithout(base, ["recorded_at"]);
  const record: SelectionRunRecord = { ...base, content_hash: contentHash };
  await putIndexedImmutableRecord(env, {
    collection: COLLECTIONS[input.selection_type],
    key: selectionKey(input.selection_type, input.source_trade_date, input.target_session_date, input.selector_version),
    record,
    metadata: {
      selection_type: input.selection_type,
      source_trade_date: input.source_trade_date,
      target_session_date: input.target_session_date,
      selector_version: input.selector_version,
      selection_id: input.selection_id,
      content_hash: contentHash,
    },
    message: `selection: ${input.selection_type} ${input.source_trade_date}`,
  });
  return record;
}

export async function listSelectionRuns(env: Env, input: { selection_type: SelectionType; source_trade_date?: string; target_session_date?: string; limit?: number }) {
  return listIndexedRecords<SelectionRunRecord>(
    env,
    COLLECTIONS[input.selection_type],
    (entry: CollectionIndexEntry) => (!input.source_trade_date || entry.source_trade_date === input.source_trade_date)
      && (!input.target_session_date || entry.target_session_date === input.target_session_date),
    input.limit ?? 100,
  );
}

export async function recordSelectionOutcome(env: Env, input: Omit<SelectionOutcomeRecord, "schema_version" | "content_hash" | "recorded_at" | "storage">) {
  assertIsoDate(input.target_trade_date, "selection_outcome_trade_date_invalid");
  if (!input.selection_id || !/^[1-9]\d{3}$/.test(input.symbol) || !input.horizon) throw new Error("selection_outcome_identity_invalid");
  const recordedAt = new Date().toISOString();
  const base = {
    schema_version: SELECTION_OUTCOME_VERSION as SelectionOutcomeRecord["schema_version"],
    ...input,
    storage: "GITHUB_ONLY" as const,
    recorded_at: recordedAt,
  };
  const contentHash = await hashWithout(base, ["recorded_at"]);
  const record: SelectionOutcomeRecord = { ...base, content_hash: contentHash };
  await putIndexedImmutableRecord(env, {
    collection: OUTCOME_COLLECTION,
    key: outcomeKey(input),
    record,
    metadata: {
      selection_id: input.selection_id,
      selection_type: input.selection_type,
      symbol: input.symbol,
      horizon: input.horizon,
      target_trade_date: input.target_trade_date,
    },
    message: `selection-outcome: ${input.selection_id} ${input.symbol} ${input.horizon}`,
  });
  return record;
}

export async function recordSelectionAuditDelta(env: Env, input: Omit<SelectionAuditDeltaRecord, "schema_version" | "content_hash" | "recorded_at" | "storage" | "policy">) {
  assertIsoDate(input.source_trade_date, "selection_audit_trade_date_invalid");
  if (!input.audit_id) throw new Error("selection_audit_id_required");
  const recordedAt = new Date().toISOString();
  const base = {
    schema_version: SELECTION_AUDIT_VERSION as SelectionAuditDeltaRecord["schema_version"],
    ...input,
    policy: "AUDIT_ONLY_NEVER_REWRITE_SELECTION" as const,
    storage: "GITHUB_ONLY" as const,
    recorded_at: recordedAt,
  };
  const contentHash = await hashWithout(base, ["recorded_at"]);
  const record: SelectionAuditDeltaRecord = { ...base, content_hash: contentHash };
  await putIndexedImmutableRecord(env, {
    collection: AUDIT_COLLECTION,
    key: [input.source_trade_date, input.audit_id].join("\u0000"),
    record,
    metadata: { source_trade_date: input.source_trade_date, audit_id: input.audit_id, changed: input.changed },
    message: `selection-audit: ${input.source_trade_date}`,
  });
  return record;
}
