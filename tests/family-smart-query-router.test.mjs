import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/family-smart-production-entry.ts", "utf8");

function emulateRoute(query) {
  const symbols = query.match(/(?<!\d)\d{4,6}(?!\d)/g) ?? [];
  const explicitScan = /(選股|選股票|找股|找股票|候選股|篩選.*(?:股|股票|標的)|掃描.*(?:股|股票|標的)|推薦.*(?:股|股票|標的)|找.{0,20}\d+\s*檔|哪幾檔|哪些(?:股|股票|個股|標的)|有沒有.{0,40}(?:股票|個股|標的|波段股)|\btop\s*\d+\b)/i.test(query);
  const selectionFollowUp = symbols.length === 0
    && /(有沒有|還有沒有|再找|幫我找).{0,30}(低位階|低檔|底部|低基期|回檔|拉回|回踩|突破|轉強|強勢|趨勢|波段)/.test(query);
  if (symbols.length > 0) return explicitScan ? "selection" : "query";
  return explicitScan || selectionFollowUp ? "selection" : "query";
}

assert.match(source, /export function shouldUseFamilyStockSelector/);
assert.equal(emulateRoute("2317"), "query");
assert.equal(emulateRoute("2317 怎麼看"), "query");
assert.equal(emulateRoute("2317 跟 2382 哪個比較好"), "query");
assert.equal(emulateRoute("鴻海最近籌碼怎麼樣"), "query");
assert.equal(emulateRoute("3189 最近外資投信怎樣"), "query");
assert.equal(emulateRoute("投信連買是什麼"), "query");
assert.equal(emulateRoute("找5檔低位階開始轉強"), "selection");
assert.equal(emulateRoute("波段選股 Top 5"), "selection");
assert.equal(emulateRoute("有沒有投信連買又沒漲很多的股票"), "selection");
assert.equal(emulateRoute("有沒有低位階、還沒大漲但開始轉強的"), "selection");
assert.equal(emulateRoute("找跟2317類似的5檔"), "selection");

console.log("Family smart query router examples passed");
