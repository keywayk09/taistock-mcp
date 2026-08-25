import assert from "node:assert/strict";
import test from "node:test";
import {
  recordSelectionEvidence,
  recordSelectionRun,
  getSelectionRun,
  listSelectionRuns,
} from "../src/v6/selection-journal.ts";
import { recordLiveDecision, getLiveDecision } from "../src/v6/live-decision-ledger.ts";
import type { MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";

function env() {
  return { __GITHUB_DATA_MEMORY: new Map() as MemoryGitHubDataStore } as Env & { __GITHUB_DATA_MEMORY: MemoryGitHubDataStore };
}

function isImmutableConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "IMMUTABLE_CONFLICT");
}

async function evidence(e: Env) {
  return recordSelectionEvidence(e, {
    evidence_id: "evidence-20260824-full",
    source_trade_date: "2026-08-24",
    slot: "FULL_2230",
    generated_at: "2026-08-24T14:30:00.000Z",
    generated_at_ms: Date.parse("2026-08-24T14:30:00.000Z"),
    knowledge_cutoff_ts_ms: Date.parse("2026-08-24T14:30:00.000Z"),
    data_watermark_ts_ms: Date.parse("2026-08-24T14:29:00.000Z"),
    source_manifest_path: "data/market-data/daily/2026/08/24/manifest.json",
    source_manifest_sha: "manifest-sha",
    source_manifest_projection_hash: "projection-hash",
    source_refs: [{ kind: "institutional", market: "listed", path: "snapshot.json", dataset_version: "v1", content_sha256: "abc", row_count: 1 }],
    market_snapshot: { source_contract: "tw-full-market-source-contract/v1.0.0", retrieved_at: "2026-08-24T14:29:00.000Z", listed_count: 500, otc_count: 300, quote_trade_date: "2026-08-24" },
    completeness: { status: "READY", required_layers: ["institutional:listed"], ready_layers: ["institutional:listed"], optional_missing_layers: [] },
    universe_feature_schema: "test/v1",
    universe_features: [{ symbol: "2330", name: "台積電", market: "TWSE", trade_value_rank: 1 }],
  });
}

test("selection evidence is idempotent but immutable", async () => {
  const e = env();
  const first = await evidence(e);
  const second = await evidence(e);
  assert.equal(second.content_hash, first.content_hash);
});

test("selection run cannot be overwritten with a changed prediction", async () => {
  const e = env();
  const ev = await evidence(e);
  const base = {
    selection_id: "selection:swing:2026-08-24:test",
    selection_type: "SWING" as const,
    selector_version: "selector/v1",
    rule_hash: "rule-hash",
    source_trade_date: "2026-08-24",
    target_session_date: "2026-08-25",
    generated_at: "2026-08-24T14:31:00.000Z",
    generated_at_ms: Date.parse("2026-08-24T14:31:00.000Z"),
    knowledge_cutoff_ts_ms: Date.parse("2026-08-24T14:31:00.000Z"),
    data_watermark_ts_ms: Date.parse("2026-08-24T14:29:00.000Z"),
    evidence_ref: { evidence_id: ev.evidence_id, evidence_version: ev.schema_version, source_trade_date: ev.source_trade_date, slot: ev.slot, content_hash: ev.content_hash },
    universe_count: 1,
    candidate_count: 1,
    candidates: [{ rank: 1, symbol: "2330", name: "台積電", market: "TWSE" as const, side: "LONG" as const, tier: "A", score: 80, score_components: { technical: 80 }, reason_codes: ["TEST"], caution_codes: [], features: {} }],
    control_sample: [],
  };
  const first = await recordSelectionRun(e, base);
  assert.equal(first.candidates[0].score, 80);
  await assert.rejects(() => recordSelectionRun(e, { ...base, candidates: [{ ...base.candidates[0], score: 81 }] }), isImmutableConflict);
  const stored = await getSelectionRun(e, { selection_type: "SWING", source_trade_date: "2026-08-24", target_session_date: "2026-08-25", selector_version: "selector/v1" });
  assert.equal(stored?.candidates[0].score, 80);
});

test("swing and next-day intraday are physically separate journals", async () => {
  const e = env();
  const ev = await evidence(e);
  const common = {
    selector_version: "selector/v1",
    rule_hash: "rule-hash",
    source_trade_date: "2026-08-24",
    target_session_date: "2026-08-25",
    generated_at: "2026-08-24T14:31:00.000Z",
    generated_at_ms: Date.parse("2026-08-24T14:31:00.000Z"),
    knowledge_cutoff_ts_ms: Date.parse("2026-08-24T14:31:00.000Z"),
    data_watermark_ts_ms: Date.parse("2026-08-24T14:29:00.000Z"),
    evidence_ref: { evidence_id: ev.evidence_id, evidence_version: ev.schema_version, source_trade_date: ev.source_trade_date, slot: ev.slot, content_hash: ev.content_hash },
    universe_count: 1,
    candidate_count: 0,
    candidates: [],
    control_sample: [],
  };
  await recordSelectionRun(e, { ...common, selection_id: "swing-id", selection_type: "SWING" });
  await recordSelectionRun(e, { ...common, selection_id: "intraday-id", selection_type: "NEXT_DAY_INTRADAY" });
  assert.equal((await listSelectionRuns(e, { selection_type: "SWING" })).length, 1);
  assert.equal((await listSelectionRuns(e, { selection_type: "NEXT_DAY_INTRADAY" })).length, 1);
  assert.equal((await listSelectionRuns(e, { selection_type: "INTRADAY_REVIEW" })).length, 0);
});

test("future data is rejected by selection journal", async () => {
  const e = env();
  await assert.rejects(() => recordSelectionEvidence(e, {
    evidence_id: "bad",
    source_trade_date: "2026-08-24",
    slot: "EOD_1830",
    generated_at: "2026-08-24T10:30:00.000Z",
    generated_at_ms: 100,
    knowledge_cutoff_ts_ms: 90,
    data_watermark_ts_ms: 95,
    source_manifest_path: "x",
    source_manifest_sha: null,
    source_manifest_projection_hash: "x",
    source_refs: [],
    market_snapshot: { source_contract: "x", retrieved_at: "2026-08-24T10:30:00.000Z", listed_count: 1, otc_count: 1, quote_trade_date: "2026-08-24" },
    completeness: { status: "READY", required_layers: [], ready_layers: [], optional_missing_layers: [] },
    universe_feature_schema: "x",
    universe_features: [{ symbol: "2330" }],
  }), /selection_data_watermark_after_knowledge_cutoff/);
});

test("live decisions are immutable events and do not rewrite nightly selections", async () => {
  const e = env();
  const input = {
    decision_id: "20260824-100735-2330-long-watch",
    trade_date: "2026-08-24",
    symbol: "2330",
    observed_at: "2026-08-24T02:07:35.000Z",
    observed_at_ms: Date.parse("2026-08-24T02:07:35.000Z"),
    knowledge_cutoff_ts_ms: Date.parse("2026-08-24T02:07:35.000Z"),
    data_watermark_ts_ms: Date.parse("2026-08-24T02:07:34.000Z"),
    state: "LONG_WATCH" as const,
    reason_codes: ["VWAP_ABOVE", "VOLUME_EXPANSION"],
  };
  const first = await recordLiveDecision(e, input);
  const stored = await getLiveDecision(e, input.decision_id, first.decision_version);
  assert.equal(stored?.state, "LONG_WATCH");
  await assert.rejects(() => recordLiveDecision(e, { ...input, state: "SHORT_WATCH" as const }), isImmutableConflict);
});
