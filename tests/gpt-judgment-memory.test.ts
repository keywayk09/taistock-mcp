import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  appendImmutableJudgment,
  appendJudgmentReview,
  appendTradingKnowledge,
  buildJudgmentStats,
  createJudgmentSnapshot,
} from "../src/v6/gpt-judgment-memory";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const base = createJudgmentSnapshot({
  judgment_id: "J1",
  market: "TW_STOCK",
  symbol: "2330",
  judged_at: "2026-08-07T01:30:00.000Z",
  knowledge_cutoff: "2026-08-07T01:30:00.000Z",
  horizon: "SWING_5D",
  stance: "LONG",
  confidence_0_100: 72,
  thesis: "test",
  reason_codes: ["TREND", "SUPPORT"],
  risk_codes: ["BREAK_SUPPORT"],
  expected_path: "hold support then advance",
  invalidation: "close below support",
  evidence_refs: ["dataset://2330"],
  market_context: { regime: "risk_on" },
  structure: { trend: "HH_HL" },
  patterns: [{ type: "ASCENDING_TRIANGLE", detected_at: "2026-08-07T01:25:00.000Z", confidence_0_100: 70 }],
  trendlines: [{
    id: "TL1",
    type: "SUPPORT_TRENDLINE",
    timeframe: "5m",
    status: "ACTIVE",
    anchors: [
      { time: "2026-08-07T01:00:00.000Z", price: 100, type: "SWING_LOW", strength: 2 },
      { time: "2026-08-07T01:20:00.000Z", price: 101, type: "SWING_LOW", strength: 3 },
    ],
    touch_count: 2,
  }],
  prompt_policy_version: "test/v1",
});

const list = appendImmutableJudgment([], base);
assert.equal(list.length, 1);
assert.throws(() => appendImmutableJudgment(list, base), /duplicate judgment_id/);
assert.throws(() => createJudgmentSnapshot({ ...base, judgment_id: "J2", trendlines: [{ ...base.trendlines[0], anchors: [{ time: "2026-08-07T02:00:00.000Z", price: 99, type: "SWING_LOW" }] }] }), /future trendline anchor/);

const review = appendJudgmentReview([], {
  review_id: "R1",
  judgment_id: "J1",
  reviewed_at: "2026-08-10T00:00:00.000Z",
  review_version: "test/v1",
  grades: { DIRECTION: 1, LOCATION: 1, TIMING: 0, STRUCTURE: 1, PATTERN: 1, TRENDLINE: 1, RISK_REWARD: 0, CONFIDENCE: 0 },
  failure_modes: ["TIMING_EARLY"],
  missing_factors: [],
  overweighted_factors: [],
  candidate_hypotheses: ["wait confirmation"],
});
assert.equal(review.length, 1);

const stats = buildJudgmentStats([{ judgment: base, outcome: { direction_correct: true, return_value: 3.2, mfe: 5, mae: -1.1, unit: "PCT" }, review: review[0] }]);
assert.equal(stats.total, 1);
assert.equal(stats.by_reason[0].samples, 1);

const knowledge = appendTradingKnowledge([], {
  knowledge_id: "K1",
  created_at: "2026-08-10T00:00:00.000Z",
  status: "HYPOTHESIS",
  statement: "test hypothesis",
  evidence_refs: ["J1"],
  sample_size: 1,
  human_approved: false,
});
assert.equal(knowledge.length, 1);
assert.throws(() => appendTradingKnowledge([], { ...knowledge[0], knowledge_id: "K2", status: "ACCEPTED", human_approved: false }), /ACCEPTED requires explicit HUMAN approval/);

const tools = read("src/v6/gpt-judgment-tools.ts");
assert.match(tools, /ACCEPTED requires explicit HUMAN approval/);

const registry = read("src/v6/diamond-capability-p16.ts");
assert.match(registry, /Improve GPT trading cognition first/);
assert.match(registry, /DETERMINISTIC_TRENDLINE_ENGINE_THEN_TRADINGVIEW_INDICATOR/);
assert.match(registry, /future_anchor_or_pattern_in_judgment: "FORBIDDEN"/);
assert.match(registry, /mixed_stock_pct_and_txf_point_expectancy: "FORBIDDEN"/);
assert.match(registry, /gpt_self_accept_knowledge: "FORBIDDEN"/);

const researchTools = read("src/v6/research-tools.ts");
assert.match(researchTools, /registerGptJudgmentMemoryTools\(server, env\)/);

const index = read("src/index-v6.ts");
const versionMatch = index.match(/version: "(\d+)\.(\d+)\.(\d+)"/);
assert.ok(versionMatch, "Taiwan Stock AI version must be present");
const [, major, minor] = versionMatch;
assert.ok(Number(major) > 6 || (Number(major) === 6 && Number(minor) >= 14), "P16 requires Taiwan Stock AI >= 6.14.0");
const toolsMatch = index.match(/tools: (\d+)/);
assert.ok(toolsMatch && Number(toolsMatch[1]) >= 105, "P16 requires at least 105 MCP tools");

const migration = read("migrations/0005_gpt_judgment_memory.sql");
for (const table of ["gpt_judgments","gpt_judgment_reasons","gpt_judgment_trendlines","gpt_judgment_patterns","gpt_judgment_reviews","gpt_trading_knowledge"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

console.log("P16 GPT judgment / structure / pattern / trendline memory tests passed");