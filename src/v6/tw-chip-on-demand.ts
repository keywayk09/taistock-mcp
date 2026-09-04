import {
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTpexSblShortSale,
  normalizeTradeDate,
  normalizeTwseInstitutional,
  normalizeTwseSecuritiesLending,
  normalizeTwseSblShortSale,
  type InstitutionalRow,
  type MarginRow,
  type SecuritiesLendingRow,
  type SblShortSaleRow,
} from "./tw-market-data.ts";
import { normalizeTwseMiMargnOfficial } from "./twse-mi-margin-official.ts";

export const TW_CHIP_ON_DEMAND_VERSION = "tw-chip-on-demand/v1.0.0";

export type TwChipFetchStatus = "READY" | "READY_EMPTY" | "PENDING" | "ERROR";
export type TwChipResolvedMarket = "listed" | "otc" | null;

type FetchLike = typeof fetch;
type Row = InstitutionalRow | MarginRow | SecuritiesLendingRow | SblShortSaleRow;

type SourceResult<T extends Row> = {
  source_id: string;
  source_name: string;
  market: "listed" | "otc" | "both";
  status: TwChipFetchStatus;
  requested_date: string;
  source_date: string | null;
  source_date_verified: boolean;
  completeness: "FULL_OFFICIAL_DATASET";
  rows: T[];
  error: string | null;
  retrieved_at: string;
};

type LayerResult<T extends Row> = {
  status: TwChipFetchStatus;
  requested_date: string;
  market: TwChipResolvedMarket;
  latest: T | null;
  rows: T[];
  source_ids: string[];
  source_date_verified: boolean;
  completeness: "FULL_OFFICIAL_DATASET";
  notes: string[];
};

