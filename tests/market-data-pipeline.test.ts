import assert from "node:assert/strict";
import {
  classifyOfficialEvent,
  marketDataPhaseForCron,
  normalizeTpexInstitutional,
  normalizeTwseInstitutional,
  normalizeTwseMargin,
} from "../src/v6/market-data-pipeline.ts";

const twseInstitutional = normalizeTwseInstitutional({
  fields: [
    "證券代號",
    "證券名稱",
    "外陸資買賣超股數(不含外資自營商)",
    "投信買賣超股數",
    "自營商買賣超股數",
  ],
  data: [
    ["2330", "台積電", "1,234", "-200", "30"],
    ["0050", "元大台灣50", "999", "999", "999"],
  ],
});
assert.equal(twseInstitutional.length, 1);
assert.deepEqual(
  {
    symbol: twseInstitutional[0].symbol,
    foreignNet: twseInstitutional[0].foreignNet,
    trustNet: twseInstitutional[0].trustNet,
    dealerNet: twseInstitutional[0].dealerNet,
  },
  { symbol: "2330", foreignNet: 1234, trustNet: -200, dealerNet: 30 },
);

const tpexInstitutional = normalizeTpexInstitutional([
  {
    SecuritiesCompanyCode: "6488",
    CompanyName: "環球晶",
    ForeignInvestorsNetBuySell: "2,000",
    InvestmentTrustNetBuySell: "100",
    DealerNetBuySell: "-50",
  },
  { SecuritiesCompanyCode: "00679B", CompanyName: "bond", ForeignInvestorsNetBuySell: "1" },
]);
assert.equal(tpexInstitutional.length, 1);
assert.equal(tpexInstitutional[0].symbol, "6488");
assert.equal(tpexInstitutional[0].foreignNet, 2000);
assert.equal(tpexInstitutional[0].trustNet, 100);
assert.equal(tpexInstitutional[0].dealerNet, -50);

const twseMargin = normalizeTwseMargin({
  tables: [
    {
      title: "融資融券彙總 (股)",
      fields: [
        "股票代號", "股票名稱",
        "融資買進", "融資賣出", "融資現金償還", "融資前日餘額", "融資今日餘額", "融資限額",
        "融券賣出", "融券買進", "融券現券償還", "融券前日餘額", "融券今日餘額", "融券限額", "資券互抵", "註記",
      ],
      data: [
        ["2330", "台積電", "100", "50", "10", "1,000", "1,040", "0", "30", "20", "5", "200", "205", "0", "0", ""],
      ],
    },
  ],
});
assert.equal(twseMargin.length, 1);
assert.deepEqual(
  {
    marginPrev: twseMargin[0].marginPrev,
    marginBalance: twseMargin[0].marginBalance,
    shortPrev: twseMargin[0].shortPrev,
    shortBalance: twseMargin[0].shortBalance,
  },
  { marginPrev: 1000, marginBalance: 1040, shortPrev: 200, shortBalance: 205 },
);

const investorConference = classifyOfficialEvent(
  {
    公司代號: "6414",
    發言日期: "115/08/18",
    發言時間: "17:30:00",
    主旨: "本公司受邀參加法人說明會",
  },
  "TWSE",
  "2026-08-18",
);
assert.ok(investorConference);
assert.equal(investorConference.eventType, "INVESTOR_CONFERENCE");
assert.equal(investorConference.eventDate, "2026-08-18");

assert.equal(marketDataPhaseForCron("10 9 * * 1-5"), "fundamentals");
assert.equal(marketDataPhaseForCron("10 10 * * 1-5"), "institutional_prelim");
assert.equal(marketDataPhaseForCron("10 12 * * 1-5"), "institutional_final");
assert.equal(marketDataPhaseForCron("10 13 * * 1-5"), "margin");
assert.equal(marketDataPhaseForCron("30 13 * * 1-5"), "margin");
assert.equal(marketDataPhaseForCron("10 14 * * 1-5"), "finalize");
assert.equal(marketDataPhaseForCron("30 14 * * 1-5"), "finalize");
assert.equal(marketDataPhaseForCron("40 5 * * 1-5"), null);

console.log("market-data-pipeline tests passed");
