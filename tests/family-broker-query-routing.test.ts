import assert from "node:assert/strict";
import fs from "node:fs";
import {
  extractFamilyQuerySymbols,
  inferFamilyAdaptiveIntent,
  planFamilyQuery,
} from "../src/v6/family-adaptive-planner.ts";

// RED regression: an ISO date must never leak its year into the Taiwan-stock
// symbol set. The current implementation returns ["2330", "2026"], which then
// promotes a one-stock broker question into STOCK_COMPARE and the heavy analysis
// graph.
assert.deepEqual(
  extractFamilyQuerySymbols("查 2330 2026-09-04 券商分點"),
  ["2330"],
  "date year must be masked before symbol extraction",
);
assert.deepEqual(
  extractFamilyQuerySymbols("查 2330 2026/09/04 分點"),
  ["2330"],
  "slash-form date year must be masked before symbol extraction",
);
assert.deepEqual(
  extractFamilyQuerySymbols("查 2330 2026.09.04 買超分點"),
  ["2330"],
  "dot-form date year must be masked before symbol extraction",
);
assert.deepEqual(
  extractFamilyQuerySymbols("2026-09-04 台股為什麼跌"),
  [],
  "market date must not become a stock symbol",
);
assert.deepEqual(extractFamilyQuerySymbols("比較 2330 2317"), ["2330", "2317"]);

// The broker question needs its own lightweight intent. It must be resolved
// before generic one-stock analysis, while real multi-stock comparisons remain
// STOCK_COMPARE.
assert.equal(
  inferFamilyAdaptiveIntent("查 2330 2026-09-04 券商分點", ["2330"]),
  "BROKER_WINDOW_QUERY",
);
assert.equal(inferFamilyAdaptiveIntent("比較 2330 2317", ["2330", "2317"]), "STOCK_COMPARE");
assert.equal(inferFamilyAdaptiveIntent("2330 完整分析", ["2330"]), "FULL_STOCK_ANALYSIS");
assert.equal(inferFamilyAdaptiveIntent("2026-09-04 台股為什麼跌", []), "MARKET_CONTEXT");

const brokerPlan = planFamilyQuery("查 2330 2026-09-04 券商分點，列出1日、5日、10日、20日、60日", ["2330"]);
assert.equal(brokerPlan.intent, "BROKER_WINDOW_QUERY");
assert.equal(brokerPlan.answer_depth, "QUICK");
assert.ok(brokerPlan.preferred_reads.includes("broker_branch"));
assert.ok(!brokerPlan.preferred_reads.includes("canonical_ohlc"), "broker fast path must not require OHLC");
assert.ok(!brokerPlan.preferred_reads.includes("jin10_events"), "broker fast path must not require Jin10");

// After the first regression is fixed, the shared resolver must expose the
// normalized date and requested MoneyDJ server-ranked windows. This import is
// intentionally after the RED assertions so today's failure proves the actual
// 2026-as-symbol bug first rather than merely a missing new file.
const { resolveFamilyQuery } = await import("../src/v6/family-query-resolver.ts");

const oneDay = resolveFamilyQuery("查 2330 2026-09-03 券商分點");
assert.equal(oneDay.as_of_date, "2026-09-03");
assert.deepEqual(oneDay.symbols, ["2330"]);
assert.equal(oneDay.is_broker_window_query, true);
assert.deepEqual(oneDay.broker_windows, [1]);

const allWindows = resolveFamilyQuery("查 2330 2026-09-04 券商分點，列出 1日、5日、10日、20日、60日");
assert.equal(allWindows.as_of_date, "2026-09-04");
assert.deepEqual(allWindows.symbols, ["2330"]);
assert.deepEqual(allWindows.broker_windows, [1, 5, 10, 20, 60]);

const impliedOneDayPlusWindows = resolveFamilyQuery("查 2330 2026-09-03 券商分點，並列出 5日、10日、20日、60日");
assert.equal(impliedOneDayPlusWindows.as_of_date, "2026-09-03");
assert.deepEqual(impliedOneDayPlusWindows.broker_windows, [1, 5, 10, 20, 60]);

const slashDate = resolveFamilyQuery("查 2330 2026/09/04 分點");
assert.equal(slashDate.as_of_date, "2026-09-04");
assert.deepEqual(slashDate.symbols, ["2330"]);
const dotDate = resolveFamilyQuery("查 2330 2026.09.04 分點");
assert.equal(dotDate.as_of_date, "2026-09-04");
assert.deepEqual(dotDate.symbols, ["2330"]);

const marketOnly = resolveFamilyQuery("2026-09-04 台股為什麼跌");
assert.deepEqual(marketOnly.symbols, []);
assert.equal(marketOnly.as_of_date, "2026-09-04");
assert.equal(marketOnly.is_broker_window_query, false);

// Route-contract guards: broker questions must branch before the heavy Family
// analysis graph, reuse the existing bounded broker-window service, preserve the
// frozen public ingress/tool schema, and never introduce a new public tool.
const smartRest = fs.readFileSync("src/v6/family-smart-rest.ts", "utf8");
const familyCompat = fs.readFileSync("src/v6/family-action-compat.ts", "utf8");
const familyMcp = fs.readFileSync("src/v6/family-mcp.ts", "utf8");
const brokerRuntime = fs.readFileSync("src/v6/tw-broker-ranked-on-demand.ts", "utf8");

assert.match(smartRest, /resolveFamilyQuery/);
assert.match(smartRest, /adaptive_broker_window_query/);
assert.match(smartRest, /runFamilyBrokerQueryFastPath/);
const brokerRouteIndex = smartRest.indexOf('route: "adaptive_broker_window_query"');
const heavyAnalysisIndex = smartRest.indexOf("runSmartFamilyAnalysis(env, { symbols");
assert.ok(brokerRouteIndex >= 0 && heavyAnalysisIndex >= 0 && brokerRouteIndex < heavyAnalysisIndex,
  "broker fast path must execute before runSmartFamilyAnalysis");

assert.match(familyCompat, /resolveFamilyQuery/);
assert.match(familyMcp, /broker_multi_window/);
assert.match(familyMcp, /getTwBrokerRankedWindowBundleOnDemand|runFamilyMarketChipSummaryWithBrokerWindows/);

const familyChipSchema = familyMcp.match(
  /registerTool\("get_family_market_chip_summary",[\s\S]*?inputSchema:\s*\{([\s\S]*?)\n\s*\},\n\s*annotations:/,
)?.[1];
assert.ok(familyChipSchema, "Family chip tool schema must remain discoverable");
assert.match(familyChipSchema, /symbol:\s*symbolSchema/);
assert.match(familyChipSchema, /as_of:\s*dateSchema/);
assert.doesNotMatch(familyChipSchema, /windows?|period/i, "multi-window response must not change public Family tool input schema");
assert.doesNotMatch(familyMcp, /registerTool\("get_family_broker_/i, "do not add a new public Family broker tool");

assert.match(brokerRuntime, /getTwBrokerRankedWindowBundleOnDemand/);
assert.match(brokerRuntime, /origin_concurrency_limit:\s*3/);
assert.match(brokerRuntime, /CACHE_TTL_MS\s*=\s*10 \* 60 \* 1000/);
assert.match(brokerRuntime, /daily_rank_summing:\s*false/);
assert.match(brokerRuntime, /previous_day_substitution:\s*false/);

console.log("PASS Family broker query resolver + bounded fast path + frozen public contract");
