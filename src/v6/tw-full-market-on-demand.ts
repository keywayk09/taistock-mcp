import {
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTradeDate,
  normalizeTwseInstitutional,
  type InstitutionalRow,
  type MarginRow,
} from "./tw-market-data.ts";
import { normalizeTwseMiMargnOfficial } from "./twse-mi-margin-official.ts";

export const TW_FULL_MARKET_ON_DEMAND_VERSION = "tw-full-market-on-demand/v1.0.0";

type FetchLike = typeof fetch;
type DirectStatus = "READY" | "PENDING" | "ERROR";
type Market = "listed" | "otc";

const STOCK = /^[1-9]\d{3}$/;

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function responseRows(body: unknown): Record<string, any>[] {
  if (Array.isArray(body)) return body.map(rec);
  const root = rec(body);
  if (Array.isArray(root.data) && Array.isArray(root.fields)) {
    return root.data
      .filter(Array.isArray)
      .map((values: any[]) => Object.fromEntries(root.fields.map((field: unknown, index: number) => [String(field), values[index]])));
  }
  if (Array.isArray(root.data)) return root.data.map(rec);
  return [];
}

function sourceDate(body: unknown): string | null {
  const root = rec(body);
  const direct = normalizeTradeDate(root.date ?? root.Date ?? root["資料日期"] ?? root["日期"] ?? root.TradeDate);
  if (direct) return direct;
  for (const row of responseRows(body).slice(0, 50)) {
    const value = row.Date ?? row.date ?? row["資料日期"] ?? row["日期"] ?? row.TradeDate;
    const parsed = normalizeTradeDate(value);
    if (parsed) return parsed;
  }
  return null;
}

async function fetchJson(url: string, fetcher: FetchLike) {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Diamond-Full-Market-On-Demand/1.0",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`http_${response.status}:${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid_json:${text.slice(0, 160)}`);
  }
}

function exactDateRows<T extends { trade_date: string; symbol: string; market: Market }>(
  rows: T[],
  date: string,
  market: Market,
) {
  const filtered = rows.filter((row) => row.trade_date === date && row.market === market && STOCK.test(row.symbol));
  const seen = new Set<string>();
  for (const row of filtered) {
    if (seen.has(row.symbol)) throw new Error(`duplicate_symbol:${market}:${row.symbol}`);
    seen.add(row.symbol);
  }
  return filtered;
}

function rankInstitutional(rows: InstitutionalRow[], key: "foreign_net_shares" | "trust_net_shares", direction: 1 | -1) {
  return rows
    .filter((row) => direction * row[key] > 0)
    .sort((a, b) => direction * (b[key] - a[key]) || a.symbol.localeCompare(b.symbol))
    .slice(0, 10)
    .map((row, index) => ({
      rank: index + 1,
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      net_shares: row[key],
      net_lots: row[key] / 1000,
    }));
}

function rankMargin(
  rows: MarginRow[],
  key: "margin_balance_change_lots" | "short_balance_change_lots",
  direction: 1 | -1,
) {
  return rows
    .filter((row) => row[key] !== null && direction * Number(row[key]) > 0)
    .sort((a, b) => direction * (Number(b[key]) - Number(a[key])) || a.symbol.localeCompare(b.symbol))
    .slice(0, 20)
    .map((row, index) => ({
      rank: index + 1,
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      change_lots: Number(row[key]),
      margin_balance_lots: row.margin_balance_lots,
      short_balance_lots: row.short_balance_lots,
    }));
}

function sourceReceipt(input: {
  market: Market;
  source_id: string;
  requested_date: string;
  source_date: string | null;
  error?: string | null;
}) {
  const status: DirectStatus = input.error
    ? "ERROR"
    : input.source_date === input.requested_date
      ? "READY"
      : "PENDING";
  return {
    market: input.market,
    source_id: input.source_id,
    status,
    requested_date: input.requested_date,
    source_date: input.source_date,
    source_date_verified: status === "READY",
    error: input.error ?? (status === "PENDING" ? `source_date_mismatch:${input.source_date ?? "missing"}` : null),
  };
}

