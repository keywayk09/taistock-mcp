import {
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTradeDate,
  normalizeTwseInstitutional,
  type InstitutionalRow,
  type MarginRow,
} from "./tw-market-data.ts";
import { getTpexInstitutionalPayload, getTpexMarginPayload } from "./tpex-cloudflare-transport.ts";
import { normalizeTwseMiMargnOfficial } from "./twse-mi-margin-official.ts";

export const TW_FULL_MARKET_ON_DEMAND_VERSION = "tw-full-market-on-demand/v1.1.0";

export type TwFullMarketStatus = "READY" | "PENDING" | "ERROR";

type FetchLike = typeof fetch;

type SourceResult<T> = {
  source_id: string;
  source_name: string;
  market: "listed" | "otc";
  status: TwFullMarketStatus;
  requested_date: string;
  source_date: string | null;
  source_date_verified: boolean;
  rows: T[];
  error: string | null;
  retrieved_at: string;
};

type FullMarketInput = {
  as_of?: string;
  fetcher?: FetchLike;
  min_rows?: { listed?: number; otc?: number };
  tpex_payload_loader?: (tradeDate: string) => Promise<unknown>;
};

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function sourceDate(body: unknown): string | null {
  const root = rec(body);
  const direct = normalizeTradeDate(root.date ?? root.Date ?? root["資料日期"] ?? root["日期"] ?? root.TradeDate);
  if (direct) return direct;

  const rows = Array.isArray(body)
    ? body
    : Array.isArray(root.data)
      ? root.data
      : [];
  for (const value of rows.slice(0, 20)) {
    const row = rec(value);
    const date = normalizeTradeDate(row.Date ?? row.date ?? row["資料日期"] ?? row["日期"] ?? row.TradeDate);
    if (date) return date;
  }
  return null;
}

function isCommonStockSymbol(symbol: string) {
  return /^[1-9]\d{3}$/.test(symbol);
}

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);
const DIRECT_RETRY_DELAYS_MS = [0, 150, 500] as const;

function sleepMs(ms: number) {
  return ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function fetchFreshJson(url: string, fetcher: FetchLike): Promise<unknown> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < DIRECT_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleepMs(DIRECT_RETRY_DELAYS_MS[attempt]);

    try {
      const response = await fetcher(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "Diamond-Official-Full-Market-On-Demand/1.1",
        },
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error("http_" + response.status + ":" + text.slice(0, 160));
        lastError = error;
        if (TRANSIENT_HTTP_STATUS.has(response.status) && attempt + 1 < DIRECT_RETRY_DELAYS_MS.length) continue;
        throw error;
      }
      try {
        return JSON.parse(text);
      } catch {
        const error = new Error("invalid_json:" + text.slice(0, 160));
        lastError = error;
        if (attempt + 1 < DIRECT_RETRY_DELAYS_MS.length) continue;
        throw error;
      }
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const nonRetryableHttp = message.match(/^http_(\d{3}):/);
      if (nonRetryableHttp && !TRANSIENT_HTTP_STATUS.has(Number(nonRetryableHttp[1]))) throw error;
      if (attempt + 1 >= DIRECT_RETRY_DELAYS_MS.length) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "official_fetch_failed"));
}

