import assert from "node:assert/strict";
import {
  getTwFullMarketInstitutionalOnDemand,
  getTwFullMarketMarginOnDemand,
  resetTwFullMarketChipOnDemandCacheForTests,
} from "../src/v6/tw-full-market-chip-on-demand.ts";

const date = "2026-10-05";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function buildFixtures(listedCount = 520, otcCount = 320, otcDate = "1151005") {
  const listedInstitutional = {
    date: "20261005",
    stat: "OK",
    fields: ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
    data: [
      ["0050", "ETF", "999999999", "999999999", "0", "999999999"],
      ...Array.from({ length: listedCount }, (_, i) => {
        const foreign = (i - Math.floor(listedCount / 2)) * 1000;
        const trust = (Math.floor(listedCount / 2) - i) * 700;
        return [String(1001 + i), `L${i}`, String(foreign), String(trust), "0", String(foreign + trust)];
      }),
    ],
  };

  const otcInstitutional = Array.from({ length: otcCount }, (_, i) => {
    const foreign = (Math.floor(otcCount / 2) - i) * 900;
    const trust = (i - Math.floor(otcCount / 2)) * 600;
    return {
      Date: otcDate,
      Code: String(6001 + i),
      Name: `O${i}`,
      "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference": String(foreign),
      "Securities Investment Trust Companies-Difference": String(trust),
      "Dealers-Difference": "0",
      "Total Difference": String(foreign + trust),
    };
  });

  const listedMargin = {
    date: "20261005",
    tables: [{
      title: "融資融券彙總 (全部)",
      fields: ["證券代號", "證券名稱", "前日餘額", "買進", "賣出", "現金償還", "今日餘額", "前日餘額", "賣出", "買進", "現券償還", "今日餘額"],
      data: [
        ["0050", "ETF", "1", "0", "0", "0", "999999", "1", "0", "0", "0", "999999"],
        ...Array.from({ length: listedCount }, (_, i) => {
          const marginPrev = 1000 + i * 3;
          const marginNow = marginPrev + (i - Math.floor(listedCount / 2));
          const shortPrev = 100 + i;
          const shortNow = shortPrev + (Math.floor(listedCount / 2) - i);
          return [String(1001 + i), `L${i}`, String(marginPrev), "0", "0", "0", String(marginNow), String(shortPrev), "0", "0", "0", String(shortNow)];
        }),
      ],
    }],
  };

  const otcMargin = Array.from({ length: otcCount }, (_, i) => {
    const marginPrev = 800 + i * 2;
    const marginNow = marginPrev + (Math.floor(otcCount / 2) - i);
    const shortPrev = 80 + i;
    const shortNow = shortPrev + (i - Math.floor(otcCount / 2));
    return {
      Date: otcDate,
      Code: String(6001 + i),
      Name: `O${i}`,
      MarginPurchaseYesterdayBalance: String(marginPrev),
      MarginPurchaseTodayBalance: String(marginNow),
      ShortSaleYesterdayBalance: String(shortPrev),
      ShortSaleTodayBalance: String(shortNow),
    };
  });

  return { listedInstitutional, otcInstitutional, listedMargin, otcMargin };
}

function makeFetcher(fixtures: ReturnType<typeof buildFixtures>) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/fund/T86")) return jsonResponse(fixtures.listedInstitutional);
    if (url.includes("/openapi/v1/tpex_3insti_daily_trading")) return jsonResponse(fixtures.otcInstitutional);
    if (url.includes("/marginTrading/MI_MARGN")) return jsonResponse(fixtures.listedMargin);
    if (url.includes("/openapi/v1/tpex_mainboard_margin_balance")) return jsonResponse(fixtures.otcMargin);
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

resetTwFullMarketChipOnDemandCacheForTests();
{
  const fixtures = buildFixtures();
  const fetcher = makeFetcher(fixtures);
  const institutional = await getTwFullMarketInstitutionalOnDemand({ as_of: date, fetcher });
  assert.equal(institutional.status, "READY");
  assert.equal(institutional.source_date_verified, true);
  assert.equal(institutional.previous_day_substitution, false);
  assert.equal(institutional.persistence, "NONE");
  assert.equal(institutional.coverage.listed_rows, 520);
  assert.equal(institutional.coverage.otc_rows, 320);
  assert.deepEqual(Object.values(institutional.rankings).map((rows) => rows.length), [10, 10, 10, 10]);
  assert.ok(!Object.values(institutional.rankings).flat().some((row) => row.symbol === "0050"));

  const margin = await getTwFullMarketMarginOnDemand({ as_of: date, fetcher });
  assert.equal(margin.status, "READY");
  assert.equal(margin.source_date_verified, true);
  assert.equal(margin.previous_day_substitution, false);
  assert.equal(margin.persistence, "NONE");
  assert.equal(margin.coverage.listed_rows, 520);
  assert.equal(margin.coverage.otc_rows, 320);
  assert.equal(margin.rankings.margin_increase.length, 20);
  assert.equal(margin.rankings.margin_decrease.length, 20);
  assert.equal(margin.rankings.short_increase.length, 20);
  assert.equal(margin.rankings.short_decrease.length, 20);
  assert.ok(!Object.values(margin.rankings).flat().some((row) => row.symbol === "0050"));
  assert.equal(margin.interpretation_scope.suspension_or_forced_cover_events, "NOT_INCLUDED_IN_THIS_DATASET");
}

resetTwFullMarketChipOnDemandCacheForTests();
{
  const fixtures = buildFixtures(25, 25, "1151004");
  const exactLegacy = {
    reportDate: "115/10/05",
    aaData: Array.from({ length: 25 }, (_, i) => {
      const row = Array(24).fill("0");
      row[0] = String(6001 + i);
      row[1] = `E${i}`;
      row[4] = String((12 - i) * 1000);
      row[13] = String((i - 12) * 1000);
      return row;
    }),
  };
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/fund/T86")) return jsonResponse({
      ...fixtures.listedInstitutional,
      data: fixtures.listedInstitutional.data.filter((row: any[]) => row[0] !== "0050"),
    });
    if (url.includes("/openapi/v1/tpex_3insti_daily_trading")) return jsonResponse(fixtures.otcInstitutional);
    if (url.includes("3itrade_hedge_result.php")) return jsonResponse(exactLegacy);
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const result = await getTwFullMarketInstitutionalOnDemand({
    as_of: date,
    fetcher,
    min_rows: { listed: 25, otc: 25 },
  });
  assert.equal(result.status, "READY");
  assert.equal(result.sources.otc, "TPEX_3INSTI_EXACT_DATE");
  assert.equal(result.previous_day_substitution, false);
}

resetTwFullMarketChipOnDemandCacheForTests();
{
  const fixtures = buildFixtures(400, 200, "1151004");
  const fetcher = makeFetcher(fixtures);
  const margin = await getTwFullMarketMarginOnDemand({
    as_of: date,
    fetcher,
    min_rows: { listed: 400, otc: 200 },
  });
  assert.equal(margin.status, "PENDING");
  assert.equal(margin.source_date_verified, false);
  assert.equal(margin.previous_day_substitution, false);
  assert.equal(margin.rankings.margin_increase.length, 0);
}

console.log("TW full-market exact-date institutional + margin on-demand tests passed");
