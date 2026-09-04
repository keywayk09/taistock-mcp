import assert from "node:assert/strict";
import fs from "node:fs";
import { inferFamilyAdaptiveIntent, planFamilyQuery } from "../src/v6/family-adaptive-planner.ts";
import { compactFamilyAnalysisForCustomGpt } from "../src/v6/family-custom-gpt-compact.ts";

const route = fs.readFileSync("src/v6/family-action-compat.ts", "utf8");
const smartRoute = fs.readFileSync("src/v6/family-smart-rest.ts", "utf8");
const entry = fs.readFileSync("src/index-v6.ts", "utf8");

assert.match(route, /\/api\/family\/query/);
assert.match(route, /MOM_GPT_API_KEY/);
assert.match(route, /bearerAuthorized/);
assert.match(route, /runFamilyActionCompatQuery/);
assert.match(route, /getTwMarketChipSummaryOnDemand/);
assert.doesNotMatch(route, /getTwMarketChipSummaryPublished/);
assert.match(route, /calendar_days:\s*180/);
assert.match(route, /formal_ohlc:\s*false/);
assert.match(route, /writes_allowed:\s*false/);
assert.match(route, /broker_branch_finmind_dependency:\s*false/);
assert.match(route, /\/family-openapi\.json/);
assert.match(route, /\/privacy/);
assert.doesNotMatch(route, /env\.DB|D1Database|INSERT\s|UPDATE\s|DELETE\s/i);
assert.match(entry, /handleFamilyActionCompat\(request, env, url\)/);
assert.match(entry, /family_read_only_action:\s*"\/api\/family\/query"/);
assert.match(smartRoute, /compactFamilyAnalysisForCustomGpt/);
assert.match(smartRoute, /LEGACY_QUERY_NOW_ADAPTIVE_FAMILY_V3_COMPACT/);

// RED regression for the next lightweight chip route: focused financing / margin
// short / SBL questions must never enter the full Family analysis graph.
for (const query of [
  "查 2330 融資融券",
  "2330 融資龍卷的部分呢？借券放空呢",
  "查 2330 借券賣出",
  "查 2330 借卷放空 1日 5日 10日 20日 60日",
]) {
  assert.equal(
    inferFamilyAdaptiveIntent(query, ["2330"]),
    "CREDIT_SBL_QUERY",
    `focused credit/SBL query should use lightweight intent: ${query}`,
  );
}
assert.equal(
  inferFamilyAdaptiveIntent("2330 完整深入分析，融資融券與借券放空也要看", ["2330"]),
  "FULL_STOCK_ANALYSIS",
  "explicit full analysis must still own the whole research graph",
);
const creditPlan = planFamilyQuery("查 2330 2026-09-04 融資融券與借券放空 1日 5日 10日 20日 60日", ["2330"]);
assert.equal(creditPlan.intent, "CREDIT_SBL_QUERY");
assert.equal(creditPlan.answer_depth, "QUICK");
assert.deepEqual(creditPlan.preferred_reads, ["current_chip"]);
assert.match(smartRoute, /runFamilyCreditSblQueryFastPath/);
assert.match(smartRoute, /adaptive_credit_sbl_query/);
const creditRouteIndex = smartRoute.indexOf('route: "adaptive_credit_sbl_query"');
const heavyAnalysisIndex = smartRoute.indexOf("runSmartFamilyAnalysis(env, { symbols");
assert.ok(
  creditRouteIndex >= 0 && heavyAnalysisIndex >= 0 && creditRouteIndex < heavyAnalysisIndex,
  "credit/SBL fast path must execute before runSmartFamilyAnalysis",
);

const hugeRows = Array.from({ length: 500 }, (_, index) => ({
  date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
  value: "x".repeat(1_000),
}));
const jin10Items = Array.from({ length: 20 }, (_, index) => ({
  id: `j${index}`,
  time: `2026-08-29T${String(index % 24).padStart(2, "0")}:00:00+08:00`,
  title: `台積電事件 ${index}`,
  content: `台積電相關金十快訊 ${index} ${"內容".repeat(700)}`,
}));
const points = Array.from({ length: 11 }, (_, index) => ({
  id: index + 1,
  title: `研究點 ${index + 1}`,
  status: "READY",
  evidence: {
    summary: "證據".repeat(1_000),
    rows: hugeRows,
    nested: { text: "細節".repeat(1_000) },
  },
  research: { seed_queries: Array.from({ length: 50 }, () => "query".repeat(100)) },
}));

