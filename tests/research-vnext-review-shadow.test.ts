import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { summarizeReviewRows, type ReviewMetricRow } from "../src/v6/review-orchestrator.ts";
import {
  RESEARCH_VNEXT_REVIEW_METRICS_VERSION,
  summarizeReviewMetrics,
} from "../src/v6/research-vnext/compute/review-metrics.ts";

const fixtures: Array<{ name: string; rows: ReviewMetricRow[] }> = [
  {
    name: "empty",
    rows: [],
  },
  {
    name: "mixed_tw_stock_and_txf",
    rows: [
      { market: "tw-stock", signal_id: "a", signal_version: "1", strategy: "S2", side: "SHORT", net_return_pct: 1, mfe_pct: 2, mae_pct: -0.4, ambiguous_intrabar: false, requires_1m_replay: false },
      { market: "tw-stock", signal_id: "b", signal_version: "1", strategy: "S2", side: "SHORT", net_return_pct: -0.5, mfe_pct: 0.3, mae_pct: -1.1, ambiguous_intrabar: true, requires_1m_replay: true },
      { market: "txf", signal_id: "c", signal_version: "1", strategy: "TX1", side: "LONG", net_points: 20, mfe_points: 35, mae_points: 8, ambiguous_intrabar: false, requires_1m_replay: false },
    ],
  },
  {
    name: "wins_only_profit_factor_null",
    rows: [
      { market: "tw-stock", signal_id: "w1", signal_version: "1", strategy: "L1", side: "LONG", net_return_pct: 1.25, mfe_pct: 2.1, mae_pct: -0.2 },
      { market: "tw-stock", signal_id: "w2", signal_version: "1", strategy: "L1", side: "LONG", net_return_pct: 0.75, mfe_pct: 1.4, mae_pct: -0.1 },
    ],
  },
  {
    name: "losses_only_profit_factor_zero",
    rows: [
      { market: "tw-stock", signal_id: "l1", signal_version: "1", strategy: "S1", side: "SHORT", net_return_pct: -1.1, mfe_pct: 0.2, mae_pct: -1.5 },
      { market: "tw-stock", signal_id: "l2", signal_version: "1", strategy: "S1", side: "SHORT", net_return_pct: -0.4, mfe_pct: 0.1, mae_pct: -0.8 },
    ],
  },
  {
    name: "explicit_null_preserves_legacy_semantics",
    rows: [
      { market: "tw-stock", signal_id: "n1", signal_version: "1", strategy: "L2", side: "LONG", net_return_pct: null, mfe_pct: null, mae_pct: null },
      { market: "txf", signal_id: "n2", signal_version: "1", strategy: "TX2", side: "SHORT", net_points: null, mfe_points: null, mae_points: null },
    ],
  },
  {
    name: "breakdown_sorting_is_stable",
    rows: [
      { market: "tw-stock", signal_id: "z", signal_version: "1", strategy: "Z", side: "SHORT", net_return_pct: 0.2 },
      { market: "tw-stock", signal_id: "a", signal_version: "1", strategy: "A", side: "LONG", net_return_pct: -0.1 },
      { market: "txf", signal_id: "t", signal_version: "1", strategy: "TX", side: "LONG", net_points: 5 },
    ],
  },
];

assert.equal(RESEARCH_VNEXT_REVIEW_METRICS_VERSION, "research-vnext-review-metrics/v1.0.0");

for (const fixture of fixtures) {
  const legacy = summarizeReviewRows(fixture.rows);
  const vnext = summarizeReviewMetrics(fixture.rows);
  assert.deepEqual(vnext, legacy, `strict shadow parity failed for ${fixture.name}`);

  const serialized = JSON.stringify(vnext);
  assert.equal(serialized.includes("optimization_hypotheses"), false, `${fixture.name}: deterministic metrics must not emit hypotheses`);
  assert.equal(serialized.includes("observations"), false, `${fixture.name}: deterministic metrics must not emit observations`);
  assert.equal(serialized.includes("REVIEW_ONLY_NO_AUTO_STRATEGY_CHANGE"), false, `${fixture.name}: deterministic metrics must not own interpretation policy`);
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "src/v6/research-vnext/compute/review-metrics.ts");
const source = fs.readFileSync(sourcePath, "utf8");
assert.equal(source.includes("review-orchestrator"), false, "VNext review metrics must be an independent implementation, not a legacy delegate");
assert.equal(source.includes("buildReviewInterpretation"), false, "VNext deterministic compute must not absorb legacy interpretation logic");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_REVIEW_SHADOW_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_REVIEW_METRICS_VERSION,
  frozen_cases: fixtures.length,
  parity: "STRICT_DEEP_EQUAL",
  reasoning_owner: "GPT",
  production_registration: "UNCHANGED",
}, null, 2));
