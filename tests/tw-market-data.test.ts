import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  institutionalWindows,
  marginWindows,
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTradeDate,
  normalizeTwseInstitutional,
  normalizeTwseMargin,
  type InstitutionalRow,
  type MarginRow,
} from "../src/v6/tw-market-data.ts";

assert.equal(normalizeTradeDate("115/08/19"), "2026-08-19");
assert.equal(normalizeTradeDate("20260819"), "2026-08-19");
assert.equal(normalizeTradeDate("2026-08-19"), "2026-08-19");

const twseInstitutional = normalizeTwseInstitutional({
  stat: "OK",
  date: "20260819",
  fields: ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
  data: [["2330", "台積電", "1,000", "200", "-50", "1,150"]],
}, "2026-08-19");
assert.equal(twseInstitutional.length, 1);
assert.deepEqual(twseInstitutional[0], {
  trade_date:"2026-08-19", symbol:"2330", name:"台積電", market:"listed",
  foreign_net_shares:1000, trust_net_shares:200, dealer_net_shares:-50, total_net_shares:1150,
  source:"TWSE_T86", source_priority:"OFFICIAL",
});

const tpexInstitutional = normalizeTpexInstitutional([{
  Date:"115/08/19",
  SecuritiesCompanyCode:"6488",
  SecuritiesCompanyName:"環球晶",
  "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference":"2,000",
  "Securities Investment Trust Companies-Difference":"-100",
  "Dealers-Difference":"50",
  "Total Difference":"1,950",
}], "2026-08-19");
assert.equal(tpexInstitutional[0].trade_date, "2026-08-19");
assert.equal(tpexInstitutional[0].market, "otc");
assert.equal(tpexInstitutional[0].total_net_shares, 1950);

const twseMargin = normalizeTwseMargin({
  stat:"OK", date:"20260819", tables:[{
    title:"融資融券彙總",
    fields:["證券代號","證券名稱","融資前日餘額","融資今日餘額","融券前日餘額","融券今日餘額"],
    data:[["2330","台積電","10,000","10,500","800","750"]],
  }],
}, "2026-08-19");
assert.equal(twseMargin.length, 1);
assert.equal(twseMargin[0].margin_balance_change_lots, 500);
assert.equal(twseMargin[0].short_balance_change_lots, -50);

const tpexMargin = normalizeTpexMargin([{
  Date:"115/08/19", SecuritiesCompanyCode:"6488", SecuritiesCompanyName:"環球晶",
  MarginPurchaseYesterdayBalance:"1,000", MarginPurchaseTodayBalance:"1,100",
  ShortSaleYesterdayBalance:"90", ShortSaleTodayBalance:"120",
}], "2026-08-19");
assert.equal(tpexMargin[0].market, "otc");
assert.equal(tpexMargin[0].margin_balance_change_lots, 100);
assert.equal(tpexMargin[0].short_balance_change_lots, 30);

const institutionalRows: InstitutionalRow[] = Array.from({length:20},(_,i)=>({
  trade_date:`2026-07-${String(i+1).padStart(2,"0")}`, symbol:"2330", name:"台積電", market:"listed",
  foreign_net_shares:i+1, trust_net_shares:2, dealer_net_shares:-1, total_net_shares:i+2,
  source:"fixture", source_priority:"OFFICIAL",
}));
const instWindows = institutionalWindows(institutionalRows) as any;
assert.equal(instWindows["1d"].foreign_net_shares, 20);
assert.equal(instWindows["3d"].foreign_net_shares, 18+19+20);
assert.equal(instWindows["20d"].days, 20);

const marginRows: MarginRow[] = Array.from({length:20},(_,i)=>({
  trade_date:`2026-07-${String(i+1).padStart(2,"0")}`, symbol:"2330", name:"台積電", market:"listed",
  margin_previous_balance_lots:1000+i, margin_balance_lots:1001+i, margin_balance_change_lots:1,
  short_previous_balance_lots:100+i, short_balance_lots:102+i, short_balance_change_lots:2,
  source:"fixture", source_priority:"OFFICIAL",
}));
const marginSummary = marginWindows(marginRows) as any;
assert.equal(marginSummary.windows["5d"].margin_balance_change_lots, 5);
assert.equal(marginSummary.windows["10d"].short_balance_change_lots, 20);
assert.equal(marginSummary.latest.trade_date, "2026-07-20");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p:string) => fs.readFileSync(path.join(root,p),"utf8");

const source = read("src/v6/tw-market-data.ts");
assert.match(source, /TWSE_T86/);
assert.match(source, /TWSE_MI_MARGN/);
assert.match(source, /TPEX_3INSTI_DAILY_TRADING/);
assert.match(source, /TPEX_MAINBOARD_MARGIN_BALANCE/);
assert.match(source, /TaiwanStockInstitutionalInvestorsBuySell/);
assert.match(source, /TaiwanStockMarginPurchaseShortSale/);
assert.doesNotMatch(source, /TaiwanStockPrice/);
assert.match(source, /market_data_failure_blocks_ohlc:false/);

const tools = read("src/v6/tw-market-data-tools.ts");
for (const name of ["get_tw_market_data_contract","get_tw_institutional_flow","get_tw_margin_short","get_tw_market_data_bundle","get_tw_market_data_status"]) {
  assert.match(tools, new RegExp(`registerTool\\(\\"${name}\\"`));
}

const index = read("src/index-v6.ts");
assert.match(index, /registerTwMarketDataTools\(this\.server, this\.env\)/);
assert.match(index, /version: "6\.16\.0"/);
assert.match(index, /tools: 111/);
assert.match(index, /MARKET_DATA_CRONS/);

const wrangler = read("wrangler.jsonc");
assert.match(wrangler, /"30 10 \* \* 1-5"/);
assert.match(wrangler, /"30 12 \* \* 1-5"/);

const capability = read("src/v6/diamond-capability-p18.ts");
assert.match(capability, /market_data_ohlc_write: "FORBIDDEN"/);
assert.match(capability, /market_data_failure_blocks_ohlc: "FORBIDDEN"/);
assert.match(capability, /finmind_price_as_formal_ohlc: "FORBIDDEN"/);
assert.match(capability, /COMPATIBILITY_ONLY_NOT_FORMAL_SWING_SOURCE/);

console.log("P18 official-first Taiwan market data contract tests passed");
