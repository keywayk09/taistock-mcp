import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const legacy = read("src/v8/family-stock-selection-v15.ts");
assert.match(legacy, /FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection\/production-v1\.6\.0"/);
assert.match(legacy, /tryFugleTickersMisOtc/);
assert.match(legacy, /FINMIND_FALLBACK/);

const previous = read("src/v8/family-stock-selection-v17.ts");
assert.match(previous, /FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection\/production-v1\.7\.0"/);
assert.match(previous, /MOPSFIN_COMPANY_MASTER_MIS_OTC/);

const intent = read("src/v8/family-selection-intent.ts");
assert.match(intent, /FamilySelectionObjective/);
assert.match(intent, /low_position_turning_up/);
assert.match(intent, /pullback_entry/);
assert.match(intent, /breakout_confirmed/);
assert.match(intent, /steady_trend/);
assert.match(intent, /aggressive_momentum/);
assert.match(intent, /低位階\|低檔\|底部\|低基期/);
assert.match(intent, /還沒漲\|還沒大漲/);
assert.match(intent, /剛轉強\|開始轉強\|起漲/);
assert.match(intent, /回檔\|拉回\|回踩\|回測/);
assert.match(intent, /export function inferFamilySelectionIntent/);
assert.match(intent, /export function scoreFamilyIntentFit/);
assert.match(intent, /range_position_120d_percent/);
assert.match(intent, /sma20_slope_5d_percent/);
assert.match(intent, /hard_mismatch/);

const selector = read("src/v8/family-stock-selection-v18.ts");
assert.match(selector, /FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection\/production-v1\.8\.0"/);
assert.match(selector, /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/);
assert.match(selector, /mopsfin\.twse\.com\.tw\/opendata\/t187ap03_O\.csv/);
assert.match(selector, /mis\.twse\.com\.tw\/stock\/api\/getStockInfo\.jsp/);
assert.match(selector, /MOPSFIN_COMPANY_MASTER_MIS_OTC/);
assert.match(selector, /FUGLE_HISTORICAL/);
assert.match(selector, /\/historical\/candles\/\$\{symbol\}/);
assert.match(selector, /inferFamilySelectionIntent/);
assert.match(selector, /scoreFamilyIntentFit/);
assert.match(selector, /return_5d_percent/);
assert.match(selector, /range_position_120d_percent/);
assert.match(selector, /sma20_slope_5d_percent/);
assert.match(selector, /distance_to_prior_60d_high_percent/);
assert.match(selector, /FULL_LIQUIDITY_SHORTLIST_INTENT_RANKING/);
assert.match(selector, /why_matches_intent/);
assert.match(selector, /selection_objective/);
assert.match(selector, /interpreted_intent/);
assert.match(selector, /不得把『低位階』『回檔』『突破』等追問又改回固定平衡型名單/);
assert.match(selector, /PREVIOUS_V17_GENERIC_BALANCED_ONLY/);
assert.match(selector, /intent\.objective !== "balanced"/);
assert.match(selector, /finmind_required_for_market_coverage: false/);
assert.match(selector, /fugle_required_for_market_coverage: false/);
assert.match(selector, /GREEN_RESEARCH/);
assert.match(selector, /YELLOW_WAIT/);
assert.doesNotMatch(selector, /news/i);

const entry = read("src/production-entry.ts");
assert.match(entry, /\.\/v8\/family-stock-selection-v18/);
assert.match(entry, /\.\/v8\/family-selection-intent/);
assert.match(entry, /FAMILY_RUNTIME_RELEASE = "family-production-runtime\/1\.9\.0"/);
assert.match(entry, /FAMILY_CACHE_SCHEMA = "family-selection-lkg\/v2"/);
assert.match(entry, /family-selection:lkg:v2/);
assert.match(entry, /selection_objective/);
assert.match(entry, /intent_signature/);
assert.match(entry, /inferFamilySelectionIntent/);
assert.match(entry, /同一選股意圖/);
assert.match(entry, /balanced 名單冒充低位階\/回檔\/突破/);
assert.match(entry, /\/health\/family-intent/);
assert.match(entry, /family-selection-intent\/v1/);
assert.match(entry, /FAMILY_CACHE_MAX_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
assert.match(entry, /putFamilySelectionCache/);
assert.match(entry, /getFamilySelectionCache/);
assert.match(entry, /cachedFallbackResult/);
assert.match(entry, /refreshDefaultFamilyCache/);
assert.match(entry, /ctx\.waitUntil\(putFamilySelectionCache/);
assert.match(entry, /ctx\.waitUntil\(refreshDefaultFamilyCache/);
assert.match(entry, /\/api\/family\/query/);
assert.match(entry, /\/health\/family-selection-data/);
assert.match(entry, /diagnoseFamilySelectionData\(env\)/);
assert.match(entry, /MOM_GPT_API_KEY/);
assert.match(entry, /OAUTH_KV\.put/);
assert.match(entry, /OAUTH_KV\.get/);
assert.match(entry, /legacyOauthEntry\.fetch/);
assert.match(entry, /family_stock_selection/);

// Thin production wrapper must route individual-stock/general read questions before selector.
const smart = read("src/family-smart-production-entry.ts");
assert.match(smart, /family-smart-query-router\/v1\.0\.0/);
assert.match(smart, /runFamilyQuery/);
assert.match(smart, /shouldUseFamilyStockSelector/);
assert.match(smart, /選股\|選股票\|找股\|找股票/);
assert.match(smart, /\btop\\s\*\\d\+\b/i);
assert.match(smart, /symbols\.length > 0/);
assert.match(smart, /if \(!query \|\| shouldUseFamilyStockSelector\(query\)\) return null/);
assert.match(smart, /await runFamilyQuery/);
assert.match(smart, /numbered_sections: "1-11"/);
assert.match(smart, /section_12_role/);
assert.match(smart, /不得改拿全市場選股結果冒充指定個股資料/);
assert.match(smart, /family_smart_query_failed/);
assert.match(smart, /return productionEntry\.fetch/);
assert.match(smart, /scheduled/);

// Regression examples locked in comments/regex contract:
// 2317 => Family Query, 2317 vs 2382 => Family Query, explicit Top N/找股 => selector.
const classifierSource = smart;
assert.ok(!/(?:2317).*shouldUseFamilyStockSelector/.test(classifierSource), "classifier must not hard-code a stock symbol");

const wrangler = read("wrangler.jsonc");
assert.match(wrangler, /"main": "src\/family-smart-production-entry\.ts"/);
assert.match(wrangler, /"binding": "OAUTH_KV"/);
assert.match(wrangler, /"name": "FAMILY_MCP_OBJECT"/);
assert.match(wrangler, /"new_sqlite_classes": \["FamilyMCP"\]/);
assert.match(wrangler, /"tag": "v2"/);
assert.match(wrangler, /"database_id": "18673f52-c286-49f3-a82c-bf67d0593611"/);
assert.doesNotMatch(wrangler, /RESEARCH_BUCKET/);

console.log("Production family selector + smart family query router contract passed");
