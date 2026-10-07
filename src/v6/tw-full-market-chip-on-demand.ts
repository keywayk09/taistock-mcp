import {
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTradeDate,
  normalizeTwseInstitutional,
  type InstitutionalRow,
  type MarginRow,
} from "./tw-market-data.ts";
import { normalizeTwseMiMargnOfficial } from "./twse-mi-margin-official.ts";

export const TW_FULL_MARKET_CHIP_ON_DEMAND_VERSION = "tw-full-market-chip-on-demand/v1.0.0";

export type FullMarketExactDateStatus = "READY" | "PENDING" | "ERROR";
type FetchLike = typeof fetch;

type SourceResult<T> = {
  source_id: string;
  source_name: string;
  market: "listed" | "otc";
  status: FullMarketExactDateStatus;
  requested_date: string;
  source_date: string | null;
  source_date_verified: boolean;
  completeness: "FULL_OFFICIAL_DATASET";
  rows: T[];
  error: string | null;
  retrieved_at: string;
};

type CacheEntry = {
  expires_at: number;
  promise: Promise<unknown>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const requestCache = new Map<string, CacheEntry>();
const STOCK = /^[1-9]\d{3}$/;

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

function rocDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 1912) {
    throw new Error("invalid_trade_date");
  }
  return `${String(year - 1911).padStart(3, "0")}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function rawRows(body: unknown): Record<string, any>[] {
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

function findRawDate(row: Record<string, any>) {
  for (const key of ["Date", "date", "資料日期", "日期", "TradeDate"]) {
    const date = normalizeTradeDate(row[key]);
    if (date) return date;
  }
  return null;
}

function observedDatasetDate(body: unknown): string | null {
  const root = rec(body);
  const direct = normalizeTradeDate(root.date ?? root.Date ?? root.reportDate ?? root.datetime ?? root["資料日期"] ?? root["日期"] ?? root.TradeDate);
  if (direct) return direct;
  const dates = new Set(rawRows(body).slice(0, 100).map(findRawDate).filter((x): x is string => Boolean(x)));
  return dates.size === 1 ? [...dates][0] : null;
}

async function fetchJsonCached(
  url: string,
  fetcher: FetchLike,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const now = Date.now();
  const cached = requestCache.get(url);
  if (cached && cached.expires_at > now) return cached.promise;

  const promise = (async () => {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Diamond-Full-Market-Chip/1.0",
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`http_${response.status}:${text.slice(0, 160)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`invalid_json:${text.slice(0, 160)}`);
    }
  })();

  requestCache.set(url, { expires_at: now + CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    requestCache.delete(url);
    throw error;
  }
}

function validateOrdinaryRows<T extends { symbol: string; trade_date: string }>(
  rows: T[],
  requestedDate: string,
  minimumRows: number,
  market: "listed" | "otc",
) {
  const ordinary = rows.filter((row) => STOCK.test(row.symbol) && row.trade_date === requestedDate);
  const seen = new Set<string>();
  for (const row of ordinary) {
    if (seen.has(row.symbol)) throw new Error(`${market}_duplicate_symbol:${row.symbol}`);
    seen.add(row.symbol);
  }
  if (ordinary.length < minimumRows) throw new Error(`${market}_incomplete_rows:${ordinary.length}`);
  return ordinary;
}

function health<T>(source: SourceResult<T>) {
  return {
    source_id: source.source_id,
    source_name: source.source_name,
    market: source.market,
    status: source.status,
    requested_date: source.requested_date,
    source_date: source.source_date,
    source_date_verified: source.source_date_verified,
    completeness: source.completeness,
    rows: source.rows.length,
    error: source.error,
    retrieved_at: source.retrieved_at,
  };
}

