import { normalizeTradeDate } from "./tw-market-data.ts";

export const TW_WARRANT_ACTIVITY_ON_DEMAND_VERSION = "tw-warrant-activity-on-demand/v1.0.0";

type FetchLike = typeof fetch;
type JsonRow = Record<string, unknown>;
type WarrantSide = "CALL" | "PUT" | "UNKNOWN";
type Market = "listed" | "otc";
type Status = "READY" | "READY_EMPTY" | "PENDING" | "ERROR";

type WarrantActivityRow = {
  market: Market;
  trade_date: string;
  warrant_code: string;
  warrant_name: string;
  underlying_code: string;
  side: WarrantSide;
  amount: number;
  volume: number;
};

type CacheEntry = { expires_at: number; promise: Promise<unknown> };
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function rec(value: unknown): JsonRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRow : {};
}

function rowsOf(value: unknown): JsonRow[] {
  if (Array.isArray(value)) return value.map(rec);
  const root = rec(value);
  if (Array.isArray(root.data)) return (root.data as unknown[]).map(rec);
  return [];
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[\s_()（）%％/\\.,:：;；\-]/g, "");
}

function getValue(row: JsonRow, aliases: string[]) {
  const entries = Object.entries(row).map(([key, value]) => [normalizeKey(key), value] as const);
  for (const alias of aliases) {
    const target = normalizeKey(alias);
    const exact = entries.find(([key]) => key === target);
    if (exact) return exact[1];
  }
  for (const alias of aliases) {
    const target = normalizeKey(alias);
    const partial = entries.find(([key]) => key.includes(target));
    if (partial) return partial[1];
  }
  return undefined;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOf(value: unknown) {
  const cleaned = text(value).replace(/,/g, "").replace(/\+/g, "");
  if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return 0;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function rowDate(row: JsonRow) {
  return normalizeTradeDate(getValue(row, ["交易日期", "資料日期", "出表日期", "Date", "TradeDate"]));
}

function warrantCode(row: JsonRow) {
  return text(getValue(row, ["權證代號", "代號", "SecuritiesCompanyCode", "WarrantCode", "Code"]));
}

function warrantName(row: JsonRow) {
  return text(getValue(row, ["權證名稱", "權證簡稱", "名稱", "WarrantName", "Name"]));
}

function underlyingCode(row: JsonRow) {
  const direct = text(getValue(row, ["標的證券代號", "標的代號", "權證標的", "UnderlyingSecurityCode", "UnderlyingCode"]));
  const directMatch = direct.match(/\b(\d{4,6})\b/);
  if (directMatch) return directMatch[1];
  const combined = text(getValue(row, ["標的證券指數", "標的證券/指數", "標的或指數", "UnderlyingSecurityIndex"]));
  return combined.match(/\b(\d{4,6})\b/)?.[1] ?? "";
}

function sideOf(row: JsonRow): WarrantSide {
  const raw = text(getValue(row, ["權證類型", "認購售", "認購(售)", "種類", "CallPut", "Type"]));
  if (/認購|\bcall\b|購/i.test(raw)) return "CALL";
  if (/認售|\bput\b|售/i.test(raw)) return "PUT";
  return "UNKNOWN";
}

function dailyAmount(row: JsonRow) {
  return numberOf(getValue(row, ["成交金額", "Amount", "TradingValue", "TradeAmount"]));
}

function dailyVolume(row: JsonRow) {
  return numberOf(getValue(row, ["成交數量", "成交量", "Volume", "TradingVolume", "TradeVolume"]));
}

async function fetchJsonCached(url: string, fetcher: FetchLike) {
  const now = Date.now();
  const existing = cache.get(url);
  if (existing && existing.expires_at > now) return existing.promise;
  const promise = (async () => {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Diamond-Warrant-Activity-ReadOnly/1.0",
      },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`http_${response.status}:${body.slice(0, 160)}`);
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`invalid_json:${body.slice(0, 160)}`);
    }
  })();
  cache.set(url, { expires_at: now + CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    cache.delete(url);
    throw error;
  }
}

