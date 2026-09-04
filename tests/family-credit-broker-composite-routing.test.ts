import assert from "node:assert/strict";
import fs from "node:fs";
import { inferFamilyAdaptiveIntent, planFamilyQuery } from "../src/v6/family-adaptive-planner.ts";
import { resolveFamilyQuery } from "../src/v6/family-query-resolver.ts";

const query = "2408 2026-09-04 融資券/分點";
const resolved = resolveFamilyQuery(query);
assert.deepEqual(resolved.symbols, ["2408"]);
assert.equal(resolved.as_of_date, "2026-09-04");
assert.equal(resolved.is_broker_window_query, true);

assert.equal(
  inferFamilyAdaptiveIntent(query, ["2408"]),
  "CREDIT_SBL_BROKER_QUERY",
  "a focused query containing both credit/SBL and broker-branch intent must not fall through to QUICK_STOCK_QUESTION",
);
assert.equal(
  inferFamilyAdaptiveIntent("2408 融資券/分點", ["2408"]),
  "CREDIT_SBL_BROKER_QUERY",
  "the real terse user query must hit the same bounded composite route",
);

const plan = planFamilyQuery(query, ["2408"]);
assert.equal(plan.intent, "CREDIT_SBL_BROKER_QUERY");
assert.deepEqual(plan.preferred_reads, ["current_chip", "broker_branch"]);
assert.equal(plan.answer_depth, "QUICK");
assert.ok(!plan.preferred_reads.includes("open_world_web"), "composite fast path must not request Open Web");
assert.ok(!plan.preferred_reads.includes("canonical_ohlc"), "composite fast path must not fetch OHLC");
assert.ok(!plan.preferred_reads.includes("fundamentals"), "composite fast path must not fetch fundamentals");

const smartRest = fs.readFileSync("src/v6/family-smart-rest.ts", "utf8");
assert.match(smartRest, /CREDIT_SBL_BROKER_QUERY/);
assert.match(smartRest, /adaptive_credit_sbl_broker_query/);
assert.match(smartRest, /resolveTradingAsOf/);
assert.match(smartRest, /Promise\.all\s*\(/, "credit/SBL and broker reads should run in parallel after one shared as-of resolution");
assert.match(smartRest, /runFamilyCreditSblQueryFastPath/);
assert.match(smartRest, /runFamilyBrokerQueryFastPath/);
assert.match(smartRest, /windows:\s*compositeBrokerWindows/);
assert.match(smartRest, /web_fetch:\s*false/);
assert.match(smartRest, /broker_web_backfill:\s*false/);
assert.match(smartRest, /巢狀累計窗口|巢狀窗口|巢狀累計/);
assert.match(smartRest, /不得把.*每天持續買|不得把.*連續性/);

// Terse composite queries should provide the useful short/medium/long lens all
// the way through 120D. Explicit user horizons still win.
assert.match(smartRest, /\[1,\s*5,\s*10,\s*20,\s*60,\s*120\]/);
assert.match(smartRest, /hasExplicitBrokerWindow/);
assert.match(smartRest, /broker_window_render_contract/);
assert.match(smartRest, /broker_window_render_rows/);
assert.match(smartRest, /任何視窗都不得省略|每一個視窗/);

const brokerFastPath = fs.readFileSync("src/v6/family-broker-query-fast-path.ts", "utf8");
assert.match(brokerFastPath, /FAMILY_BROKER_WINDOW_RENDER_CONTRACT/);
assert.match(brokerFastPath, /buildFamilyBrokerWindowRenderRows/);
assert.match(brokerFastPath, /PENDING\/ERROR\/UNAVAILABLE.*必須列出|禁止省略任何requested window/);

const openApi = fs.readFileSync("src/v6/family-openapi-v2.ts", "utf8");
assert.match(openApi, /兩者同時詢問|同時詢問融資融券\/借券與券商分點/);
assert.match(openApi, /禁止 Web 補洞|不得再用 Open Web/);
assert.match(openApi, /120/);
assert.match(openApi, /不得省略|完整呈現|逐一呈現/);

console.log("family credit/SBL + broker composite routing/render contract passed");
