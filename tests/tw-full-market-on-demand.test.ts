import assert from "node:assert/strict";
import {
  getOfficialMarketInstitutionalOnDemand,
  getOfficialMarketMarginOnDemand,
} from "../src/v6/tw-full-market-on-demand.ts";

const date = "2026-10-07";
const resp = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

const instFields = ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"];
const twseInst = {
  stat: "OK",
  date: "20261007",
  fields: instFields,
  data: Array.from({ length: 25 }, (_, i) => [
    String(1001 + i),
    `L${i}`,
    String((i - 12) * 1000),
    String((12 - i) * 1000),
    "0",
    "0",
  ]),
};
const tpexInst = Array.from({ length: 25 }, (_, i) => ({
  Date: "1151007",
  Code: String(6001 + i),
  Name: `O${i}`,
  "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference": String((12 - i) * 1000),
  "Securities Investment Trust Companies-Difference": String((i - 12) * 1000),
  "Dealers-Difference": "0",
}));

const twseMargin = {
  stat: "OK",
  date: "20261007",
  tables: [{
    title: "115年10月07日 融資融券彙總 (全部)",
    fields: [
      "代號", "名稱",
      "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額",
      "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額",
      "資券互抵", "註記",
    ],
    data: Array.from({ length: 25 }, (_, i) => {
      const delta = i - 12;
      return [
        String(2001 + i), `M${i}`,
        "10", "5", "0", "1000", String(1000 + delta), "99999",
        "3", "2", "0", "100", String(100 - delta), "99999",
        "0", "",
      ];
    }),
  }],
};

const tpexMargin = Array.from({ length: 25 }, (_, i) => {
  const delta = 12 - i;
  return {
    Date: "1151007",
    Code: String(7001 + i),
    Name: `Q${i}`,
    MarginPurchasePreviousBalance: "2000",
    MarginPurchaseBalance: String(2000 + delta),
    ShortSalePreviousBalance: "200",
    ShortSaleBalance: String(200 - delta),
  };
});

const fetcher = async (url: RequestInfo | URL) => {
  const value = String(url);
  if (value.includes("/fund/T86")) return resp(twseInst);
  if (value.includes("tpex_3insti_daily_trading")) return resp(tpexInst);
  if (value.includes("/marginTrading/MI_MARGN")) return resp(twseMargin);
  if (value.includes("tpex_mainboard_margin_balance")) return resp(tpexMargin);
  return new Response("not found", { status: 404 });
};

const institutional = await getOfficialMarketInstitutionalOnDemand({
  date,
  fetcher: fetcher as typeof fetch,
  min_rows: { listed: 25, otc: 25 },
});
assert.equal(institutional.status, "READY");
assert.equal(institutional.delivery_mode, "DIRECT_EXACT_DATE_ON_DEMAND");
assert.equal(institutional.current_selection_source, true);
assert.equal(institutional.previous_day_substitution, false);
assert.equal(institutional.coverage?.total_rows, 50);
assert.equal(institutional.rankings?.foreign_buy.length, 10);
assert.equal(institutional.rankings?.foreign_sell.length, 10);
assert.equal(institutional.rankings?.trust_buy.length, 10);
assert.equal(institutional.rankings?.trust_sell.length, 10);

const staleInstitutional = await getOfficialMarketInstitutionalOnDemand({
  date,
  fetcher: (async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.includes("/fund/T86")) return resp(twseInst);
    if (value.includes("tpex_3insti_daily_trading")) {
      return resp(tpexInst.map((row) => ({ ...row, Date: "1151006" })));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch,
  min_rows: { listed: 25, otc: 25 },
});
assert.equal(staleInstitutional.status, "PENDING");
assert.equal(staleInstitutional.previous_day_substitution, false);
assert.equal(staleInstitutional.current_selection_source, false);

const margin = await getOfficialMarketMarginOnDemand({
  date,
  fetcher: fetcher as typeof fetch,
  min_rows: { listed: 25, otc: 25 },
});
assert.equal(margin.status, "READY");
assert.equal(margin.delivery_mode, "DIRECT_EXACT_DATE_ON_DEMAND");
assert.equal(margin.current_selection_source, true);
assert.equal(margin.previous_day_substitution, false);
assert.equal(margin.coverage?.total_rows, 50);
assert.ok((margin.rankings?.margin_increase.length ?? 0) > 0);
assert.ok((margin.rankings?.margin_decrease.length ?? 0) > 0);
assert.ok((margin.rankings?.short_increase.length ?? 0) > 0);
assert.ok((margin.rankings?.short_decrease.length ?? 0) > 0);

const staleMargin = await getOfficialMarketMarginOnDemand({
  date,
  fetcher: (async (url: RequestInfo | URL) => {
    const value = String(url);
    if (value.includes("/marginTrading/MI_MARGN")) return resp(twseMargin);
    if (value.includes("tpex_mainboard_margin_balance")) {
      return resp(tpexMargin.map((row) => ({ ...row, Date: "1151006" })));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch,
  min_rows: { listed: 25, otc: 25 },
});
assert.equal(staleMargin.status, "PENDING");
assert.equal(staleMargin.previous_day_substitution, false);
assert.equal(staleMargin.current_selection_source, false);

console.log(JSON.stringify({
  schema: "TW_FULL_MARKET_ON_DEMAND_TEST_V1",
  status: "PASS",
  institutional_rows: institutional.coverage?.total_rows,
  margin_rows: margin.coverage?.total_rows,
  previous_day_substitution: false,
}, null, 2));