function summarize(rows: WarrantActivityRow[]) {
  const sum = (side: WarrantSide, key: "amount" | "volume") => rows.filter((row) => row.side === side).reduce((total, row) => total + row[key], 0);
  const count = (side: WarrantSide) => rows.filter((row) => row.side === side).length;
  const callAmount = sum("CALL", "amount");
  const putAmount = sum("PUT", "amount");
  return {
    warrant_count: rows.length,
    total_amount: rows.reduce((total, row) => total + row.amount, 0),
    total_volume: rows.reduce((total, row) => total + row.volume, 0),
    call: { warrant_count: count("CALL"), amount: callAmount, volume: sum("CALL", "volume") },
    put: { warrant_count: count("PUT"), amount: putAmount, volume: sum("PUT", "volume") },
    unknown: { warrant_count: count("UNKNOWN"), amount: sum("UNKNOWN", "amount"), volume: sum("UNKNOWN", "volume") },
    call_put_amount_ratio: putAmount > 0 ? Number((callAmount / putAmount).toFixed(4)) : null,
  };
}

function sourceDates(rows: JsonRow[]) {
  return [...new Set(rows.map(rowDate).filter((value): value is string => Boolean(value)))].sort();
}

function listedRows(basicBody: unknown, dailyBody: unknown, symbol: string, asOf: string): { status: Status; rows: WarrantActivityRow[]; dates: string[]; error: string | null } {
  const basic = rowsOf(basicBody);
  const daily = rowsOf(dailyBody);
  const dates = sourceDates(daily);
  if (!dates.includes(asOf)) {
    return { status: dates.length ? "PENDING" : "ERROR", rows: [], dates, error: dates.length ? `source_date_mismatch:${dates.join(",")}` : "daily_trade_date_missing" };
  }

  const mapping = new Map<string, { underlying: string; side: WarrantSide }>();
  for (const row of basic) {
    const code = warrantCode(row);
    if (!code) continue;
    mapping.set(code, { underlying: underlyingCode(row), side: sideOf(row) });
  }

  const rows: WarrantActivityRow[] = [];
  for (const row of daily) {
    if (rowDate(row) !== asOf) continue;
    const code = warrantCode(row);
    const mapped = mapping.get(code);
    if (!mapped || mapped.underlying !== symbol) continue;
    rows.push({
      market: "listed",
      trade_date: asOf,
      warrant_code: code,
      warrant_name: warrantName(row),
      underlying_code: symbol,
      side: mapped.side,
      amount: dailyAmount(row),
      volume: dailyVolume(row),
    });
  }
  return { status: rows.length ? "READY" : "READY_EMPTY", rows, dates, error: null };
}

function otcRows(infoBody: unknown, quoteBody: unknown, symbol: string, asOf: string): { status: Status; rows: WarrantActivityRow[]; dates: string[]; error: string | null } {
  const info = rowsOf(infoBody);
  const quotes = rowsOf(quoteBody);
  const dates = sourceDates(quotes);
  if (!dates.includes(asOf)) {
    return { status: dates.length ? "PENDING" : "ERROR", rows: [], dates, error: dates.length ? `source_date_mismatch:${dates.join(",")}` : "daily_quote_date_missing" };
  }
  const sideByCode = new Map<string, WarrantSide>();
  for (const row of info) {
    const code = warrantCode(row);
    if (code) sideByCode.set(code, sideOf(row));
  }
  const rows: WarrantActivityRow[] = [];
  for (const row of quotes) {
    if (rowDate(row) !== asOf || underlyingCode(row) !== symbol) continue;
    const code = warrantCode(row);
    rows.push({
      market: "otc",
      trade_date: asOf,
      warrant_code: code,
      warrant_name: warrantName(row),
      underlying_code: symbol,
      side: sideByCode.get(code) ?? sideOf(row),
      amount: dailyAmount(row),
      volume: dailyVolume(row),
    });
  }
  return { status: rows.length ? "READY" : "READY_EMPTY", rows, dates, error: null };
}

