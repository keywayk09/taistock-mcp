import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RESEARCH_VNEXT_SHADOW_FACADE_VERSION,
  createResearchVNextShadowFacade,
} from "../src/v6/research-vnext/shadow-facade.ts";
import { summarizeReviewMetrics } from "../src/v6/research-vnext/compute/review-metrics.ts";
import { rankSwingCandidateEvidence, summarizeSwingOutcomeEvidence } from "../src/v6/research-vnext/compute/swing-evidence.ts";

assert.equal(RESEARCH_VNEXT_SHADOW_FACADE_VERSION, "research-vnext-shadow-facade/v1.0.0");

const facade = createResearchVNextShadowFacade({
  memoryAdapterOptions: { now: () => "2026-09-01T10:50:00.000Z" },
});

assert.deepEqual(facade.contract(), {
  schema: "RESEARCH_VNEXT_SHADOW_FACADE_CONTRACT_V1",
  version: RESEARCH_VNEXT_SHADOW_FACADE_VERSION,
  reasoning_owner: "GPT",
  backend_roles: ["DATA", "COMPUTE", "REPLAY", "EVIDENCE", "MEMORY"],
  direct_provider_access: "FORBIDDEN",
  ohlc_write: "FORBIDDEN",
  automatic_strategy_promotion: "FORBIDDEN",
  production_registration: "DISABLED",
});

const reviewRows = [{
  market: "tw-stock" as const,
  signal_id: "s1",
  signal_version: "v1",
  strategy: "S1",
  side: "SHORT",
  net_return_pct: 1.1,
  mfe_pct: 1.8,
  mae_pct: -0.4,
  ambiguous_intrabar: false,
  requires_1m_replay: false,
}];
assert.deepEqual(facade.summarizeReviewEvidence(reviewRows), summarizeReviewMetrics(reviewRows));

const swingSignals = [{
  signal_id: "sw1",
  signal_version: "v1",
  symbol: "2330",
  trade_date: "2026-09-01",
  side: "LONG",
  strategy: "L1",
  signal_ts_ms: 1,
  payload: { diamond_score: 88 },
}];
assert.deepEqual(facade.rankSwingEvidence(swingSignals, 5), rankSwingCandidateEvidence(swingSignals, 5));

const outcomes = [{ status: "OK", mfe_pct: 2, mae_pct: -1, path: [{ horizon: "D1", directional_close_return_pct: 1.2 }] }];
assert.deepEqual(facade.summarizeSwingOutcomes(outcomes), summarizeSwingOutcomeEvidence(outcomes));

assert.equal(typeof facade.resolveSelective1mReplay, "function");
assert.equal(typeof facade.memory.recordMarketJudgment, "function");
assert.equal(typeof facade.memory.recordJudgmentReview, "function");
assert.equal(typeof facade.memory.recordTradingKnowledge, "function");

const repoRoot = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src/v6/research-vnext/shadow-facade.ts"), "utf8");
const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(executable, /\.\.\/review-orchestrator|\.\.\/selective-1m-replay|\.\.\/gpt-judgment-memory/, "facade must not delegate to legacy research modules");
assert.doesNotMatch(executable, /research-tools|owner-content-handler|index-v6|registerTool|registerResearchTools/, "shadow facade must remain unregistered and outside Owner composition");
assert.doesNotMatch(executable, /\bfetch\s*\(/, "shadow facade must not access providers directly");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_SHADOW_FACADE_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_SHADOW_FACADE_VERSION,
  review_delegate: "VNEXT_ONLY",
  swing_delegate: "VNEXT_ONLY",
  replay_delegate: "VNEXT_ONLY",
  memory_delegate: "VNEXT_ONLY",
  production_registration: "DISABLED",
}, null, 2));