export async function getOfficialMarketInstitutionalOnDemand(input: {
  date: string;
  fetcher?: FetchLike;
  min_rows?: { listed: number; otc: number };
}) {
  const date = String(input.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_trade_date");
  const fetcher = input.fetcher ?? fetch;
  const minRows = input.min_rows ?? { listed: 500, otc: 300 };
  const compact = date.replaceAll("-", "");

  let listedBody: unknown;
  let otcBody: unknown;
  let listedError: string | null = null;
  let otcError: string | null = null;

  await Promise.all([
    fetchJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALLBUT0999&response=json`, fetcher)
      .then((value) => { listedBody = value; })
      .catch((error) => { listedError = error instanceof Error ? error.message : String(error); }),
    fetchJson("https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading", fetcher)
      .then((value) => { otcBody = value; })
      .catch((error) => { otcError = error instanceof Error ? error.message : String(error); }),
  ]);

  const listedDate = listedError ? null : sourceDate(listedBody);
  const otcDate = otcError ? null : sourceDate(otcBody);
  const receipts = [
    sourceReceipt({ market: "listed", source_id: "TWSE_T86_ALLBUT0999", requested_date: date, source_date: listedDate, error: listedError }),
    sourceReceipt({ market: "otc", source_id: "TPEX_3INSTI_DAILY_TRADING", requested_date: date, source_date: otcDate, error: otcError }),
  ];

  if (receipts.some((item) => item.status !== "READY")) {
    return {
      schema: "TW_OFFICIAL_INSTITUTIONAL_RANKINGS_V2",
      status: receipts.some((item) => item.status === "ERROR") ? "ERROR" : "PENDING",
      trade_date: date,
      delivery_mode: "DIRECT_EXACT_DATE_ON_DEMAND",
      source_date_verified: false,
      previous_day_substitution: false,
      current_selection_source: false,
      sources: receipts,
      rankings: null,
    };
  }

  const listed = exactDateRows(normalizeTwseInstitutional(listedBody, date), date, "listed");
  const otc = exactDateRows(normalizeTpexInstitutional(otcBody, date), date, "otc");
  if (listed.length < minRows.listed) throw new Error(`listed_incomplete_rows:${listed.length}`);
  if (otc.length < minRows.otc) throw new Error(`otc_incomplete_rows:${otc.length}`);
  const all = [...listed, ...otc];
  if (new Set(all.map((row) => row.symbol)).size !== all.length) throw new Error("cross_market_duplicate_symbol");

  const rankings = {
    foreign_buy: rankInstitutional(all, "foreign_net_shares", 1),
    foreign_sell: rankInstitutional(all, "foreign_net_shares", -1),
    trust_buy: rankInstitutional(all, "trust_net_shares", 1),
    trust_sell: rankInstitutional(all, "trust_net_shares", -1),
  };
  if (Object.values(rankings).some((group) => group.length !== 10)) throw new Error("incomplete_top_ten");

  return {
    schema: "TW_OFFICIAL_INSTITUTIONAL_RANKINGS_V2",
    status: "READY",
    trade_date: date,
    delivery_mode: "DIRECT_EXACT_DATE_ON_DEMAND",
    source_date_verified: true,
    markets: ["listed", "otc"],
    etf_excluded: true,
    ranking_unit: "張",
    previous_day_substitution: false,
    read_only: true,
    current_selection_source: true,
    persistence_required_for_ready: false,
    coverage: {
      listed_rows: listed.length,
      otc_rows: otc.length,
      total_rows: all.length,
    },
    sources: {
      listed: "TWSE_T86_ALLBUT0999",
      otc: "TPEX_3INSTI_DAILY_TRADING",
      receipts,
    },
    rankings,
  };
}

export async function getOfficialMarketMarginOnDemand(input: {
  date: string;
  fetcher?: FetchLike;
  min_rows?: { listed: number; otc: number };
}) {
  const date = String(input.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_trade_date");
  const fetcher = input.fetcher ?? fetch;
  const minRows = input.min_rows ?? { listed: 400, otc: 250 };
  const compact = date.replaceAll("-", "");

  let listedBody: unknown;
  let otcBody: unknown;
  let listedError: string | null = null;
  let otcError: string | null = null;

  await Promise.all([
    fetchJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`, fetcher)
      .then((value) => { listedBody = value; })
      .catch((error) => { listedError = error instanceof Error ? error.message : String(error); }),
    fetchJson("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance", fetcher)
      .then((value) => { otcBody = value; })
      .catch((error) => { otcError = error instanceof Error ? error.message : String(error); }),
  ]);

  const listedDate = listedError ? null : sourceDate(listedBody);
  const otcDate = otcError ? null : sourceDate(otcBody);
  const receipts = [
    sourceReceipt({ market: "listed", source_id: "TWSE_MI_MARGN", requested_date: date, source_date: listedDate, error: listedError }),
    sourceReceipt({ market: "otc", source_id: "TPEX_MAINBOARD_MARGIN_BALANCE", requested_date: date, source_date: otcDate, error: otcError }),
  ];

  if (receipts.some((item) => item.status !== "READY")) {
    return {
      schema: "TW_OFFICIAL_MARGIN_FULL_MARKET_V1",
      status: receipts.some((item) => item.status === "ERROR") ? "ERROR" : "PENDING",
      trade_date: date,
      delivery_mode: "DIRECT_EXACT_DATE_ON_DEMAND",
      source_date_verified: false,
      previous_day_substitution: false,
      current_selection_source: false,
      sources: receipts,
      aggregate: null,
      rankings: null,
    };
  }

  const listed = exactDateRows(normalizeTwseMiMargnOfficial(listedBody, date), date, "listed");
  const otc = exactDateRows(normalizeTpexMargin(otcBody, date), date, "otc");
  if (listed.length < minRows.listed) throw new Error(`listed_incomplete_rows:${listed.length}`);
  if (otc.length < minRows.otc) throw new Error(`otc_incomplete_rows:${otc.length}`);
  const all = [...listed, ...otc];
  if (new Set(all.map((row) => row.symbol)).size !== all.length) throw new Error("cross_market_duplicate_symbol");

  const sum = (key: keyof MarginRow) => all.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);

  return {
    schema: "TW_OFFICIAL_MARGIN_FULL_MARKET_V1",
    status: "READY",
    trade_date: date,
    delivery_mode: "DIRECT_EXACT_DATE_ON_DEMAND",
    source_date_verified: true,
    markets: ["listed", "otc"],
    etf_excluded: true,
    ranking_unit: "張",
    previous_day_substitution: false,
    read_only: true,
    current_selection_source: true,
    persistence_required_for_ready: false,
    coverage: {
      listed_rows: listed.length,
      otc_rows: otc.length,
      total_rows: all.length,
    },
    sources: {
      listed: "TWSE_MI_MARGN",
      otc: "TPEX_MAINBOARD_MARGIN_BALANCE",
      receipts,
    },
    aggregate: {
      margin_balance_lots: sum("margin_balance_lots"),
      margin_balance_change_lots: sum("margin_balance_change_lots"),
      short_balance_lots: sum("short_balance_lots"),
      short_balance_change_lots: sum("short_balance_change_lots"),
    },
    rankings: {
      margin_increase: rankMargin(all, "margin_balance_change_lots", 1),
      margin_decrease: rankMargin(all, "margin_balance_change_lots", -1),
      short_increase: rankMargin(all, "short_balance_change_lots", 1),
      short_decrease: rankMargin(all, "short_balance_change_lots", -1),
    },
  };
}
