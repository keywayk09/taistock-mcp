import assert from "node:assert/strict";
import {
  resetTwCreditSblFastPathCacheForTests,
  runFamilyCreditSblQueryFastPath,
} from "../src/v6/tw-credit-sbl-query-fast-path.ts";
import type { MarginRow, SblShortSaleRow } from "../src/v6/tw-market-data.ts";

const asOf = "2026-09-04";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

const twt93Fields = [
  "代號", "名稱", "前日餘額", "賣出", "買進", "現券", "今日餘額", "次一營業日限額",
  "前日餘額", "當日賣出", "當日還券", "當日調整", "當日餘額", "次一營業日可限額", "備註",
];

const marginBody = {
  date: "20260904",
  tables: [{
    title: "融資融券彙總 (全部)",
    fields: ["證券代號", "證券名稱", "前日餘額", "買進", "賣出", "現金償還", "今日餘額", "前日餘額", "賣出", "買進", "現券償還", "今日餘額"],
    data: [["2419", "仲琦", "6022", "28", "0", "0", "6050", "52", "0", "33", "0", "19"]],
  }],
};

const sblBody = {
  date: "20260904",
  fields: twt93Fields,
  data: [["2419", "仲琦", 0, 0, 0, 0, 0, 0, "6982000", "293000", "0", "0", "7275000", "20000000", ""]],
};

const historyMargin: MarginRow[] = [{
  trade_date: "2026-09-03",
  symbol: "2419",
  name: "仲琦",
  market: "listed",
  margin_previous_balance_lots: 6000,
  margin_balance_lots: 6022,
  margin_balance_change_lots: 22,
  short_previous_balance_lots: 60,
  short_balance_lots: 52,
  short_balance_change_lots: -8,
  source: "TWSE_MI_MARGN",
  source_priority: "OFFICIAL",
}];

const historySbl: SblShortSaleRow[] = [{
  trade_date: "2026-09-03",
  symbol: "2419",
  name: "仲琦",
  market: "listed",
  previous_balance_shares: 6_900_000,
  sold_shares: 100_000,
  returned_shares: 18_000,
  adjustment_shares: 0,
  balance_shares: 6_982_000,
  available_shares: 20_000_000,
  sold_volume_shares: 100_000,
  sold_amount: null,
  source: "TWSE_TWT93U",
  source_priority: "OFFICIAL",
}];

function makeFetcher() {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("MI_MARGN")) return jsonResponse(marginBody);
    if (url.includes("TWT93U")) return jsonResponse(sblBody);
    throw new Error(`unexpected_credit_sbl_url:${url}`);
  };
  return { fetcher, calls: () => calls };
}

const exactWindowResolver = async ({ as_of, trading_days }: { as_of: string; trading_days: number }) => {
  if (as_of !== "2026-09-04") throw new Error(`requested_as_of_not_trading_day:${as_of}`);
  if (trading_days !== 1) throw new Error(`unexpected_window:${trading_days}`);
  return { start_date: "2026-09-04", end_date: "2026-09-04", trading_days };
};

resetTwCreditSblFastPathCacheForTests();
{
  const mock = makeFetcher();
  const result = await runFamilyCreditSblQueryFastPath({} as Env, {
    symbol: "2419",
    query: "查 2419 2026-09-04 融資融券、借券賣出 1日",
    as_of: asOf,
    as_of_explicit: true,
  }, {
    fetcher: mock.fetcher,
    window_resolver: exactWindowResolver,
    history_reader: async () => ({
      margin: historyMargin,
      sbl_short_sale: historySbl,
      securities_lending: [],
      datasets: ["fixture"],
    }),
  });

  assert.equal(result.status, "READY");
  assert.equal(result.resolved_as_of, asOf);
  assert.equal(result.as_of_resolution, "EXPLICIT_EXACT_TRADING_DAY");
  assert.equal(result.previous_day_substitution, false);
  assert.equal(result.market, "listed");
  assert.equal(result.requested_layers.margin, true);
  assert.equal(result.requested_layers.sbl, true);
  assert.equal(result.requested_layers.lending, false);
  assert.equal(result.layers.margin_short?.latest?.margin_balance_lots, 6050);
  assert.equal(result.layers.margin_short?.latest?.margin_balance_change_lots, 28);
  assert.equal(result.layers.margin_short?.latest?.short_balance_lots, 19);
  assert.equal(result.layers.margin_short?.latest?.short_balance_change_lots, -33);
  assert.equal(result.layers.sbl_short_sale?.latest?.previous_balance_shares, 6_982_000);
  assert.equal(result.layers.sbl_short_sale?.latest?.sold_shares, 293_000);
  assert.equal(result.layers.sbl_short_sale?.latest?.balance_shares, 7_275_000);
  assert.equal(result.layers.sbl_short_sale?.windows["1D"].balance_change_lots_equivalent, 293);
  assert.equal(result.diagnostics.current_market_provider_http_requests, 2);
  assert.equal(result.diagnostics.full_chip_snapshot_used, false);
  assert.equal(result.diagnostics.moneydj_fetch, false);
  assert.equal(result.diagnostics.web_fetch, false);
  assert.equal(mock.calls(), 2);
}

resetTwCreditSblFastPathCacheForTests();
{
  const mock = makeFetcher();
  const weekendResolver = async ({ as_of, trading_days }: { as_of: string; trading_days: number }) => {
    if (as_of === "2026-09-05") throw new Error("requested_as_of_not_trading_day:2026-09-05");
    return exactWindowResolver({ as_of, trading_days });
  };
  const result = await runFamilyCreditSblQueryFastPath({} as Env, {
    symbol: "2419",
    query: "2419 融資融券、借券賣出 1日",
    as_of: "2026-09-05",
    as_of_explicit: false,
  }, {
    fetcher: mock.fetcher,
    window_resolver: weekendResolver,
    history_reader: async () => ({
      margin: historyMargin,
      sbl_short_sale: historySbl,
      securities_lending: [],
      datasets: ["fixture"],
    }),
  });
  assert.equal(result.resolved_as_of, "2026-09-04");
  assert.equal(result.as_of_resolution, "IMPLICIT_LATEST_TRADING_DAY");
  assert.equal(result.layers.sbl_short_sale?.latest?.trade_date, "2026-09-04");
  assert.equal(result.previous_day_substitution, false);
}

console.log("2419 credit/SBL exact-date + weekend runtime contract passed");
