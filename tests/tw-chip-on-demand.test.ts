import assert from "node:assert/strict";
import { getTwChipOnDemandSnapshot, resetTwChipOnDemandCacheForTests } from "../src/v6/tw-chip-on-demand.ts";
import {
  resetTwCreditSblFastPathCacheForTests,
  runFamilyCreditSblQueryFastPath,
} from "../src/v6/tw-credit-sbl-query-fast-path.ts";
import { normalizeTwseSblShortSale, type MarginRow, type SblShortSaleRow } from "../src/v6/tw-market-data.ts";

const date = "2026-09-03";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const twt93Fields = [
  "代號", "名稱", "前日餘額", "賣出", "買進", "現券", "今日餘額", "次一營業日限額",
  "前日餘額", "當日賣出", "當日還券", "當日調整", "當日餘額", "次一營業日可限額", "備註",
];

function fixtures(t86Date = "20260903") {
  return {
    t86: {
      date: t86Date,
      fields: ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
      data: [["2330", "台積電", "1000", "200", "-100", "1100"]],
    },
    margin: {
      date: "20260903",
      tables: [{
        title: "融資融券彙總 (全部)",
        fields: ["證券代號", "證券名稱", "前日餘額", "買進", "賣出", "現金償還", "今日餘額", "前日餘額", "賣出", "買進", "現券償還", "今日餘額"],
        data: [["2330", "台積電", "10000", "500", "300", "0", "10200", "100", "20", "10", "0", "110"]],
      }],
    },
    lending: {
      date: "20260903",
      fields: ["證券代號", "證券名稱", "市場別", "前日借券餘額(1)股", "本日異動股借券(2)", "本日異動股還券(3)", "本日借券餘額股(4)=(1)+(2)-(3)", "本日收盤價(5)單位：元", "借券餘額市值單位：元(6)=(4)*(5)"],
      data: [["2330", "台積電", "上市", "100000", "10000", "5000", "105000", "2300", "241500000"]],
    },
    sbl: {
      date: "20260903",
      fields: twt93Fields,
      data: [["2330", "台積電", 0, 0, 0, 0, 0, 0, "50000", "8000", "3000", "0", "55000", "120000", ""]],
    },
  };
}

function makeFetcher(t86Date = "20260903") {
  const data = fixtures(t86Date);
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("/fund/T86")) return jsonResponse(data.t86);
    if (url.includes("/marginTrading/MI_MARGN")) return jsonResponse(data.margin);
    if (url.includes("/exchangeReport/TWT72U")) return jsonResponse(data.lending);
    if (url.includes("/marginTrading/TWT93U")) return jsonResponse(data.sbl);
    return jsonResponse([]);
  };
  return { fetcher, calls: () => calls };
}

resetTwChipOnDemandCacheForTests();
{
  const mock = makeFetcher();
  const first = await getTwChipOnDemandSnapshot({ symbol: "2330", as_of: date, fetcher: mock.fetcher });
  assert.equal(first.market, "listed");
  assert.equal(first.status, "READY");
  assert.equal(first.persistence, "NONE");
  assert.equal(first.previous_day_substitution, false);
  assert.equal(first.layers.margin_short.status, "READY");
  assert.equal(first.layers.margin_short.latest?.margin_balance_lots, 10200);
  assert.equal(first.layers.margin_short.latest?.short_balance_lots, 110);
  assert.equal(first.layers.securities_lending.latest?.balance_shares, 105000);
  assert.equal(first.layers.sbl_short_sale.latest?.balance_shares, 55000);

  const second = await getTwChipOnDemandSnapshot({ symbol: "2330", as_of: date, fetcher: mock.fetcher });
  assert.equal(second.status, "READY");
  assert.equal(mock.calls(), 8, "same-date full-market source responses must be reused inside the Worker isolate cache");
}

