import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const selector = read("src/v8/family-stock-selection.ts");
assert.match(selector, /FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection\/production-v1\.0\.0"/);
assert.match(selector, /resolveLatestCompleteDate/);
assert.match(selector, /TWSE/);
assert.match(selector, /TPEx/);
assert.match(selector, /GREEN_RESEARCH/);
assert.match(selector, /YELLOW_WAIT/);
assert.match(selector, /不追價/);
assert.match(selector, /資料鏈失敗/);
assert.match(selector, /TaiwanStockMonthRevenue/);

const entry = read("src/production-entry.ts");
assert.match(entry, /isFamilyStockSelectionQuery/);
assert.match(entry, /\/api\/family\/query/);
assert.match(entry, /MOM_GPT_API_KEY/);
assert.match(entry, /legacyOauthEntry\.fetch/);
assert.match(entry, /family_stock_selection/);

const wrangler = read("wrangler.jsonc");
assert.match(wrangler, /"main": "src\/production-entry\.ts"/);
assert.match(wrangler, /"binding": "OAUTH_KV"/);
assert.match(wrangler, /"name": "FAMILY_MCP_OBJECT"/);
assert.match(wrangler, /"new_sqlite_classes": \["FamilyMCP"\]/);
assert.match(wrangler, /"tag": "v2"/);
assert.match(wrangler, /"database_id": "18673f52-c286-49f3-a82c-bf67d0593611"/);
assert.doesNotMatch(wrangler, /RESEARCH_BUCKET/);

console.log("Production family selector regression contract passed");
