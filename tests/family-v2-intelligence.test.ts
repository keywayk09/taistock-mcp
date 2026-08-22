import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFamilyElevenPointAnalysis } from "../src/v6/family-eleven-point.ts";
import { familyResearchDirective } from "../src/v6/family-research-policy.ts";
import { normalizeFinMindMarketSnapshotV2, scoreFamilyCandidateV2 } from "../src/v6/family-stock-selection-v2.ts";

const eleven = buildFamilyElevenPointAnalysis({
  symbol: "2317",
  as_of_date: "2026-08-22",
  analysis: {
    company: { stock_id: "2317", stock_name: "鴻海", industry_category: "電子工業" },
    market_snapshot: { source: "FUGLE_DISPLAY_QUOTE", quote: { close: 220 } },
    technical: { status: "READY", summary: { score: 70 } },
    chip: { ok: true, status: "READY", layers: {} },
  },
  intelligence: {
    monthly_revenue: { status: "READY", latest: { yoy_percent: 12 } },
    accounting: { status: "READY", latest: { eps: 3 }, periods: [], flags: [], risk_score: 0, quality: "healthy" },
    official_valuation: { status: "READY", data: [{ pe_ratio: 15, pb_ratio: 1.8, dividend_yield_percent: 3 }] },
  },
  holding_distribution_rows: [],
  foreign_shareholding_rows: [],
  industry_chain_rows: [],
  all_stock_info_rows: [],
});
assert.equal(eleven.coverage.point_count, 11);
assert.equal(eleven.points.length, 11);
assert.deepEqual(eleven.points.map((point) => point.id), [1,2,3,4,5,6,7,8,9,10,11]);
assert.equal(eleven.contract, "FIXED_1_TO_11_COMPLETE_TEMPLATE");

const research = familyResearchDirective(["2317"]);
assert.equal(research.mode, "OPEN_WORLD_AUTONOMOUS_RESEARCH");
assert.equal(research.web_research.allowed, true);
assert.equal(research.web_research.fixed_site_allowlist, false);
assert.equal(research.web_research.fixed_keyword_limit, false);
assert.equal(research.web_research.autonomous_query_expansion, true);
assert.equal(research.realtime_fusion.intraday_primary.includes("FUGLE_QUOTE"), true);
assert.equal(research.realtime_fusion.formal_structure, "OHLC_MCP_ONLY");
assert.equal(research.realtime_fusion.formal_chip, "PUBLISHED_GENERATION_ONLY");
assert.equal(research.discovery_vs_ranking.web_discovery_allowed, true);
assert.equal(research.discovery_vs_ranking.official_rank_requires_engine_validation, true);

const snapshot = normalizeFinMindMarketSnapshotV2([
  { stock_id: "2317", date: "2026-08-21", close: 220, open: 218, max: 222, min: 216, spread: 2, Trading_money: 5_000_000_000 },
], [
  { stock_id: "2317", stock_name: "鴻海", type: "twse", industry_category: "電子工業" },
]);
assert.equal(snapshot.length, 1);
assert.equal(snapshot[0].symbol, "2317");
assert.equal(snapshot[0].snapshot_provider, "FINMIND_FALLBACK");

const scored = scoreFamilyCandidateV2({
  symbol: "2317",
  name: "鴻海",
  market: "TSE",
  sector: "電子工業",
  close: 220,
  change_percent: 1,
  trade_value: 5_000_000_000,
  technical_score: 80,
  return_20d_percent: 8,
  return_60d_percent: 15,
  annualized_volatility_60d_percent: 30,
  max_drawdown_percent: -12,
  atr14: 5,
  distance_to_sma20_atr: 1,
  distance_to_prior_20d_high_percent: -2,
  revenue_yoy_percent: 12,
} as any, "balanced");
assert.ok(scored.score > 0 && scored.score <= 100);
assert.ok(["GREEN_RESEARCH", "YELLOW_WAIT", "RED_SKIP"].includes(scored.bucket));

const indexSource = fs.readFileSync(new URL("../src/index-v6.ts", import.meta.url), "utf8");
assert.match(indexSource, /handleFamilySmartRest/);
assert.match(indexSource, /registerFamilyStockSelectionToolsV2/);
assert.ok(indexSource.indexOf("handleFamilySmartRest(request") < indexSource.indexOf("handleFamilyActionCompat(request"));
assert.doesNotMatch(indexSource, /registerFamilyStockSelectionTools\(this\.server/);

const smartRestSource = fs.readFileSync(new URL("../src/v6/family-smart-rest.ts", import.meta.url), "utf8");
for (const path of ["/api/family/analyze", "/api/family/compare", "/api/family/screen", "/api/family/status"]) {
  assert.ok(smartRestSource.includes(path));
}
assert.doesNotMatch(smartRestSource, /symbol:\s*undefined\s+as\s+never/);

const openapiSource = fs.readFileSync(new URL("../src/v6/family-openapi-v2.ts", import.meta.url), "utf8");
assert.match(openapiSource, /OPEN|open-world/i);
assert.match(openapiSource, /Fugle/i);

console.log("family-v2-intelligence.test.ts: PASS");