const compact = compactFamilyAnalysisForCustomGpt({
  service: "Taiwan Stock AI Family Read-Only API",
  version: "family-smart-analysis/test",
  route: "adaptive_stock_question",
  question: "2330 最近分點怎麼樣",
  as_of_date: "2026-09-04",
  resolved_symbols: ["2330"],
  adaptive_plan: { intent: "QUICK_STOCK_QUESTION", giant: hugeRows },
  family_policy: { jin10_events_read: "JIN10_MCP_READ_ONLY_FAIL_SOFT" },
  stock_analyses: [{
    symbol: "2330",
    company: { stock_id: "2330", stock_name: "台積電" },
    market_snapshot: { source: "FUGLE_DISPLAY_QUOTE", quote: { close: 2420 }, latest_daily_bar: { close: 2420 } },
    technical: { status: "READY", source: "FORMAL", summary: { trend: "UP" }, recent_daily_bars: hugeRows },
    chip: {
      ok: true,
      status: "READY",
      requested_as_of: "2026-09-04",
      preferred_current_evidence: "on_demand_current",
      on_demand_current: {
        status: "READY",
        layers: {
          institutional: { status: "READY", latest: { foreign_net: 1200 } },
          margin_short: { status: "READY", latest: { margin_change: 50 } },
        },
      },
      broker_branch_ranked: {
        status: "READY",
        completeness: "RANKED_ONLY",
        buys: [{ broker_branch: "新加坡商瑞銀", net_lots: 287 }],
        sells: [],
      },
      warrant_activity: { status: "READY", directionality: "NON_DIRECTIONAL_TURNOVER_ONLY" },
      data_quality: {
        current_exact_date_status: "READY",
        previous_day_substitution: false,
        broker_ranked_completeness: "RANKED_ONLY",
      },
    },
    fundamentals: {
      income_statement_rows: hugeRows,
      balance_sheet_rows: hugeRows,
      cashflow_rows: hugeRows,
    },
    stock_live_context: { trades: hugeRows, five_level_book: hugeRows },
    jin10_context: {
      ok: true,
      provider: "jin10-mcp",
      mode: "stock_events",
      read_only: true,
      persistence: "NONE",
      query_keywords: ["台積電"],
      entity_resolution: { source: "fugle-quote", symbol: "2330", company_name: "台積電", numeric_symbol_suppressed: true },
      flash: jin10Items,
      news: jin10Items,
      partial_errors: [],
    },
    eleven_point_analysis: { contract: "FIXED_1_TO_11_COMPLETE_TEMPLATE", coverage: { point_count: 11 }, points },
    decision_readiness: { jin10_context: true, current_chip: true },
    enrichment_diagnostics: { errors: [], fail_soft: true },
    family_intelligence: {
      jin10_context: { provider: "jin10-mcp" },
      monthly_revenue: { status: "READY", rows: hugeRows },
      accounting: { status: "READY", periods: hugeRows },
      official_valuation: { status: "READY", data: hugeRows },
    },
  }],
});

const serialized = JSON.stringify(compact);
assert.ok(Buffer.byteLength(serialized, "utf8") < 50_000, `compact response too large: ${Buffer.byteLength(serialized, "utf8")}`);
assert.equal(compact.response_meta.compact_for_custom_gpt, true);
assert.equal(compact.stock_analyses[0].jin10_context.provider, "jin10-mcp");
assert.deepEqual(compact.stock_analyses[0].jin10_context.query_keywords, ["台積電"]);
assert.equal(compact.stock_analyses[0].jin10_context.entity_resolution.company_name, "台積電");
assert.equal(compact.stock_analyses[0].jin10_context.entity_resolution.numeric_symbol_suppressed, true);
assert.ok(compact.stock_analyses[0].jin10_context.flash.length > 0);
assert.ok(compact.stock_analyses[0].jin10_context.flash.length <= 5);
assert.equal(compact.stock_analyses[0].chip.status, "READY");
assert.equal(compact.stock_analyses[0].chip.broker_branch_ranked.status, "READY");
assert.equal(compact.stock_analyses[0].chip.broker_branch_ranked.completeness, "RANKED_ONLY");
assert.equal(compact.stock_analyses[0].chip.broker_branch_ranked.buys[0].broker_branch, "新加坡商瑞銀");
assert.equal(compact.stock_analyses[0].eleven_point_analysis.points.length, 11);
assert.doesNotMatch(serialized, /recent_daily_bars|income_statement_rows|balance_sheet_rows|cashflow_rows|five_level_book/);

console.log("PASS legacy Family Custom GPT Action restored with bounded current-chip + Jin10 response");
