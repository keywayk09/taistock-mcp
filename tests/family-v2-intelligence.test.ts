import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFamilyElevenPointAnalysis } from "../src/v6/family-eleven-point.ts";
import { familyOpenApiV2 } from "../src/v6/family-openapi-v2.ts";
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
assert.equal(research.realtime_fusion.formal_chip, "OFFICIAL_EXACT_DATE_ON_DEMAND_CURRENT+PUBLISHED_HISTORY_CONTEXT");
assert.equal(research.realtime_fusion.broker_branch, "MONEYDJ_RANKED_ONLY_FAIL_SOFT");
assert.equal(research.realtime_fusion.warrant_activity, "OFFICIAL_NON_DIRECTIONAL_ACTIVITY_ONLY");
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
const ownerContentSource = fs.readFileSync(new URL("../src/v6/owner-content-handler.ts", import.meta.url), "utf8");
assert.match(indexSource, /handleFamilySmartRest/);
assert.match(ownerContentSource, /registerFamilyStockSelectionToolsV2/);
assert.ok(indexSource.indexOf("handleFamilySmartRest(request") < indexSource.indexOf("handleFamilyActionCompat(request"));
assert.doesNotMatch(ownerContentSource, /registerFamilyStockSelectionTools\(this\.server/);
const familySmartRestAllowlist = indexSource.match(/const FAMILY_SMART_REST_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
for (const path of ["/api/family/market-context", "/api/family/chips"]) {
  assert.ok(familySmartRestAllowlist.includes(`"${path}"`), `FAMILY_SMART_REST_PATHS must include ${path}`);
}

const smartRestSource = fs.readFileSync(new URL("../src/v6/family-smart-rest.ts", import.meta.url), "utf8");
for (const path of [
  "/api/family/query",
  "/api/family/market-context",
  "/api/family/chips",
  "/api/family/analyze",
  "/api/family/compare",
  "/api/family/screen",
  "/api/family/status",
]) {
  assert.ok(smartRestSource.includes(path));
}
assert.match(smartRestSource, /readFamilyStockMarketContext/);
assert.match(smartRestSource, /getTwMarketChipSummaryOnDemand/);
assert.doesNotMatch(smartRestSource, /getTwMarketChipSummaryPublished/);
assert.doesNotMatch(smartRestSource, /symbol:\s*undefined\s+as\s+never/);

const openapi = familyOpenApiV2("https://example.test") as any;
assert.equal(openapi.paths["/api/family/market-context"].post.operationId, "getFamilyStockMarketContext");
assert.equal(openapi.paths["/api/family/chips"].post.operationId, "getFamilyMarketChipSummary");
assert.equal(openapi.paths["/api/family/analyze"].post.operationId, "analyzeFamilyStock11Point");
assert.equal(openapi.paths["/api/family/compare"].post.operationId, "compareFamilyStocks11Point");
assert.equal(openapi.paths["/api/family/screen"].post.operationId, "screenFamilySwingCandidates");

const openapiSource = fs.readFileSync(new URL("../src/v6/family-openapi-v2.ts", import.meta.url), "utf8");
assert.match(openapiSource, /exact-date on-demand/i);
assert.match(openapiSource, /RANKED_ONLY/);
assert.match(openapiSource, /Published generation[^\n]*(?:historical|history|歷史|replay)/i);
assert.match(openapiSource, /非方向性|non-directional/i);
assert.doesNotMatch(openapiSource, /正式 Published 籌碼|正式Published籌碼|直接讀取正式 Published generation 籌碼/i);

console.log("family-v2-intelligence.test.ts: PASS");
