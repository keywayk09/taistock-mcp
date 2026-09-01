import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  RESEARCH_VNEXT_GITHUB_MEMORY_ADAPTER_VERSION,
  createResearchVNextGitHubMemoryAdapter,
} from "../src/v6/research-vnext/memory/github-memory-adapter.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });

const FIXED_NOW = "2026-09-01T10:45:00.000Z";
const JUDGMENT_TS = Date.parse("2026-09-01T01:35:00.000Z");
const env = { __GITHUB_DATA_MEMORY: new Map() } as Env & { __GITHUB_DATA_MEMORY: Map<string, { sha: string; text: string }> };
const adapter = createResearchVNextGitHubMemoryAdapter({ now: () => FIXED_NOW });

function judgment(thesis = "GPT-authored thesis") {
  return {
    judgment_id: "j-adapter-1",
    judgment_version: "v1",
    market: "TW_STOCK" as const,
    symbol: "2330",
    timeframe: "5m" as const,
    trade_date: "2026-09-01",
    judgment_ts_ms: JUDGMENT_TS,
    knowledge_cutoff_ts_ms: JUDGMENT_TS - 60_000,
    data_watermark_ts_ms: JUDGMENT_TS - 120_000,
    direction: "BULLISH" as const,
    confidence: 70,
    thesis,
  };
}

async function code(run: () => Promise<unknown>) {
  try { await run(); return "NO_ERROR"; }
  catch (error) { return String((error as { code?: unknown })?.code ?? "UNKNOWN_ERROR"); }
}

assert.equal(RESEARCH_VNEXT_GITHUB_MEMORY_ADAPTER_VERSION, "research-vnext-github-memory-adapter/v1.0.0");

const first = await adapter.recordMarketJudgment(env, judgment());
assert.equal(first.ok, true);
assert.equal(first.immutable, true);
assert.equal(first.idempotent, false);
assert.equal(first.storage, "GITHUB_ONLY");
assert.equal(first.recorded_at, FIXED_NOW);
assert.match(first.content_hash, /^[0-9a-f]{64}$/);

const second = await adapter.recordMarketJudgment(env, judgment());
assert.equal(second.idempotent, true, "identical replay must be idempotent");
assert.equal(second.content_hash, first.content_hash);

const loaded = await adapter.getMarketJudgment(env, "j-adapter-1", "v1");
assert.ok(loaded);
assert.equal(loaded?.thesis, "GPT-authored thesis");
assert.equal(loaded?.recorded_at, FIXED_NOW);

const listed = await adapter.listMarketJudgments(env, { market: "TW_STOCK", symbol: "2330", limit: 10 });
assert.equal(listed.count, 1);
assert.equal(listed.judgments[0].judgment_id, "j-adapter-1");

assert.equal(
  await code(() => adapter.recordMarketJudgment(env, judgment("conflicting thesis"))),
  "IMMUTABLE_CONFLICT",
  "same key with different content must fail closed",
);

const review = await adapter.recordJudgmentReview(env, {
  review_id: "r-adapter-1",
  review_version: "v1",
  judgment_id: "j-adapter-1",
  judgment_version: "v1",
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
  return_pct: 1.25,
  mfe_pct: 2.1,
  mae_pct: -0.6,
  direction_correct: true,
  optimization_hypotheses: [{ hypothesis: "GPT hypothesis only" }],
  interpretation: "GPT interpretation only",
});
assert.equal(review.ok, true);
assert.equal(review.learning_policy, "REVIEW_DOES_NOT_MUTATE_STRATEGY");
assert.equal(review.recorded_at, FIXED_NOW);

const knowledge = await adapter.recordTradingKnowledge(env, {
  knowledge_id: "k-adapter-1",
  knowledge_version: "v1",
  market_scope: "TW_STOCK",
  topic: "breakout quality",
  statement: "Keep as hypothesis until more evidence exists.",
  status: "HYPOTHESIS",
  evidence_count: 1,
  evidence_refs: [{ judgment_id: "j-adapter-1", judgment_version: "v1", review_id: "r-adapter-1", review_version: "v1" }],
  actor_type: "GPT_REVIEW",
});
assert.equal(knowledge.ok, true);
assert.equal(knowledge.production_promotion, "FORBIDDEN");
assert.equal(knowledge.recorded_at, FIXED_NOW);

const knowledgeList = await adapter.listTradingKnowledge(env, { market_scope: "TW_STOCK", status: "HYPOTHESIS", limit: 10 });
assert.equal(knowledgeList.count, 1);
assert.equal(knowledgeList.knowledge[0].knowledge_id, "k-adapter-1");

const repoRoot = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src/v6/research-vnext/memory/github-memory-adapter.ts"), "utf8");
const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.match(executable, /from\s+["'][^"']*memory-core\.ts["']/);
assert.match(executable, /from\s+["'][^"']*github-data-store\.ts["']/);
assert.doesNotMatch(executable, /\bfetch\s*\(/, "adapter must use canonical store instead of direct provider access");
assert.doesNotMatch(executable, /hypothesis\s*=|interpretation\s*=|buildReviewInterpretation/, "adapter must not synthesize GPT reasoning");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_GITHUB_MEMORY_ADAPTER_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_GITHUB_MEMORY_ADAPTER_VERSION,
  immutable_write: "PASS",
  idempotent_replay: "PASS",
  immutable_conflict: "PASS",
  review_persistence: "PASS",
  knowledge_persistence: "PASS",
  production_registration: "UNCHANGED",
}, null, 2));
