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
assert.match(smartRest, /NESTED|巢狀累計窗口|巢狀窗口/);
assert.match(smartRest, /不得把.*每天持續買|不得把.*連續性/);

// A terse composite question has no explicit broker horizon. Preserve the
// useful 1/5/10/20/60 lens that the old smart-analysis answer exposed, but keep
// it inside the governed same-provider broker bundle rather than falling back to
// generic research/Web. Explicit broker windows still use the user's selection.
assert.match(smartRest, /\[1,\s*5,\s*10,\s*20,\s*60\]/);
assert.match(smartRest, /hasExplicitBrokerWindow/);

const openApi = fs.readFileSync("src/v6/family-openapi-v2.ts", "utf8");
assert.match(openApi, /兩者同時詢問|同時詢問融資融券\/借券與券商分點/);
assert.match(openApi, /禁止 Web 補洞|不得再用 Open Web/);

console.log("family credit/SBL + broker composite routing contract passed");