async function loadListedInstitutional(input: {
  as_of: string;
  fetcher: FetchLike;
  minimum_rows: number;
}): Promise<SourceResult<InstitutionalRow>> {
  const retrievedAt = new Date().toISOString();
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compactDate(input.as_of)}&selectType=ALLBUT0999&response=json`;
  try {
    const body = await fetchJsonCached(url, input.fetcher);
    const root = rec(body);
    const sourceDate = observedDatasetDate(body);
    if (sourceDate !== input.as_of) {
      return {
        source_id: "twse_institutional_t86",
        source_name: "TWSE_T86_ALLBUT0999",
        market: "listed",
        status: "PENDING",
        requested_date: input.as_of,
        source_date: sourceDate,
        source_date_verified: false,
        completeness: "FULL_OFFICIAL_DATASET",
        rows: [],
        error: `source_date_mismatch:${sourceDate ?? "missing"}`,
        retrieved_at: retrievedAt,
      };
    }
    if (root.stat && root.stat !== "OK") throw new Error(`twse_stat_not_ok:${String(root.stat)}`);
    const rows = validateOrdinaryRows(
      normalizeTwseInstitutional(body, input.as_of),
      input.as_of,
      input.minimum_rows,
      "listed",
    );
    return {
      source_id: "twse_institutional_t86",
      source_name: "TWSE_T86_ALLBUT0999",
      market: "listed",
      status: "READY",
      requested_date: input.as_of,
      source_date: sourceDate,
      source_date_verified: true,
      completeness: "FULL_OFFICIAL_DATASET",
      rows,
      error: null,
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    return {
      source_id: "twse_institutional_t86",
      source_name: "TWSE_T86_ALLBUT0999",
      market: "listed",
      status: "ERROR",
      requested_date: input.as_of,
      source_date: null,
      source_date_verified: false,
      completeness: "FULL_OFFICIAL_DATASET",
      rows: [],
      error: error instanceof Error ? error.message : String(error),
      retrieved_at: retrievedAt,
    };
  }
}

function tpexLegacyInstitutionalBody(body: unknown) {
  const root = rec(body);
  if (!Array.isArray(root.aaData)) return body;
  const date = root.reportDate ?? root.datetime ?? root.date ?? null;
  return root.aaData
    .filter(Array.isArray)
    .map((row: any[]) => ({
      Date: date,
      Code: row[0],
      Name: row[1],
      "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference": row[4],
      "Securities Investment Trust Companies-Difference": row[13],
      "Dealers-Difference": 0,
    }));
}

async function loadOtcInstitutionalRoute(input: {
  as_of: string;
  fetcher: FetchLike;
  minimum_rows: number;
  url: string;
  source_id: string;
  source_name: string;
  extra_headers?: Record<string, string>;
  legacy_shape?: boolean;
}): Promise<SourceResult<InstitutionalRow>> {
  const retrievedAt = new Date().toISOString();
  try {
    const body = await fetchJsonCached(input.url, input.fetcher, input.extra_headers);
    const sourceDate = observedDatasetDate(body);
    if (sourceDate !== input.as_of) {
      return {
        source_id: input.source_id,
        source_name: input.source_name,
        market: "otc",
        status: "PENDING",
        requested_date: input.as_of,
        source_date: sourceDate,
        source_date_verified: false,
        completeness: "FULL_OFFICIAL_DATASET",
        rows: [],
        error: `source_date_mismatch:${sourceDate ?? "missing"}`,
        retrieved_at: retrievedAt,
      };
    }
    const normalizedBody = input.legacy_shape ? tpexLegacyInstitutionalBody(body) : body;
    const rows = validateOrdinaryRows(
      normalizeTpexInstitutional(normalizedBody, input.as_of),
      input.as_of,
      input.minimum_rows,
      "otc",
    );
    return {
      source_id: input.source_id,
      source_name: input.source_name,
      market: "otc",
      status: "READY",
      requested_date: input.as_of,
      source_date: sourceDate,
      source_date_verified: true,
      completeness: "FULL_OFFICIAL_DATASET",
      rows,
      error: null,
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    return {
      source_id: input.source_id,
      source_name: input.source_name,
      market: "otc",
      status: "ERROR",
      requested_date: input.as_of,
      source_date: null,
      source_date_verified: false,
      completeness: "FULL_OFFICIAL_DATASET",
      rows: [],
      error: error instanceof Error ? error.message : String(error),
      retrieved_at: retrievedAt,
    };
  }
}

async function loadOtcInstitutional(input: {
  as_of: string;
  fetcher: FetchLike;
  minimum_rows: number;
}): Promise<SourceResult<InstitutionalRow>> {
  const openApi = await loadOtcInstitutionalRoute({
    ...input,
    url: "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading",
    source_id: "tpex_institutional_daily",
    source_name: "TPEX_3INSTI_DAILY_TRADING",
  });
  if (openApi.status === "READY") return openApi;

  const exactUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(rocDate(input.as_of))}&s=0,asc`;
  const exact = await loadOtcInstitutionalRoute({
    ...input,
    url: exactUrl,
    source_id: "tpex_institutional_exact_date",
    source_name: "TPEX_3INSTI_EXACT_DATE",
    legacy_shape: true,
    extra_headers: {
      Referer: "https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge.php?l=zh-tw",
    },
  });
  if (exact.status === "READY") return exact;

  return {
    ...exact,
    status: openApi.status === "PENDING" || exact.status === "PENDING" ? "PENDING" : "ERROR",
    source_id: "tpex_institutional_exact_date_fallback",
    source_name: "TPEX_3INSTI_DAILY_TRADING->TPEX_3INSTI_EXACT_DATE",
    error: `openapi=${openApi.error ?? openApi.status};exact=${exact.error ?? exact.status}`,
  };
}

