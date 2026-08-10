import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const selector = read("src/v8/family-stock-selection-v14.ts");
assert.match(selector, /FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection\/production-v1\.5\.0"/);
assert.match(selector, /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/);
assert.match(selector, /www\.tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/);
assert.match(selector, /www\.tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_quotes/);
assert.match(selector, /TPEX_QUOTES_OPENAPI/);
assert.match(selector, /redirect: \"manual\"/);
assert.match(selector, /tryFugleTickersMisOtc/);
assert.match(selector, /\/snapshot\/quotes\/\$\{fugleMarket\}/);
assert.match(selector, /COMMONSTOCK/);
assert.match(selector, /\/historical\/candles\/\$\{symbol\}/);
assert.match(selector, /FINMIND_FALLBACK/);
assert.match(selector, /diagnoseFamilySelectionData\(env: Env\)/);
assert.match(selector, /provider_configuration/);
assert.match(selector, /FUGLE_OTC/);
assert.match(selector, /GREEN_RESEARCH/);
assert.match(selector, /YELLOW_WAIT/);
assert.match(selector, /不追價/);
assert.match(selector, /TaiwanStockPrice/);
assert.match(selector, /TaiwanStockMonthRevenue/);
assert.match(selector, /TaiwanStockInstitutionalInvestorsBuySell/);
assert.doesNotMatch(selector, /afterTrading\/MI_INDEX/);
assert.doesNotMatch(selector, /stk_quote_result\.php/);

const entry = read("src/production-entry.ts");
assert.match(entry, /\.\/v8\/family-stock-selection-v14/);
assert.match(entry, /isFamilyStockSelectionQuery/);
assert.match(entry, /\/api\/family\/query/);
assert.match(entry, /\/health\/family-selection-data/);
assert.match(entry, /diagnoseFamilySelectionData\(env\)/);
assert.match(entry, /MOM_GPT_API_KEY/);
assert.match(entry, /legacyOauthEntry\.fetch/);
assert.match(entry, /family_stock_selection/);
assert.match(entry, /資料鏈失敗/);
assert.match(entry, /新聞硬湊候選股/);

const wrangler = read("wrangler.jsonc");
assert.match(wrangler, /"main": "src\/production-entry\.ts"/);
assert.match(wrangler, /"binding": "OAUTH_KV"/);
assert.match(wrangler, /"name": "FAMILY_MCP_OBJECT"/);
assert.match(wrangler, /"new_sqlite_classes": \["FamilyMCP"\]/);
assert.match(wrangler, /"tag": "v2"/);
assert.match(wrangler, /"database_id": "18673f52-c286-49f3-a82c-bf67d0593611"/);
assert.doesNotMatch(wrangler, /RESEARCH_BUCKET/);

console.log("Production family selector provider-fallback v1.5 regression contract passed");
