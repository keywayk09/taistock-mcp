import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RESEARCH_VNEXT_MEMORY_IMPLEMENTATION_VERSION,
  ResearchVNextMemoryError,
  prepareJudgmentReviewMemoryRecord,
  prepareMarketJudgmentMemoryRecord,
  prepareTradingKnowledgeMemoryRecord,
} from "../src/v6/research-vnext/memory/memory-core.ts";

const RECORDED_AT = "2026-09-01T10:40:00.000Z";
const JUDGMENT_TS = Date.parse("2026-09-01T01:35:00.000Z"); // 09:35 Asia/Taipei
const CUTOFF_TS = JUDGMENT_TS - 60_000;
const WATERMARK_TS = CUTOFF_TS - 60_000;

function validJudgment() {
  return {
    judgment_id: "j-2330-20260901-0935",
    judgment_version: "v1",
    market: "TW_STOCK" as const,
    symbol: "2330",
    timeframe: "5m" as const,
    trade_date: "2026-09-01",
    judgment_ts_ms: JUDGMENT_TS,
    knowledge_cutoff_ts_ms: CUTOFF_TS,
    data_watermark_ts_ms: WATERMARK_TS,
    direction: "BULLISH" as const,
    confidence: 71,
    thesis: "Price structure is constructive; GPT owns the final interpretation.",
    risk_reward_score: 68,
    reasons: [
      { code: "volume", family: "flow", weight: 1.2, note: "expanding" },
      { code: "VOLUME", family: "flow", weight: 1.5, note: "latest wins by code" },
      { code: "structure", family: "price" },
    ],
    structures: ["higher_low", "range_break", "higher_low"],
    support_levels: [101, 99, 101],
    resistance_levels: [110, 108, 110],
    patterns: [{
      pattern_id: "p1",
      pattern_type: "ascending_triangle",
      status: "FORMING" as const,
      confidence: 65,
      detected_at_ts_ms: CUTOFF_TS,
      upper_boundary: 108,
      lower_boundary: 101,
      volume_behavior: "CONTRACTING" as const,
    }],
    trendlines: [{
      trendline_id: "t1",
      type: "SUPPORT_TRENDLINE" as const,
      status: "ACTIVE" as const,
      quality: "HIGH" as const,
      anchors: [
        { ts_ms: CUTOFF_TS - 120_000, price: 99, anchor_type: "SWING_LOW" as const },
        { ts_ms: CUTOFF_TS - 60_000, price: 101, anchor_type: "SWING_LOW" as const },
      ],
      touch_count: 2,
    }],
    payload: { source: "gpt", note: undefined },
  };
}

async function errorCode(run: () => Promise<unknown>) {
  try {
    await run();
    return "NO_ERROR";
  } catch (error) {
    assert.ok(error instanceof ResearchVNextMemoryError);
    return error.code;
  }
}

assert.equal(RESEARCH_VNEXT_MEMORY_IMPLEMENTATION_VERSION, "research-vnext-memory-core/v1.0.0");

const judgmentA = await prepareMarketJudgmentMemoryRecord(validJudgment(), RECORDED_AT);
const judgmentB = await prepareMarketJudgmentMemoryRecord(validJudgment(), RECORDED_AT);
assert.deepEqual(judgmentA, judgmentB, "memory preparation must be deterministic for explicit inputs");
assert.equal(judgmentA.record.schema_version, "diamond-gpt-judgment/v1");
assert.equal(judgmentA.record.storage, "GITHUB_ONLY");
assert.equal(judgmentA.record.recorded_at, RECORDED_AT);
assert.match(judgmentA.content_hash, /^[0-9a-f]{64}$/);
assert.deepEqual(judgmentA.record.structures, ["higher_low", "range_break"]);
assert.deepEqual(judgmentA.record.support_levels, [99, 101]);
assert.deepEqual(judgmentA.record.resistance_levels, [108, 110]);
assert.deepEqual(judgmentA.record.reasons.map((x: { code: string }) => x.code), ["STRUCTURE", "VOLUME"]);
assert.equal(judgmentA.record.reasons.find((x: { code: string }) => x.code === "VOLUME")?.weight, 1.5);
assert.equal(judgmentA.collection, "research/gpt-judgments");
assert.equal(judgmentA.key, "j-2330-20260901-0935\u0000v1");

const changedJudgment = await prepareMarketJudgmentMemoryRecord({ ...validJudgment(), thesis: "changed" }, RECORDED_AT);
assert.notEqual(changedJudgment.content_hash, judgmentA.content_hash, "semantic content change must change content hash");

assert.equal(await errorCode(() => prepareMarketJudgmentMemoryRecord({ ...validJudgment(), data_watermark_ts_ms: JUDGMENT_TS + 1 }, RECORDED_AT)), "LOOKAHEAD_BIAS");
assert.equal(await errorCode(() => prepareMarketJudgmentMemoryRecord({ ...validJudgment(), trade_date: "2026-08-31" }, RECORDED_AT)), "TRADE_DATE_MISMATCH");
assert.equal(await errorCode(() => prepareMarketJudgmentMemoryRecord({ ...validJudgment(), patterns: [{ ...validJudgment().patterns[0], detected_at_ts_ms: CUTOFF_TS + 1 }] }, RECORDED_AT)), "LOOKAHEAD_BIAS");
assert.equal(await errorCode(() => prepareMarketJudgmentMemoryRecord({ ...validJudgment(), trendlines: [{ ...validJudgment().trendlines[0], anchors: [{ ...validJudgment().trendlines[0].anchors[0] }, { ...validJudgment().trendlines[0].anchors[1], ts_ms: CUTOFF_TS + 1 }] }] }, RECORDED_AT)), "LOOKAHEAD_BIAS");

