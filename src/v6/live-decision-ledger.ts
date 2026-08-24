import { putIndexedImmutableRecord, readIndexedRecord, listIndexedRecords, sha256Hex, stableJson, type CollectionIndexEntry } from "./github-data-store.ts";

export const LIVE_DECISION_LEDGER_VERSION = "diamond-live-decision-ledger/v1.0.0";
export type LiveDecisionState = "LONG_WATCH" | "SHORT_WATCH" | "WAIT" | "SKIP" | "LONG_CONFIRMED" | "SHORT_CONFIRMED" | "INVALIDATED";

export type LiveDecisionRecord = {
  schema_version: typeof LIVE_DECISION_LEDGER_VERSION;
  decision_id: string;
  decision_version: string;
  trade_date: string;
  symbol: string;
  observed_at: string;
  observed_at_ms: number;
  knowledge_cutoff_ts_ms: number;
  data_watermark_ts_ms: number;
  state: LiveDecisionState;
  prior_decision_id: string | null;
  source_selection_ids: string[];
  market_context: Record<string, unknown>;
  features: Record<string, unknown>;
  reason_codes: string[];
  invalidation_conditions: string[];
  note: string | null;
  policy: {
    manual_entry_only: true;
    may_rewrite_nightly_selection: false;
    immutable_event: true;
  };
  content_hash: string;
  recorded_at: string;
  storage: "GITHUB_ONLY";
};

const COLLECTION = "research/selection/live-decision";

function key(decisionId: string, version: string) {
  return `${decisionId}\u0000${version}`;
}

export async function getLiveDecision(env: Env, decisionId: string, decisionVersion: string) {
  return readIndexedRecord<LiveDecisionRecord>(env, COLLECTION, key(decisionId, decisionVersion));
}

export async function recordLiveDecision(env: Env, input: {
  decision_id: string;
  decision_version?: string;
  trade_date: string;
  symbol: string;
  observed_at: string;
  observed_at_ms: number;
  knowledge_cutoff_ts_ms: number;
  data_watermark_ts_ms: number;
  state: LiveDecisionState;
  prior_decision_id?: string | null;
  source_selection_ids?: string[];
  market_context?: Record<string, unknown>;
  features?: Record<string, unknown>;
  reason_codes?: string[];
  invalidation_conditions?: string[];
  note?: string | null;
}) {
  const version = input.decision_version ?? LIVE_DECISION_LEDGER_VERSION;
  if (!input.decision_id || !/^20\d{2}-\d{2}-\d{2}$/.test(input.trade_date) || !/^[1-9]\d{3}$/.test(input.symbol)) throw new Error("live_decision_identity_invalid");
  if (!Number.isFinite(input.observed_at_ms) || !Number.isFinite(input.knowledge_cutoff_ts_ms) || !Number.isFinite(input.data_watermark_ts_ms)) throw new Error("live_decision_time_invalid");
  if (input.data_watermark_ts_ms > input.knowledge_cutoff_ts_ms) throw new Error("live_decision_data_after_knowledge_cutoff");
  if (input.knowledge_cutoff_ts_ms > input.observed_at_ms) throw new Error("live_decision_knowledge_after_observation");
  const recordedAt = new Date().toISOString();
  const base = {
    schema_version: LIVE_DECISION_LEDGER_VERSION,
    decision_id: input.decision_id,
    decision_version: version,
    trade_date: input.trade_date,
    symbol: input.symbol,
    observed_at: input.observed_at,
    observed_at_ms: input.observed_at_ms,
    knowledge_cutoff_ts_ms: input.knowledge_cutoff_ts_ms,
    data_watermark_ts_ms: input.data_watermark_ts_ms,
    state: input.state,
    prior_decision_id: input.prior_decision_id ?? null,
    source_selection_ids: [...new Set(input.source_selection_ids ?? [])].sort(),
    market_context: input.market_context ?? {},
    features: input.features ?? {},
    reason_codes: [...new Set(input.reason_codes ?? [])],
    invalidation_conditions: [...new Set(input.invalidation_conditions ?? [])],
    note: input.note ?? null,
    policy: {
      manual_entry_only: true as const,
      may_rewrite_nightly_selection: false as const,
      immutable_event: true as const,
    },
    storage: "GITHUB_ONLY" as const,
    recorded_at: recordedAt,
  };
  const hashBase: Record<string, unknown> = { ...base };
  delete hashBase.recorded_at;
  const contentHash = await sha256Hex(stableJson(hashBase));
  const record: LiveDecisionRecord = { ...base, content_hash: contentHash };
  await putIndexedImmutableRecord(env, {
    collection: COLLECTION,
    key: key(input.decision_id, version),
    record,
    metadata: { trade_date: input.trade_date, symbol: input.symbol, state: input.state, decision_id: input.decision_id, decision_version: version },
    message: `live-decision: ${input.trade_date} ${input.symbol} ${input.state}`,
  });
  return record;
}

export async function listLiveDecisions(env: Env, input: { trade_date?: string; symbol?: string; limit?: number }) {
  return listIndexedRecords<LiveDecisionRecord>(env, COLLECTION, (entry: CollectionIndexEntry) =>
    (!input.trade_date || entry.trade_date === input.trade_date) && (!input.symbol || entry.symbol === input.symbol), input.limit ?? 100);
}
