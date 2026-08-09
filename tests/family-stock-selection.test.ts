import assert from "node:assert/strict";
import { scoreFamilyCandidate } from "../src/v6/family-stock-selection.ts";

const base = {
  symbol: "2330",
  name: "測試股",
  market: "TSE",
  sector: "半導體業",
  close: 100,
  change_percent: 1.5,
  trade_value: 500_000_000,
  technical_score: 80,
  return_20d_percent: 8,
  return_60d_percent: 18,
  annualized_volatility_60d_percent: 28,
  max_drawdown_percent: -12,
  atr14: 2.5,
  distance_to_sma20_atr: 0.8,
  distance_to_prior_20d_high_percent: -1.5,
  revenue_yoy_percent: 16,
};

const healthy = scoreFamilyCandidate(base, "balanced");
assert.ok(healthy.score >= 70, `expected healthy candidate >=70, got ${healthy.score}`);
assert.equal(healthy.bucket, "GREEN_RESEARCH");
assert.ok(healthy.reasons.length > 0);

const chased = scoreFamilyCandidate({
  ...base,
  change_percent: 8.5,
  return_20d_percent: 30,
  distance_to_sma20_atr: 3.2,
}, "balanced");
assert.equal(chased.bucket, "YELLOW_WAIT", "extended stock must not be promoted to direct research priority");
assert.ok(chased.cautions.some((text) => text.includes("追價") || text.includes("乖離") || text.includes("20日")));

const weak = scoreFamilyCandidate({
  ...base,
  technical_score: 30,
  trade_value: 25_000_000,
  return_60d_percent: -18,
  annualized_volatility_60d_percent: 72,
  max_drawdown_percent: -45,
  distance_to_prior_20d_high_percent: -20,
  revenue_yoy_percent: -25,
}, "stable");
assert.ok(weak.score < healthy.score);
assert.equal(weak.bucket, "RED_SKIP");

console.log("family-stock-selection tests passed");