resetTwChipOnDemandCacheForTests();
{
  const mock = makeFetcher("20260902");
  const result = await getTwChipOnDemandSnapshot({ symbol: "2330", as_of: date, fetcher: mock.fetcher });
  assert.equal(result.market, "listed");
  assert.equal(result.layers.institutional.status, "PENDING");
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.previous_day_substitution, false);
  const t86 = result.source_health.find((source) => source.source_id === "twse_institutional_t86");
  assert.equal(t86?.source_date, "2026-09-02");
  assert.equal(t86?.source_date_verified, false);
}

assert.throws(() => normalizeTwseSblShortSale({
  date: "20260903",
  fields: ["代號", "名稱", ...Array.from({ length: 12 }, (_, index) => `unexpected_${index}`)],
  data: [["2330", "台積電", ...Array.from({ length: 12 }, () => 0)]],
}, "2026-09-03"), /twt93u_schema_mismatch/, "TWT93U schema drift must fail closed instead of shifting numeric indexes");

function priorWeekdays(end: string, count: number) {
  const out: string[] = [];
  let cursor = new Date(`${end}T00:00:00Z`);
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

const fastAsOf = "2026-09-04";
const tradeDates = priorWeekdays(fastAsOf, 60);
const historicalDates = tradeDates.slice(0, -1);
const historyMargin: MarginRow[] = historicalDates.map((tradeDate, index) => ({
  trade_date: tradeDate,
  symbol: "2330",
  name: "台積電",
  market: "listed",
  margin_previous_balance_lots: 28000 + index,
  margin_balance_lots: 28001 + index,
  margin_balance_change_lots: 1,
  short_previous_balance_lots: 20 + index,
  short_balance_lots: 21 + index,
  short_balance_change_lots: 1,
  source: "TWSE_MI_MARGN",
  source_priority: "OFFICIAL",
}));
const historySbl: SblShortSaleRow[] = historicalDates.map((tradeDate, index) => ({
  trade_date: tradeDate,
  symbol: "2330",
  name: "台積電",
  market: "listed",
  previous_balance_shares: 15_000_000 + index * 1_000,
  sold_shares: 2_000,
  returned_shares: 1_000,
  adjustment_shares: 0,
  balance_shares: 15_001_000 + index * 1_000,
  available_shares: 50_000_000,
  sold_volume_shares: 2_000,
  sold_amount: null,
  source: "TWSE_TWT93U",
  source_priority: "OFFICIAL",
}));

const fastMarginBody = {
  date: "20260904",
  tables: [{
    title: "融資融券彙總 (全部)",
    fields: ["證券代號", "證券名稱", "前日餘額", "買進", "賣出", "現金償還", "今日餘額", "前日餘額", "賣出", "買進", "現券償還", "今日餘額"],
    data: [["2330", "台積電", "28459", "0", "78", "0", "28381", "26", "0", "1", "0", "25"]],
  }],
};
const fastSblBody = {
  date: "20260904",
  fields: twt93Fields,
  data: [["2330", "台積電", 0, 0, 0, 0, 0, 0, "16031000", "2000", "38000", "0", "15995000", "50000000", ""]],
};

function fastFetcher() {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("MI_MARGN")) return jsonResponse(fastMarginBody);
    if (url.includes("TWT93U")) return jsonResponse(fastSblBody);
    throw new Error(`unexpected fast-path URL: ${url}`);
  };
  return { fetcher, calls: () => calls };
}

const windowResolver = async ({ as_of, trading_days }: { as_of: string; trading_days: number }) => {
  if (as_of !== fastAsOf) throw new Error(`requested_as_of_not_trading_day:${as_of}`);
  const index = tradeDates.length - trading_days;
  if (index < 0) throw new Error("window_too_large");
  return { start_date: tradeDates[index], end_date: fastAsOf, trading_days };
};