/**
 * Official free warrant ACTIVITY adapter.
 *
 * This intentionally measures turnover/volume activity only. Daily transaction
 * datasets do not identify aggressor direction, so the output must never be
 * called warrant "buying" or dealer directional positioning. Dealer/branch
 * warrant trading is a separate paid/restricted dataset and is not scraped here.
 */
export async function getTwWarrantActivityOnDemand(input: {
  symbol: string;
  as_of: string;
  fetcher?: FetchLike;
}) {
  const symbol = String(input.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new Error("invalid_taiwan_symbol");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.as_of)) throw new Error("invalid_as_of_date");
  const fetcher = input.fetcher ?? fetch;
  const urls = {
    twse_basic: "https://openapi.twse.com.tw/v1/opendata/t187ap37_L",
    twse_daily: "https://openapi.twse.com.tw/v1/opendata/t187ap42_L",
    tpex_info: "https://www.tpex.org.tw/openapi/v1/tpex_warrant",
    tpex_quotes: "https://www.tpex.org.tw/openapi/v1/tpex_warrant_quts",
  };
  const retrievedAt = new Date().toISOString();
  try {
    const [twseBasic, twseDaily, tpexInfo, tpexQuotes] = await Promise.all([
      fetchJsonCached(urls.twse_basic, fetcher),
      fetchJsonCached(urls.twse_daily, fetcher),
      fetchJsonCached(urls.tpex_info, fetcher),
      fetchJsonCached(urls.tpex_quotes, fetcher),
    ]);
    const listed = listedRows(twseBasic, twseDaily, symbol, input.as_of);
    const otc = otcRows(tpexInfo, tpexQuotes, symbol, input.as_of);
    const rows = [...listed.rows, ...otc.rows];
    const statuses = [listed.status, otc.status];
    const status = rows.length
      ? statuses.includes("ERROR") || statuses.includes("PENDING") ? "DEGRADED" : "READY"
      : statuses.every((value) => value === "READY_EMPTY")
        ? "READY_EMPTY"
        : statuses.some((value) => value === "PENDING")
          ? "PENDING"
          : "ERROR";
    return {
      ok: status === "READY" || status === "DEGRADED" || status === "READY_EMPTY",
      version: TW_WARRANT_ACTIVITY_ON_DEMAND_VERSION,
      mode: "ON_DEMAND_ONLY" as const,
      status,
      symbol,
      requested_as_of: input.as_of,
      tier: "OFFICIAL_PRIMARY" as const,
      completeness: "FULL_OFFICIAL_DAILY_ACTIVITY" as const,
      persistence: "NONE" as const,
      directionality: "NOT_AVAILABLE_FROM_TURNOVER_ONLY" as const,
      interpretation_boundary: "成交金額/成交量是權證活動，不等同買超、主力買盤、發行券商方向或避險方向。",
      summary: summarize(rows),
      rows,
      source_health: {
        listed: { status: listed.status, trade_dates: listed.dates, error: listed.error, sources: [urls.twse_basic, urls.twse_daily] },
        otc: { status: otc.status, trade_dates: otc.dates, error: otc.error, sources: [urls.tpex_info, urls.tpex_quotes] },
      },
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    return {
      ok: false,
      version: TW_WARRANT_ACTIVITY_ON_DEMAND_VERSION,
      mode: "ON_DEMAND_ONLY" as const,
      status: "ERROR" as const,
      symbol,
      requested_as_of: input.as_of,
      tier: "OFFICIAL_PRIMARY" as const,
      completeness: "UNKNOWN" as const,
      persistence: "NONE" as const,
      directionality: "NOT_AVAILABLE_FROM_TURNOVER_ONLY" as const,
      interpretation_boundary: "成交金額/成交量是權證活動，不等同買超、主力買盤、發行券商方向或避險方向。",
      summary: summarize([]),
      rows: [],
      source_health: null,
      error: error instanceof Error ? error.message : String(error),
      retrieved_at: retrievedAt,
    };
  }
}

export function resetTwWarrantActivityCacheForTests() {
  cache.clear();
}