async function loadFullMarketSource<T extends { trade_date: string; symbol: string }>(input: {
  source_id: string;
  source_name: string;
  market: "listed" | "otc";
  as_of: string;
  min_rows: number;
  load_body: () => Promise<unknown>;
  parser: (body: unknown, requestedDate: string) => T[];
}): Promise<SourceResult<T>> {
  const retrievedAt = new Date().toISOString();
  try {
    const body = await input.load_body();
    const observedDate = sourceDate(body);
    if (!observedDate) {
      return {
        source_id: input.source_id,
        source_name: input.source_name,
        market: input.market,
        status: "ERROR",
        requested_date: input.as_of,
        source_date: null,
        source_date_verified: false,
        rows: [],
        error: "source_date_missing",
        retrieved_at: retrievedAt,
      };
    }
    if (observedDate !== input.as_of) {
      return {
        source_id: input.source_id,
        source_name: input.source_name,
        market: input.market,
        status: "PENDING",
        requested_date: input.as_of,
        source_date: observedDate,
        source_date_verified: false,
        rows: [],
        error: "source_date_mismatch:" + observedDate,
        retrieved_at: retrievedAt,
      };
    }

    const rows = input.parser(body, input.as_of)
      .filter((row) => row.trade_date === input.as_of && isCommonStockSymbol(row.symbol));
    if (rows.length < input.min_rows) {
      return {
        source_id: input.source_id,
        source_name: input.source_name,
        market: input.market,
        status: "ERROR",
        requested_date: input.as_of,
        source_date: observedDate,
        source_date_verified: true,
        rows: [],
        error: "incomplete_rows:" + rows.length + "<" + input.min_rows,
        retrieved_at: retrievedAt,
      };
    }

    return {
      source_id: input.source_id,
      source_name: input.source_name,
      market: input.market,
      status: "READY",
      requested_date: input.as_of,
      source_date: observedDate,
      source_date_verified: true,
      rows,
      error: null,
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pending = /source_date_mismatch|exact_date_empty|not[_ -]?published/i.test(message);
    const match = message.match(/source_date_mismatch:([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    return {
      source_id: input.source_id,
      source_name: input.source_name,
      market: input.market,
      status: pending ? "PENDING" : "ERROR",
      requested_date: input.as_of,
      source_date: match?.[1] ?? null,
      source_date_verified: false,
      rows: [],
      error: message,
      retrieved_at: retrievedAt,
    };
  }
}

function sourceHealth<T>(source: SourceResult<T>) {
  return {
    source_id: source.source_id,
    source_name: source.source_name,
    market: source.market,
    status: source.status,
    requested_date: source.requested_date,
    source_date: source.source_date,
    source_date_verified: source.source_date_verified,
    error: source.error,
    retrieved_at: source.retrieved_at,
  };
}

function combinedStatus(sources: Array<{ status: TwFullMarketStatus }>): TwFullMarketStatus {
  if (sources.every((source) => source.status === "READY")) return "READY";
  if (sources.some((source) => source.status === "PENDING")) return "PENDING";
  return "ERROR";
}

function firstDuplicateSymbol(rows: Array<{ symbol: string }>) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.symbol)) return row.symbol;
    seen.add(row.symbol);
  }
  return null;
}