async function loadListedMargin(input: {
  as_of: string;
  fetcher: FetchLike;
  minimum_rows: number;
}): Promise<SourceResult<MarginRow>> {
  const retrievedAt = new Date().toISOString();
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compactDate(input.as_of)}&selectType=ALL&response=json`;
  try {
    const body = await fetchJsonCached(url, input.fetcher);
    const sourceDate = observedDatasetDate(body);
    if (sourceDate !== input.as_of) {
      return {
        source_id: "twse_margin_short_mi_margn",
        source_name: "TWSE_MI_MARGN",
        market: "listed",
        status: "PENDING",
        requested_date: input.as_of,
        source_date: sourceDate,
        source_date_verified: false,
        completeness: "FULL_OFFICIAL_DATASET",
        rows: [],
        error: `source_date_mismatch:${sourceDate ?? "missing"}`,
        retrieved_at: retrievedAt,
      };
    }
    const rows = validateOrdinaryRows(
      normalizeTwseMiMargnOfficial(body, input.as_of),
      input.as_of,
      input.minimum_rows,
      "listed",
    );
    return {
      source_id: "twse_margin_short_mi_margn",
      source_name: "TWSE_MI_MARGN",
      market: "listed",
      status: "READY",
      requested_date: input.as_of,
      source_date: sourceDate,
      source_date_verified: true,
      completeness: "FULL_OFFICIAL_DATASET",
      rows,
      error: null,
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    return {
      source_id: "twse_margin_short_mi_margn",
      source_name: "TWSE_MI_MARGN",
      market: "listed",
      status: "ERROR",
      requested_date: input.as_of,
      source_date: null,
      source_date_verified: false,
      completeness: "FULL_OFFICIAL_DATASET",
      rows: [],
      error: error instanceof Error ? error.message : String(error),
      retrieved_at: retrievedAt,
    };
  }
}

async function loadOtcMargin(input: {
  as_of: string;
  fetcher: FetchLike;
  minimum_rows: number;
}): Promise<SourceResult<MarginRow>> {
  const retrievedAt = new Date().toISOString();
  const url = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance";
  try {
    const body = await fetchJsonCached(url, input.fetcher);
    const sourceDate = observedDatasetDate(body);
    if (sourceDate !== input.as_of) {
      return {
        source_id: "tpex_margin_short_balance",
        source_name: "TPEX_MAINBOARD_MARGIN_BALANCE",
        market: "otc",
        status: "PENDING",
        requested_date: input.as_of,
        source_date: sourceDate,
        source_date_verified: false,
        completeness: "FULL_OFFICIAL_DATASET",
        rows: [],
        error: `source_date_mismatch:${sourceDate ?? "missing"}`,
        retrieved_at: retrievedAt,
      };
    }
    const rows = validateOrdinaryRows(
      normalizeTpexMargin(body, input.as_of),
      input.as_of,
      input.minimum_rows,
      "otc",
    );
    return {
      source_id: "tpex_margin_short_balance",
      source_name: "TPEX_MAINBOARD_MARGIN_BALANCE",
      market: "otc",
      status: "READY",
      requested_date: input.as_of,
      source_date: sourceDate,
      source_date_verified: true,
      completeness: "FULL_OFFICIAL_DATASET",
      rows,
      error: null,
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    return {
      source_id: "tpex_margin_short_balance",
      source_name: "TPEX_MAINBOARD_MARGIN_BALANCE",
      market: "otc",
      status: "ERROR",
      requested_date: input.as_of,
      source_date: null,
      source_date_verified: false,
      completeness: "FULL_OFFICIAL_DATASET",
      rows: [],
      error: error instanceof Error ? error.message : String(error),
      retrieved_at: retrievedAt,
    };
  }
}

function combinedStatus<T>(sources: SourceResult<T>[]): FullMarketExactDateStatus {
  if (sources.every((source) => source.status === "READY")) return "READY";
  if (sources.some((source) => source.status === "PENDING")) return "PENDING";
  return "ERROR";
}

function assertNoCrossMarketDuplicates<T extends { symbol: string }>(rows: T[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.symbol)) throw new Error(`cross_market_duplicate_symbol:${row.symbol}`);
    seen.add(row.symbol);
  }
}

function institutionalRank(rows: InstitutionalRow[], key: "foreign_net_shares" | "trust_net_shares", direction: 1 | -1) {
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

function marginProjection(row: MarginRow, rank: number) {
  return {
    rank,
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    margin_change_lots: row.margin_balance_change_lots,
    margin_balance_lots: row.margin_balance_lots,
    short_change_lots: row.short_balance_change_lots,
    short_balance_lots: row.short_balance_lots,
  };
}

function rankMargin(rows: MarginRow[], key: "margin_balance_change_lots" | "short_balance_change_lots", direction: 1 | -1, limit = 20) {
  return rows
    .filter((row) => row[key] !== null && direction * Number(row[key]) > 0)
    .sort((a, b) => direction * (Number(b[key]) - Number(a[key])) || a.symbol.localeCompare(b.symbol))
    .slice(0, limit)
    .map((row, index) => marginProjection(row, index + 1));
}

function rankBalance(rows: MarginRow[], key: "margin_balance_lots" | "short_balance_lots", limit = 20) {
  return rows
    .filter((row) => row[key] !== null)
    .sort((a, b) => Number(b[key]) - Number(a[key]) || a.symbol.localeCompare(b.symbol))
    .slice(0, limit)
    .map((row, index) => marginProjection(row, index + 1));
}

function rankSignal(rows: MarginRow[], predicate: (row: MarginRow) => boolean, limit = 20) {
  return rows
    .filter(predicate)
    .sort((a, b) => {
      const aScore = Math.abs(Number(a.margin_balance_change_lots ?? 0)) + Math.abs(Number(a.short_balance_change_lots ?? 0));
      const bScore = Math.abs(Number(b.margin_balance_change_lots ?? 0)) + Math.abs(Number(b.short_balance_change_lots ?? 0));
      return bScore - aScore || a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit)
    .map((row, index) => marginProjection(row, index + 1));
}

function sumNullable(rows: MarginRow[], key: keyof Pick<MarginRow, "margin_balance_lots" | "margin_balance_change_lots" | "short_balance_lots" | "short_balance_change_lots">) {
  return rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
}

export async function getTwFullMarketInstitutionalOnDemand(input: {
  as_of: string;
  fetcher?: FetchLike;
  min_rows?: { listed: number; otc: number };
}) {
  const asOf = String(input.as_of ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || normalizeTradeDate(asOf) !== asOf) throw new Error("invalid_as_of_date");
  const fetcher = input.fetcher ?? fetch;
  const minimum = input.min_rows ?? { listed: 500, otc: 300 };
  const [listed, otc] = await Promise.all([
    loadListedInstitutional({ as_of: asOf, fetcher, minimum_rows: minimum.listed }),
    loadOtcInstitutional({ as_of: asOf, fetcher, minimum_rows: minimum.otc }),
  ]);
  const sources = [listed, otc];
  const status = combinedStatus(sources);
  const rows = status === "READY" ? [...listed.rows, ...otc.rows] : [];
  let contractError: string | null = null;
  if (status === "READY") {
    try {
      assertNoCrossMarketDuplicates(rows);
    } catch (error) {
      contractError = error instanceof Error ? error.message : String(error);
    }
  }
  const finalStatus: FullMarketExactDateStatus = contractError ? "ERROR" : status;
  const usableRows = finalStatus === "READY" ? rows : [];
  const rankings = finalStatus === "READY"
    ? {
      foreign_buy: institutionalRank(usableRows, "foreign_net_shares", 1),
      foreign_sell: institutionalRank(usableRows, "foreign_net_shares", -1),
      trust_buy: institutionalRank(usableRows, "trust_net_shares", 1),
      trust_sell: institutionalRank(usableRows, "trust_net_shares", -1),
    }
    : { foreign_buy: [], foreign_sell: [], trust_buy: [], trust_sell: [] };
  const completeTopTen = Object.values(rankings).every((group) => group.length === 10);
  const ready = finalStatus === "READY" && completeTopTen;

  return {
    schema: "TW_OFFICIAL_INSTITUTIONAL_RANKINGS_ON_DEMAND_V1",
    version: TW_FULL_MARKET_CHIP_ON_DEMAND_VERSION,
    ok: ready,
    status: ready ? "READY" as const : finalStatus === "READY" ? "ERROR" as const : finalStatus,
    role: ready ? "CURRENT_EXACT_DATE_OFFICIAL_ON_DEMAND" as const : "CURRENT_EXACT_DATE_NOT_READY" as const,
    trade_date: asOf,
    source_date_verified: ready,
    markets: ["listed", "otc"] as const,
    etf_excluded: true,
    ranking_unit: "張",
    previous_day_substitution: false,
    read_only: true,
    persistence: "NONE",
    current_selection_source: ready,
    coverage: {
      listed_rows: listed.rows.length,
      otc_rows: otc.rows.length,
      total_rows: listed.rows.length + otc.rows.length,
    },
    sources: {
      listed: listed.source_name,
      otc: otc.source_name,
    },
    source_health: sources.map(health),
    rankings,
    error: contractError ?? (!completeTopTen && finalStatus === "READY" ? "incomplete_top_ten" : null),
  };
}

export async function getTwFullMarketMarginOnDemand(input: {
  as_of: string;
  fetcher?: FetchLike;
  min_rows?: { listed: number; otc: number };
}) {
  const asOf = String(input.as_of ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || normalizeTradeDate(asOf) !== asOf) throw new Error("invalid_as_of_date");
  const fetcher = input.fetcher ?? fetch;
  const minimum = input.min_rows ?? { listed: 400, otc: 200 };
  const [listed, otc] = await Promise.all([
    loadListedMargin({ as_of: asOf, fetcher, minimum_rows: minimum.listed }),
    loadOtcMargin({ as_of: asOf, fetcher, minimum_rows: minimum.otc }),
  ]);
  const sources = [listed, otc];
  const status = combinedStatus(sources);
  const rows = status === "READY" ? [...listed.rows, ...otc.rows] : [];
  let contractError: string | null = null;
  if (status === "READY") {
    try {
      assertNoCrossMarketDuplicates(rows);
    } catch (error) {
      contractError = error instanceof Error ? error.message : String(error);
    }
  }
  const finalStatus: FullMarketExactDateStatus = contractError ? "ERROR" : status;
  const usableRows = finalStatus === "READY" ? rows : [];

  return {
    schema: "TW_OFFICIAL_FULL_MARKET_MARGIN_ON_DEMAND_V1",
    version: TW_FULL_MARKET_CHIP_ON_DEMAND_VERSION,
    ok: finalStatus === "READY",
    status: finalStatus,
    role: finalStatus === "READY" ? "CURRENT_EXACT_DATE_OFFICIAL_ON_DEMAND" as const : "CURRENT_EXACT_DATE_NOT_READY" as const,
    trade_date: asOf,
    source_date_verified: finalStatus === "READY",
    markets: ["listed", "otc"] as const,
    etf_excluded: true,
    ranking_unit: "張",
    previous_day_substitution: false,
    read_only: true,
    persistence: "NONE",
    current_selection_source: finalStatus === "READY",
    coverage: {
      listed_rows: listed.rows.length,
      otc_rows: otc.rows.length,
      total_rows: listed.rows.length + otc.rows.length,
    },
    sources: {
      listed: listed.source_name,
      otc: otc.source_name,
    },
    source_health: sources.map(health),
    totals: finalStatus === "READY"
      ? {
        margin_balance_lots: sumNullable(usableRows, "margin_balance_lots"),
        margin_change_lots: sumNullable(usableRows, "margin_balance_change_lots"),
        short_balance_lots: sumNullable(usableRows, "short_balance_lots"),
        short_change_lots: sumNullable(usableRows, "short_balance_change_lots"),
      }
      : null,
    rankings: finalStatus === "READY"
      ? {
        margin_increase: rankMargin(usableRows, "margin_balance_change_lots", 1),
        margin_decrease: rankMargin(usableRows, "margin_balance_change_lots", -1),
        short_increase: rankMargin(usableRows, "short_balance_change_lots", 1),
        short_decrease: rankMargin(usableRows, "short_balance_change_lots", -1),
        margin_balance: rankBalance(usableRows, "margin_balance_lots"),
        short_balance: rankBalance(usableRows, "short_balance_lots"),
      }
      : {
        margin_increase: [],
        margin_decrease: [],
        short_increase: [],
        short_decrease: [],
        margin_balance: [],
        short_balance: [],
      },
    signals: finalStatus === "READY"
      ? {
        financing_up_short_down: rankSignal(usableRows, (row) => Number(row.margin_balance_change_lots ?? 0) > 0 && Number(row.short_balance_change_lots ?? 0) < 0),
        financing_down_short_up: rankSignal(usableRows, (row) => Number(row.margin_balance_change_lots ?? 0) < 0 && Number(row.short_balance_change_lots ?? 0) > 0),
        financing_and_short_both_up: rankSignal(usableRows, (row) => Number(row.margin_balance_change_lots ?? 0) > 0 && Number(row.short_balance_change_lots ?? 0) > 0),
        financing_and_short_both_down: rankSignal(usableRows, (row) => Number(row.margin_balance_change_lots ?? 0) < 0 && Number(row.short_balance_change_lots ?? 0) < 0),
      }
      : {
        financing_up_short_down: [],
        financing_down_short_up: [],
        financing_and_short_both_up: [],
        financing_and_short_both_down: [],
      },
    interpretation_scope: {
      margin_short_balances: "OFFICIAL_EXACT_DATE_FULL_MARKET",
      suspension_or_forced_cover_events: "NOT_INCLUDED_IN_THIS_DATASET",
      note: "融資融券增減可用於黃卡籌碼判讀；停券/強制回補事件需另以正式事件來源驗證，不得由餘額變化直接推定。",
    },
    raw_rows_returned: false,
    error: contractError,
  };
}

export function resetTwFullMarketChipOnDemandCacheForTests() {
  requestCache.clear();
}