resetTwCreditSblFastPathCacheForTests();
{
  const mock = fastFetcher();
  const result = await runFamilyCreditSblQueryFastPath({} as Env, {
    symbol: "2330",
    query: "查 2330 2026-09-04 融資融券與借券放空 1日 5日 10日 20日 60日",
    as_of: fastAsOf,
    as_of_explicit: true,
  }, {
    fetcher: mock.fetcher,
    window_resolver: windowResolver,
    history_reader: async () => ({ margin: historyMargin, sbl_short_sale: historySbl, securities_lending: [], datasets: ["fixture"] }),
  });
  assert.equal(result.status, "READY");
  assert.equal(result.market, "listed");
  assert.equal(result.resolved_as_of, fastAsOf);
  assert.equal(result.as_of_resolution, "EXPLICIT_EXACT_TRADING_DAY");
  assert.equal(result.diagnostics.current_market_provider_http_requests, 2, "listed margin+SBL focused query must use two market-provider requests, not the eight-source full snapshot");
  assert.equal(mock.calls(), 2);
  assert.equal(result.layers.margin_short?.windows["1D"].margin_balance_change_lots, -78);
  assert.equal(result.layers.margin_short?.windows["1D"].short_balance_change_lots, -1);
  assert.equal(result.layers.sbl_short_sale?.windows["1D"].balance_change_shares, -36_000);
  assert.equal(result.layers.sbl_short_sale?.windows["1D"].balance_change_lots_equivalent, -36);
  assert.equal(result.layers.sbl_short_sale?.windows["60D"].observed_days, 60);
  assert.equal(result.layers.sbl_short_sale?.windows["60D"].status, "READY");
  assert.equal(result.diagnostics.full_chip_snapshot_used, false);
  assert.equal(result.diagnostics.finmind_fetch, false);
  assert.equal(result.diagnostics.moneydj_fetch, false);
  assert.equal(result.diagnostics.ohlc_fetch, false);
}

resetTwCreditSblFastPathCacheForTests();
{
  const withUnknown = historySbl.map((row, index) => index === 10 ? { ...row, sold_shares: null } : row);
  const result = await runFamilyCreditSblQueryFastPath({} as Env, {
    symbol: "2330",
    query: "查 2330 2026-09-04 借券放空 60日",
    as_of: fastAsOf,
    as_of_explicit: true,
  }, {
    fetcher: fastFetcher().fetcher,
    window_resolver: windowResolver,
    history_reader: async () => ({ margin: historyMargin, sbl_short_sale: withUnknown, securities_lending: [], datasets: ["fixture"] }),
  });
  assert.equal(result.layers.sbl_short_sale?.windows["60D"].status, "PARTIAL");
  assert.equal(result.layers.sbl_short_sale?.windows["60D"].sold_shares, null, "UNKNOWN must not be coerced to zero inside SBL windows");
}

resetTwCreditSblFastPathCacheForTests();
{
  const weekendResolver = async ({ as_of, trading_days }: { as_of: string; trading_days: number }) => {
    if (as_of === "2026-09-05") throw new Error("requested_as_of_not_trading_day:2026-09-05");
    return windowResolver({ as_of, trading_days });
  };
  const result = await runFamilyCreditSblQueryFastPath({} as Env, {
    symbol: "2330",
    query: "2330 融資融券與借券放空",
    as_of: "2026-09-05",
    as_of_explicit: false,
  }, {
    fetcher: fastFetcher().fetcher,
    window_resolver: weekendResolver,
    history_reader: async () => ({ margin: historyMargin, sbl_short_sale: historySbl, securities_lending: [], datasets: ["fixture"] }),
  });
  assert.equal(result.resolved_as_of, "2026-09-04");
  assert.equal(result.as_of_resolution, "IMPLICIT_LATEST_TRADING_DAY");
  assert.equal(result.previous_day_substitution, false, "implicit latest trading day resolution is not explicit-date substitution");
}

console.log("TW chip on-demand exact-date + targeted credit/SBL fast-path tests passed");