function institutionalRanking(
  rows: InstitutionalRow[],
  key: "foreign_net_shares" | "trust_net_shares",
  direction: 1 | -1,
) {
  return [...rows]
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

function marginRanking(
  rows: MarginRow[],
  key: "margin_balance_change_lots" | "short_balance_change_lots" | "margin_balance_lots" | "short_balance_lots",
  direction: 1 | -1,
) {
  return [...rows]
    .filter((row) => typeof row[key] === "number" && direction * Number(row[key]) > 0)
    .sort((a, b) => direction * (Number(b[key]) - Number(a[key])) || a.symbol.localeCompare(b.symbol))
    .slice(0, 10)
    .map((row, index) => ({
      rank: index + 1,
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      value_lots: Number(row[key]),
      margin_balance_lots: row.margin_balance_lots,
      margin_balance_change_lots: row.margin_balance_change_lots,
      short_balance_lots: row.short_balance_lots,
      short_balance_change_lots: row.short_balance_change_lots,
    }));
}

function marginTotals(rows: MarginRow[]) {
  const sum = (key: keyof MarginRow) => rows.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
  return {
    rows: rows.length,
    margin_balance_lots: sum("margin_balance_lots"),
    margin_balance_change_lots: sum("margin_balance_change_lots"),
    short_balance_lots: sum("short_balance_lots"),
    short_balance_change_lots: sum("short_balance_change_lots"),
  };
}

export async function getTwOfficialMarketInstitutionalOnDemand(input: FullMarketInput = {}) {
  const asOf = input.as_of ?? taipeiToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("invalid_as_of_date");
  const fetcher = input.fetcher ?? fetch;
  const compact = compactDate(asOf);
  const minListed = input.min_rows?.listed ?? 500;
  const minOtc = input.min_rows?.otc ?? 300;
  const tpexLoader = input.tpex_payload_loader ?? getTpexInstitutionalPayload;

  const [listed, otc] = await Promise.all([
    loadFullMarketSource<InstitutionalRow>({
      source_id: "twse_institutional_t86",
      source_name: "TWSE_T86_ALLBUT0999",
      market: "listed",
      as_of: asOf,
      min_rows: minListed,
      load_body: () => fetchFreshJson(
        "https://www.twse.com.tw/rwd/zh/fund/T86?date=" + compact + "&selectType=ALLBUT0999&response=json",
        fetcher,
      ),
      parser: normalizeTwseInstitutional,
    }),
    loadFullMarketSource<InstitutionalRow>({
      source_id: "tpex_institutional_exact_date",
      source_name: "TPEX_OFFICIAL_EXACT_DATE_GATEWAY",
      market: "otc",
      as_of: asOf,
      min_rows: minOtc,
      load_body: () => tpexLoader(asOf),
      parser: normalizeTpexInstitutional,
    }),
  ]);

  const status = combinedStatus([listed, otc]);
  const all = status === "READY" ? [...listed.rows, ...otc.rows] : [];
  const duplicateSymbol = firstDuplicateSymbol(all);
  const rankings = status === "READY" && !duplicateSymbol ? {
    foreign_buy: institutionalRanking(all, "foreign_net_shares", 1),
    foreign_sell: institutionalRanking(all, "foreign_net_shares", -1),
    trust_buy: institutionalRanking(all, "trust_net_shares", 1),
    trust_sell: institutionalRanking(all, "trust_net_shares", -1),
  } : null;
  const completeRankings = rankings !== null && Object.values(rankings).every((group) => group.length === 10);
  const ready = status === "READY" && !duplicateSymbol && completeRankings;

  return {
    schema: "TW_OFFICIAL_INSTITUTIONAL_RANKINGS_V2",
    status: ready ? "READY" as const : status === "PENDING" ? "PENDING" as const : "ERROR" as const,
    trade_date: asOf,
    source_date_verified: ready,
    markets: ["listed", "otc"] as const,
    etf_excluded: true,
    ranking_unit: "張" as const,
    previous_day_substitution: false,
    read_only: true,
    persistence: "NONE" as const,
    retrieval_mode: "OFFICIAL_EXACT_DATE_ON_DEMAND" as const,
    coverage: {
      listed_rows: listed.rows.length,
      otc_rows: otc.rows.length,
      total_rows: all.length,
    },
    sources: {
      listed: listed.source_name,
      otc: otc.source_name,
    },
    rankings,
    source_health: [sourceHealth(listed), sourceHealth(otc)],
    error: duplicateSymbol
      ? "cross_market_duplicate_symbol:" + duplicateSymbol
      : status === "READY" && !completeRankings
        ? "incomplete_top_ten"
        : null,
  };
}

export async function getTwOfficialMarketMarginOnDemand(input: FullMarketInput = {}) {
  const asOf = input.as_of ?? taipeiToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("invalid_as_of_date");
  const fetcher = input.fetcher ?? fetch;
  const compact = compactDate(asOf);
  const minListed = input.min_rows?.listed ?? 400;
  const minOtc = input.min_rows?.otc ?? 250;
  const tpexLoader = input.tpex_payload_loader ?? getTpexMarginPayload;

  const [listed, otc] = await Promise.all([
    loadFullMarketSource<MarginRow>({
      source_id: "twse_margin_short_mi_margn",
      source_name: "TWSE_MI_MARGN",
      market: "listed",
      as_of: asOf,
      min_rows: minListed,
      load_body: () => fetchFreshJson(
        "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=" + compact + "&selectType=ALL&response=json",
        fetcher,
      ),
      parser: normalizeTwseMiMargnOfficial,
    }),
    loadFullMarketSource<MarginRow>({
      source_id: "tpex_margin_short_exact_date",
      source_name: "TPEX_OFFICIAL_EXACT_DATE_GATEWAY",
      market: "otc",
      as_of: asOf,
      min_rows: minOtc,
      load_body: () => tpexLoader(asOf),
      parser: normalizeTpexMargin,
    }),
  ]);

  const status = combinedStatus([listed, otc]);
  const all = status === "READY" ? [...listed.rows, ...otc.rows] : [];
  const duplicateSymbol = firstDuplicateSymbol(all);
  const ready = status === "READY" && !duplicateSymbol;

  return {
    schema: "TW_OFFICIAL_MARGIN_CROSS_SECTION_V1",
    status: ready ? "READY" as const : status === "PENDING" ? "PENDING" as const : "ERROR" as const,
    trade_date: asOf,
    source_date_verified: ready,
    markets: ["listed", "otc"] as const,
    etf_excluded: true,
    ranking_unit: "張" as const,
    previous_day_substitution: false,
    read_only: true,
    persistence: "NONE" as const,
    retrieval_mode: "OFFICIAL_EXACT_DATE_ON_DEMAND" as const,
    coverage: {
      listed_rows: listed.rows.length,
      otc_rows: otc.rows.length,
      total_rows: all.length,
    },
    sources: {
      listed: listed.source_name,
      otc: otc.source_name,
    },
    market_totals: ready ? {
      listed: marginTotals(listed.rows),
      otc: marginTotals(otc.rows),
      total: marginTotals(all),
    } : null,
    rankings: ready ? {
      margin_increase: marginRanking(all, "margin_balance_change_lots", 1),
      margin_decrease: marginRanking(all, "margin_balance_change_lots", -1),
      short_increase: marginRanking(all, "short_balance_change_lots", 1),
      short_decrease: marginRanking(all, "short_balance_change_lots", -1),
      margin_balance: marginRanking(all, "margin_balance_lots", 1),
      short_balance: marginRanking(all, "short_balance_lots", 1),
    } : null,
    source_health: [sourceHealth(listed), sourceHealth(otc)],
    error: duplicateSymbol ? "cross_market_duplicate_symbol:" + duplicateSymbol : null,
  };
}