type CacheEntry = {
  expires_at: number;
  promise: Promise<unknown>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const memoryCache = new Map<string, CacheEntry>();

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

async function fetchJsonCached(url: string, fetcher: FetchLike): Promise<unknown> {
  const now = Date.now();
  const cached = memoryCache.get(url);
  if (cached && cached.expires_at > now) return cached.promise;

  const promise = (async () => {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Diamond-On-Demand-Chip/1.0",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`http_${response.status}:${text.slice(0, 160)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`invalid_json:${text.slice(0, 160)}`);
    }
  })();

  memoryCache.set(url, { expires_at: now + CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    memoryCache.delete(url);
    throw error;
  }
}

function filterSymbol<T extends Row>(rows: T[], symbol: string, asOf: string) {
  return rows.filter((row) => row.symbol === symbol && row.trade_date === asOf);
}

async function loadSource<T extends Row>(input: {
  source_id: string;
  source_name: string;
  market: "listed" | "otc" | "both";
  url: string;
  as_of: string;
  symbol: string;
  fetcher: FetchLike;
  parser: (body: unknown, requestedDate: string) => T[];
}): Promise<SourceResult<T>> {
  const retrievedAt = new Date().toISOString();
  try {
    const body = await fetchJsonCached(input.url, input.fetcher);
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
        completeness: "FULL_OFFICIAL_DATASET",
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
        completeness: "FULL_OFFICIAL_DATASET",
        rows: [],
        error: `source_date_mismatch:${observedDate}`,
        retrieved_at: retrievedAt,
      };
    }

    const rows = filterSymbol(input.parser(body, input.as_of), input.symbol, input.as_of);
    return {
      source_id: input.source_id,
      source_name: input.source_name,
      market: input.market,
      status: rows.length ? "READY" : "READY_EMPTY",
      requested_date: input.as_of,
      source_date: observedDate,
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
      market: input.market,
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

async function loadTpexSbl(input: { as_of: string; symbol: string; fetcher: FetchLike }): Promise<SourceResult<SblShortSaleRow>> {
  const retrievedAt = new Date().toISOString();
  const balanceUrl = "https://www.tpex.org.tw/openapi/v1/tpex_margin_sbl";
  const volumeUrl = "https://www.tpex.org.tw/openapi/v1/tpex_short_sell";
  try {
    const [balance, volume] = await Promise.all([
      fetchJsonCached(balanceUrl, input.fetcher),
      fetchJsonCached(volumeUrl, input.fetcher),
    ]);
    const balanceDate = sourceDate(balance);
    const volumeDate = sourceDate(volume);
    if (!balanceDate) throw new Error("source_date_missing:tpex_margin_sbl");
    if (balanceDate !== input.as_of || (volumeDate && volumeDate !== input.as_of)) {
      return {
        source_id: "tpex_sbl_short_sale",
        source_name: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL",
        market: "otc",
        status: "PENDING",
        requested_date: input.as_of,
        source_date: balanceDate,
        source_date_verified: false,
        completeness: "FULL_OFFICIAL_DATASET",
        rows: [],
        error: `source_date_mismatch:${balanceDate}${volumeDate ? `/${volumeDate}` : ""}`,
        retrieved_at: retrievedAt,
      };
    }
    const rows = filterSymbol(normalizeTpexSblShortSale(balance, volume, input.as_of), input.symbol, input.as_of);
    return {
      source_id: "tpex_sbl_short_sale",
      source_name: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL",
      market: "otc",
      status: rows.length ? "READY" : "READY_EMPTY",
      requested_date: input.as_of,
      source_date: balanceDate,
      source_date_verified: true,
      completeness: "FULL_OFFICIAL_DATASET",
      rows,
      error: null,
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    return {
      source_id: "tpex_sbl_short_sale",
      source_name: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL",
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

function inferMarket(results: Array<SourceResult<Row>>): TwChipResolvedMarket {
  for (const result of results) {
    const market = result.rows[0]?.market;
    if (market === "listed" || market === "otc") return market;
  }
  return null;
}

function choosePair<T extends Row>(
  listed: SourceResult<T>,
  otc: SourceResult<T>,
  market: TwChipResolvedMarket,
): LayerResult<T> {
  const candidates = market === "listed" ? [listed] : market === "otc" ? [otc] : [listed, otc];
  const rows = candidates.flatMap((item) => item.rows);
  const pending = candidates.some((item) => item.status === "PENDING");
  const errors = candidates.some((item) => item.status === "ERROR");
  const verified = candidates.every((item) => item.source_date_verified);
  const status: TwChipFetchStatus = rows.length
    ? "READY"
    : pending
      ? "PENDING"
      : errors
        ? "ERROR"
        : "READY_EMPTY";
  return {
    status,
    requested_date: listed.requested_date,
    market,
    latest: rows.at(-1) ?? null,
    rows,
    source_ids: candidates.map((item) => item.source_id),
    source_date_verified: verified,
    completeness: "FULL_OFFICIAL_DATASET",
    notes: [
      ...(status === "READY_EMPTY" ? ["Exact-date official dataset was available but this symbol had no row; do not coerce absence to zero."] : []),
      ...(pending ? ["Requested date is not yet published by at least one relevant official source; previous-day substitution is forbidden."] : []),
    ],
  };
}

function singleLayer<T extends Row>(source: SourceResult<T>, market: TwChipResolvedMarket): LayerResult<T> {
  return {
    status: source.status,
    requested_date: source.requested_date,
    market,
    latest: source.rows.at(-1) ?? null,
    rows: source.rows,
    source_ids: [source.source_id],
    source_date_verified: source.source_date_verified,
    completeness: "FULL_OFFICIAL_DATASET",
    notes: source.status === "READY_EMPTY"
      ? ["Exact-date official dataset was available but this symbol had no row; do not coerce absence to zero."]
      : source.status === "PENDING"
        ? ["Requested date is not yet published; previous-day substitution is forbidden."]
        : [],
  };
}

export async function getTwChipOnDemandSnapshot(input: {
  symbol: string;
  as_of?: string;
  fetcher?: FetchLike;
}) {
  const symbol = String(input.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new Error("invalid_taiwan_symbol");
  const asOf = input.as_of ?? taipeiToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("invalid_as_of_date");
  const fetcher = input.fetcher ?? fetch;
  const compact = compactDate(asOf);

  const [instListed, instOtc, marginListed, marginOtc, lending, sblListed, sblOtc] = await Promise.all([
    loadSource<InstitutionalRow>({
      source_id: "twse_institutional_t86",
      source_name: "TWSE_T86",
      market: "listed",
      url: `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALLBUT0999&response=json`,
      as_of: asOf,
      symbol,
      fetcher,
      parser: normalizeTwseInstitutional,
    }),
    loadSource<InstitutionalRow>({
      source_id: "tpex_institutional_daily",
      source_name: "TPEX_3INSTI_DAILY_TRADING",
      market: "otc",
      url: "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading",
      as_of: asOf,
      symbol,
      fetcher,
      parser: normalizeTpexInstitutional,
    }),
    loadSource<MarginRow>({
      source_id: "twse_margin_short_mi_margn",
      source_name: "TWSE_MI_MARGN",
      market: "listed",
      url: `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`,
      as_of: asOf,
      symbol,
      fetcher,
      parser: normalizeTwseMiMargnOfficial,
    }),
    loadSource<MarginRow>({
      source_id: "tpex_margin_short_balance",
      source_name: "TPEX_MAINBOARD_MARGIN_BALANCE",
      market: "otc",
      url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance",
      as_of: asOf,
      symbol,
      fetcher,
      parser: normalizeTpexMargin,
    }),
    loadSource<SecuritiesLendingRow>({
      source_id: "twse_securities_lending_twt72u",
      source_name: "TWSE_TWT72U",
      market: "both",
      url: `https://www.twse.com.tw/exchangeReport/TWT72U?date=${compact}&selectType=SLBNLB&response=json`,
      as_of: asOf,
      symbol,
      fetcher,
      parser: normalizeTwseSecuritiesLending,
    }),
    loadSource<SblShortSaleRow>({
      source_id: "twse_sbl_short_sale_twt93u",
      source_name: "TWSE_TWT93U",
      market: "listed",
      url: `https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date=${compact}&response=json`,
      as_of: asOf,
      symbol,
      fetcher,
      parser: normalizeTwseSblShortSale,
    }),
    loadTpexSbl({ as_of: asOf, symbol, fetcher }),
  ]);

  const allSources: Array<SourceResult<Row>> = [instListed, instOtc, marginListed, marginOtc, lending, sblListed, sblOtc];
  const market = inferMarket(allSources);
  const institutional = choosePair(instListed, instOtc, market);
  const marginShort = choosePair(marginListed, marginOtc, market);
  const securitiesLending = singleLayer(lending, market);
  const sblShortSale = choosePair(sblListed, sblOtc, market);
  const layers = {
    institutional,
    margin_short: marginShort,
    securities_lending: securitiesLending,
    sbl_short_sale: sblShortSale,
  };
  const layerStatuses = Object.values(layers).map((layer) => layer.status);
  const readyCount = layerStatuses.filter((status) => status === "READY" || status === "READY_EMPTY").length;
  const pendingCount = layerStatuses.filter((status) => status === "PENDING").length;
  const overallStatus = readyCount === layerStatuses.length
    ? "READY"
    : readyCount === 0 && pendingCount > 0
      ? "PENDING"
      : readyCount === 0
        ? "UNAVAILABLE"
        : "DEGRADED";

  return {
    ok: overallStatus !== "UNAVAILABLE",
    version: TW_CHIP_ON_DEMAND_VERSION,
    mode: "ON_DEMAND_ONLY" as const,
    read_only: true,
    persistence: "NONE" as const,
    raw_persistence: "NONE" as const,
    normalized_persistence: "NONE" as const,
    symbol,
    requested_as_of: asOf,
    market,
    status: overallStatus,
    previous_day_substitution: false,
    cache_policy: "EPHEMERAL_MEMORY_5_MINUTES_PER_WORKER_ISOLATE",
    layers,
    source_health: allSources.map((source) => ({
      source_id: source.source_id,
      source_name: source.source_name,
      market: source.market,
      status: source.status,
      requested_date: source.requested_date,
      source_date: source.source_date,
      source_date_verified: source.source_date_verified,
      completeness: source.completeness,
      error: source.error,
      retrieved_at: source.retrieved_at,
    })),
    experimental_extensions: {
      broker_branch: {
        status: "EXPERIMENTAL_ROUTING_ONLY",
        completeness: "RANKED_ONLY",
        persistence: "NONE",
        note: "Broker-branch pages are secondary ranked evidence and are intentionally not treated as a complete broker inventory.",
      },
      warrant: {
        status: "FAIL_CLOSED_UNTIL_FIELD_CONTRACT_VERIFIED",
        persistence: "NONE",
      },
      maintenance_ratio: {
        status: "FAIL_CLOSED_ACCOUNT_LEVEL_NOT_PUBLIC",
        note: "Public market aggregates cannot reconstruct a broker customer's true account maintenance ratio.",
      },
    },
  };
}

export function resetTwChipOnDemandCacheForTests() {
  memoryCache.clear();
}