const review = await prepareJudgmentReviewMemoryRecord({
  review_id: "r1",
  review_version: "v1",
  judgment_id: judgmentA.record.judgment_id,
  judgment_version: judgmentA.record.judgment_version,
  dataset: {
    dataset_id: "d1",
    dataset_version: `sha256:${"a".repeat(64)}`,
    dataset_hash: "a".repeat(64),
    market: "tw-stock" as const,
    symbol: "2330",
    timeframe: "5m" as const,
    frozen_view: true,
    complete_view: true,
    truncated: false,
    formal_research_eligible: true,
  },
  outcome_horizon: "D1",
  outcome_ts_ms: JUDGMENT_TS + 86_400_000,
  return_pct: 1.2,
  mfe_pct: 2.4,
  mae_pct: -0.7,
  direction_correct: true,
  location_quality: "GOOD" as const,
  timing_quality: "FAIR" as const,
  optimization_hypotheses: [{ hypothesis: "GPT-authored hypothesis", expected_effect: "test later", risk: "small sample" }],
  interpretation: "GPT-authored review interpretation",
}, judgmentA.record, RECORDED_AT);
assert.equal(review.record.schema_version, "diamond-gpt-judgment-review/v1");
assert.equal(review.record.market, "TW_STOCK");
assert.equal(review.record.symbol, "2330");
assert.equal(review.record.optimization_hypotheses[0].hypothesis, "GPT-authored hypothesis");
assert.equal(review.learning_policy, "REVIEW_DOES_NOT_MUTATE_STRATEGY");
assert.equal(review.collection, "research/gpt-judgment-reviews");

assert.equal(await errorCode(() => prepareJudgmentReviewMemoryRecord({
  review_id: "bad-review",
  review_version: "v1",
  judgment_id: judgmentA.record.judgment_id,
  judgment_version: judgmentA.record.judgment_version,
  dataset: { ...review.record.dataset, formal_research_eligible: false },
  outcome_horizon: "D1",
  outcome_ts_ms: JUDGMENT_TS + 86_400_000,
  return_pct: 1,
  direction_correct: true,
  interpretation: "x",
}, judgmentA.record, RECORDED_AT)), "DATASET_NOT_ELIGIBLE");

const knowledge = await prepareTradingKnowledgeMemoryRecord({
  knowledge_id: "k1",
  knowledge_version: "v1",
  market_scope: "TW_STOCK" as const,
  topic: "breakout quality",
  statement: "GPT review hypothesis awaiting validation.",
  status: "HYPOTHESIS" as const,
  evidence_count: 1,
  evidence_refs: [{ judgment_id: judgmentA.record.judgment_id, judgment_version: judgmentA.record.judgment_version, review_id: review.record.review_id, review_version: review.record.review_version }],
  actor_type: "GPT_REVIEW" as const,
}, RECORDED_AT);
assert.equal(knowledge.record.schema_version, "diamond-trading-knowledge/v1");
assert.equal(knowledge.record.topic, "BREAKOUT QUALITY");
assert.equal(knowledge.production_promotion, "FORBIDDEN");
assert.equal(knowledge.collection, "research/gpt-trading-knowledge");

assert.equal(await errorCode(() => prepareTradingKnowledgeMemoryRecord({
  knowledge_id: "k2",
  knowledge_version: "v1",
  market_scope: "TW_STOCK",
  topic: "accepted rule",
  statement: "must require human",
  status: "ACCEPTED",
  evidence_count: 10,
  actor_type: "GPT_REVIEW",
  human_approved: true,
}, RECORDED_AT)), "HUMAN_APPROVAL_REQUIRED");

const repoRoot = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src/v6/research-vnext/memory/memory-core.ts"), "utf8");
const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(executableSource, /github-data-store|putIndexedImmutableRecord|readIndexedRecord|listIndexedRecords|readCollectionIndex/i, "memory core must not own persistence");
assert.doesNotMatch(executableSource, /\bfetch\s*\(/, "memory core must not own providers");
assert.doesNotMatch(executableSource, /Date\.now\s*\(|new Date\s*\(/, "memory core must use explicit recorded_at input");
assert.doesNotMatch(executableSource, /recordMarketJudgment|recordJudgmentReview|recordTradingKnowledge/, "VNext memory core must not delegate to legacy memory runtime");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_MEMORY_CORE_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_MEMORY_IMPLEMENTATION_VERSION,
  judgment_guards: 4,
  review_guards: 1,
  knowledge_guards: 1,
  persistence_boundary: "ADAPTER_ONLY",
  reasoning_owner: "GPT",
  production_registration: "UNCHANGED",
}, null, 2));
