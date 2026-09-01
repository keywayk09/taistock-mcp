import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  selectSwingCandidates,
  summarizeSwingResults,
  swingScore,
  type SwingSignalLike,
} from "../src/v6/review-orchestrator.ts";
import {
  RESEARCH_VNEXT_SWING_EVIDENCE_VERSION,
  rankSwingCandidateEvidence,
  scoreSwingEvidence,
  summarizeSwingOutcomeEvidence,
} from "../src/v6/research-vnext/compute/swing-evidence.ts";

const signalFixtures: Array<{ name: string; signals: SwingSignalLike[]; limit: number }> = [
  {
    name: "score_priority_and_dedup",
    limit: 10,
    signals: [
      { signal_id: "s1", signal_version: "v1", symbol: "2330", trade_date: "2026-08-07", side: "LONG", strategy: "L2", signal_ts_ms: 1, payload: { diamond_score: 82 } },
      { signal_id: "s2", signal_version: "v1", symbol: "2330", trade_date: "2026-08-07", side: "LONG", strategy: "L2", signal_ts_ms: 2, payload: { diamond_score: 88 } },
      { signal_id: "s3", signal_version: "v1", symbol: "2454", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 3, payload: { probability: 0.91 } },
      { signal_id: "s4", signal_version: "v1", symbol: "2317", trade_date: "2026-08-07", side: "NEUTRAL", strategy: "X", signal_ts_ms: 4, payload: { diamond_score: 99 } },
      { signal_id: "s5", signal_version: "v1", symbol: "BAD", trade_date: "2026-08-07", side: "SHORT", strategy: "S1", signal_ts_ms: 5, payload: { swing_score: 100 } },
    ],
  },
  {
    name: "equal_score_prefers_newer_signal",
    limit: 10,
    signals: [
      { signal_id: "old", signal_version: "v1", symbol: "6209", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 100, payload: { confidence_score: 70 } },
      { signal_id: "new", signal_version: "v1", symbol: "6209", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 200, payload: { confidence_score: 70 } },
    ],
  },
  {
    name: "zero_limit_preserves_legacy_minimum_one",
    limit: 0,
    signals: [
      { signal_id: "a", signal_version: "v1", symbol: "2419", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 1, payload: {} },
      { signal_id: "b", signal_version: "v1", symbol: "2426", trade_date: "2026-08-07", side: "SHORT", strategy: "S1", signal_ts_ms: 2, payload: { probability: 0.5 } },
    ],
  },
];

const scoreFixtures: SwingSignalLike[] = [
  { signal_id: "score-swing", signal_version: "v1", symbol: "2330", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 1, payload: { swing_score: 77, diamond_score: 88, probability: 0.99 } },
  { signal_id: "score-diamond", signal_version: "v1", symbol: "2454", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 2, payload: { diamond_score: 88, probability: 0.99 } },
  { signal_id: "score-confidence", signal_version: "v1", symbol: "6209", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 3, payload: { confidence_score: 66 } },
  { signal_id: "score-probability", signal_version: "v1", symbol: "2419", trade_date: "2026-08-07", side: "LONG", strategy: "L1", signal_ts_ms: 4, payload: { probability: 0.73 } },
  { signal_id: "score-none", signal_version: "v1", symbol: "2426", trade_date: "2026-08-07", side: "SHORT", strategy: "S1", signal_ts_ms: 5, payload: {} },
];

const resultFixtures: Array<{ name: string; results: Array<Record<string, unknown>> }> = [
  { name: "empty", results: [] },
  {
    name: "mixed_outcomes",
    results: [
      { status: "OK", mfe_pct: 3.2, mae_pct: -1.1, path: [{ horizon: "D1", directional_close_return_pct: 1.2 }, { horizon: "D3", directional_close_return_pct: 2.4 }] },
      { status: "OK", mfe_pct: 1.4, mae_pct: -2.2, path: [{ horizon: "D1", directional_close_return_pct: -0.5 }, { horizon: "D3", directional_close_return_pct: 0.8 }] },
      { status: "FAILED", mfe_pct: 99, mae_pct: -99, path: [{ horizon: "D1", directional_close_return_pct: 99 }] },
    ],
  },
  {
    name: "day_alias_and_sorted_horizons",
    results: [
      { status: "OK", mfe_pct: 2, mae_pct: -1, path: [{ day: "D5", return_pct: 5 }, { day: "D1", return_pct: 1 }] },
    ],
  },
];

assert.equal(RESEARCH_VNEXT_SWING_EVIDENCE_VERSION, "research-vnext-swing-evidence/v1.0.0");

for (const signal of scoreFixtures) {
  assert.equal(scoreSwingEvidence(signal), swingScore(signal), `score shadow parity failed for ${signal.signal_id}`);
}

for (const fixture of signalFixtures) {
  assert.deepEqual(
    rankSwingCandidateEvidence(fixture.signals, fixture.limit),
    selectSwingCandidates(fixture.signals, fixture.limit),
    `candidate evidence shadow parity failed for ${fixture.name}`,
  );
}

for (const fixture of resultFixtures) {
  const legacy = summarizeSwingResults(fixture.results);
  const vnext = summarizeSwingOutcomeEvidence(fixture.results);
  assert.deepEqual(vnext, legacy, `swing outcome shadow parity failed for ${fixture.name}`);
  const serialized = JSON.stringify(vnext);
  assert.equal(serialized.includes("hypoth"), false, `${fixture.name}: swing evidence must not emit hypotheses`);
  assert.equal(serialized.includes("observations"), false, `${fixture.name}: swing evidence must not emit observations`);
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "src/v6/research-vnext/compute/swing-evidence.ts");
const source = fs.readFileSync(sourcePath, "utf8");
assert.equal(source.includes("review-orchestrator"), false, "VNext swing evidence must be independent from the legacy orchestrator implementation");
assert.equal(source.includes("buildReviewInterpretation"), false, "VNext swing evidence must not own GPT interpretation logic");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_SWING_SHADOW_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_SWING_EVIDENCE_VERSION,
  score_cases: scoreFixtures.length,
  ranking_cases: signalFixtures.length,
  outcome_cases: resultFixtures.length,
  parity: "STRICT_DEEP_EQUAL",
  reasoning_owner: "GPT",
  production_registration: "UNCHANGED",
}, null, 2));
