import { readGitHubJson } from "./github-data-store.ts";
import {
  normalizeTpexMargin,
  normalizeTpexSblShortSale,
  normalizeTradeDate,
  normalizeTwseSecuritiesLending,
  normalizeTwseSblShortSale,
  type MarginRow,
  type SecuritiesLendingRow,
  type SblShortSaleRow,
  type TwMarket,
  type TwMarketDataKind,
} from "./tw-market-data.ts";
import { normalizeTwseMiMargnOfficial } from "./twse-mi-margin-official.ts";
import { resolveTwseTradingWindowStart } from "./twse-trading-calendar-on-demand.ts";

export const TW_CREDIT_SBL_QUERY_FAST_PATH_VERSION = "tw-credit-sbl-query-fast-path/v1.0.0";
export type CreditSblWindowDays = 1 | 5 | 10 | 20 | 60;

const CREDIT_WINDOWS = [1, 5, 10, 20, 60] as const;
const CACHE_TTL_MS = 5 * 60 * 1000;
const rawCache = new Map<string, { expires_at: number; promise: Promise<unknown> }>();

const CREDIT_SBL_PATTERN = /(?:融資(?:融券|龍卷|餘額|增減|變化)?|融券(?:餘額|增減|變化)?|借(?:券|卷)(?:賣出|放空|空單|餘額|成交|還券|了結)?|\bSBL\b)/i;
const MAINTENANCE_RATIO_PATTERN = /維持率|擔保維持/i;
const LENDING_DETAIL_PATTERN = /借(?:券|卷)(?:(?:餘額|成交|還券|了結|借入)|(?=$|[\s？?，,。]))/i;
const SBL_PATTERN = /借(?:券|卷)(?:賣出|放空|空單)|\bSBL\b/i;
const MARGIN_PATTERN = /融資|融券|信用/i;

type SymbolMonthShard = {
  symbols?: Record<string, Partial<Record<TwMarketDataKind, unknown[]>>>;
};

type HistoryBundle = {
  margin: MarginRow[];
  sbl_short_sale: SblShortSaleRow[];
  securities_lending: SecuritiesLendingRow[];
  datasets: string[];
};

type CurrentLayer<T> = {
  status: "READY" | "READY_EMPTY" | "PENDING" | "ERROR";
  row: T | null;
  source: string;
  source_date: string | null;
  source_date_verified: boolean;
  error: string | null;
};

type WindowResolver = (input: { as_of: string; trading_days: number }) => Promise<{ start_date: string; end_date: string; trading_days: number }>;

type FastPathDeps = {
  fetcher?: typeof fetch;
  history_reader?: (input: { symbol: string; start_date: string; end_date: string }) => Promise<HistoryBundle>;
  window_resolver?: WindowResolver;
};

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthRange(start: string, end: string) {
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  const out: string[] = [];
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function shardPath(month: string, prefix: string) {
  const [year, mon] = month.split("-");
  return `data/market-data/index/${year}/${mon}/${prefix}.json`;
}

async function readArchiveMonth(env: Env, month: string, symbol: string) {
  const compact = await readGitHubJson<SymbolMonthShard>(env, shardPath(month, symbol.slice(0, 1)));
  if (compact.value?.symbols?.[symbol]) return { read: compact, role: "PREFIX_MONTH_COMPACT" as const };
  const legacy = await readGitHubJson<SymbolMonthShard>(env, shardPath(month, symbol.slice(0, 2)));
  return { read: legacy, role: "PREFIX_MONTH_LEGACY_FALLBACK" as const };
}

async function readOfficialHistory(env: Env, input: { symbol: string; start_date: string; end_date: string }): Promise<HistoryBundle> {
  const margin: MarginRow[] = [];
  const sbl: SblShortSaleRow[] = [];
  const lending: SecuritiesLendingRow[] = [];
  const datasets: string[] = [];
  const reads = await Promise.all(monthRange(input.start_date, input.end_date).map((month) => readArchiveMonth(env, month, input.symbol)));
  for (const item of reads) {
    const rows = item.read.value?.symbols?.[input.symbol] ?? {};
    for (const row of (rows.margin ?? []) as MarginRow[]) {
      if (row.trade_date >= input.start_date && row.trade_date <= input.end_date && row.source_priority === "OFFICIAL") margin.push(row);
    }
    for (const row of (rows.sbl_short_sale ?? []) as SblShortSaleRow[]) {
      if (row.trade_date >= input.start_date && row.trade_date <= input.end_date) sbl.push(row);
    }
    for (const row of (rows.securities_lending ?? []) as SecuritiesLendingRow[]) {
      if (row.trade_date >= input.start_date && row.trade_date <= input.end_date) lending.push(row);
    }
    if (rows.margin?.length || rows.sbl_short_sale?.length || rows.securities_lending?.length) {
      datasets.push(`${item.read.path}:${item.role}:${item.read.sha ?? "NO_SHA"}`);
    }
  }
  margin.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  sbl.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  lending.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return { margin, sbl_short_sale: sbl, securities_lending: lending, datasets };
}

function sourceDate(body: unknown) {
  const root = rec(body);
  const direct = normalizeTradeDate(root.date ?? root.Date ?? root["資料日期"] ?? root["日期"] ?? root.TradeDate);
  if (direct) return direct;
  const rows = Array.isArray(body) ? body : Array.isArray(root.data) ? root.data : [];
  for (const raw of rows.slice(0, 20)) {
    const row = rec(raw);
    const value = normalizeTradeDate(row.Date ?? row.date ?? row["資料日期"] ?? row["日期"] ?? row.TradeDate);
    if (value) return value;
  }
  return null;
}

async function fetchJsonCached(url: string, fetcher: typeof fetch) {
  const now = Date.now();
  const cached = rawCache.get(url);
  if (cached && cached.expires_at > now) return cached.promise;
  const promise = (async () => {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Diamond-Credit-SBL-FastPath/1.0",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`http_${response.status}:${text.slice(0, 160)}`);
    try { return JSON.parse(text); }
    catch { throw new Error(`invalid_json:${text.slice(0, 160)}`); }
  })();
  rawCache.set(url, { expires_at: now + CACHE_TTL_MS, promise });
  try { return await promise; }
  catch (error) {
    rawCache.delete(url);
    throw error;
  }
}

function layerFromBody<T>(input: {
  body: unknown;
  symbol: string;
  as_of: string;
  source: string;
  parser: (body: unknown, requestedDate: string) => T[];
  symbolOf: (row: T) => string;
  dateOf: (row: T) => string;
}): CurrentLayer<T> {
  const observed = sourceDate(input.body);
  if (!observed) return { status: "ERROR", row: null, source: input.source, source_date: null, source_date_verified: false, error: "source_date_missing" };
  if (observed !== input.as_of) return { status: "PENDING", row: null, source: input.source, source_date: observed, source_date_verified: false, error: `source_date_mismatch:${observed}` };
  try {
    const row = input.parser(input.body, input.as_of).find((item) => input.symbolOf(item) === input.symbol && input.dateOf(item) === input.as_of) ?? null;
    return {
      status: row ? "READY" : "READY_EMPTY",
      row,
      source: input.source,
      source_date: observed,
      source_date_verified: true,
      error: null,
    };
  } catch (error) {
    return {
      status: "ERROR",
      row: null,
      source: input.source,
      source_date: observed,
      source_date_verified: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchListedMargin(symbol: string, asOf: string, fetcher: typeof fetch): Promise<CurrentLayer<MarginRow>> {
  const body = await fetchJsonCached(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${asOf.replaceAll("-", "")}&selectType=ALL&response=json`, fetcher);
  return layerFromBody({ body, symbol, as_of: asOf, source: "TWSE_MI_MARGN", parser: normalizeTwseMiMargnOfficial, symbolOf: (row) => row.symbol, dateOf: (row) => row.trade_date });
}

async function fetchOtcMargin(symbol: string, asOf: string, fetcher: typeof fetch): Promise<CurrentLayer<MarginRow>> {
  const body = await fetchJsonCached("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance", fetcher);
  return layerFromBody({ body, symbol, as_of: asOf, source: "TPEX_MAINBOARD_MARGIN_BALANCE", parser: normalizeTpexMargin, symbolOf: (row) => row.symbol, dateOf: (row) => row.trade_date });
}

async function fetchListedSbl(symbol: string, asOf: string, fetcher: typeof fetch): Promise<CurrentLayer<SblShortSaleRow>> {
  const body = await fetchJsonCached(`https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date=${asOf.replaceAll("-", "")}&response=json`, fetcher);
  return layerFromBody({ body, symbol, as_of: asOf, source: "TWSE_TWT93U", parser: normalizeTwseSblShortSale, symbolOf: (row) => row.symbol, dateOf: (row) => row.trade_date });
}

async function fetchOtcSbl(symbol: string, asOf: string, fetcher: typeof fetch): Promise<CurrentLayer<SblShortSaleRow>> {
  try {
    const [balanceBody, volumeBody] = await Promise.all([
      fetchJsonCached("https://www.tpex.org.tw/openapi/v1/tpex_margin_sbl", fetcher),
      fetchJsonCached("https://www.tpex.org.tw/openapi/v1/tpex_short_sell", fetcher),
    ]);
    const balanceDate = sourceDate(balanceBody);
    const volumeDate = sourceDate(volumeBody);
    if (!balanceDate) return { status: "ERROR", row: null, source: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL", source_date: null, source_date_verified: false, error: "source_date_missing" };
    if (balanceDate !== asOf || (volumeDate && volumeDate !== asOf)) {
      return { status: "PENDING", row: null, source: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL", source_date: balanceDate, source_date_verified: false, error: `source_date_mismatch:${balanceDate}${volumeDate ? `/${volumeDate}` : ""}` };
    }
    const row = normalizeTpexSblShortSale(balanceBody, volumeBody, asOf).find((item) => item.symbol === symbol && item.trade_date === asOf) ?? null;
    return { status: row ? "READY" : "READY_EMPTY", row, source: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL", source_date: balanceDate, source_date_verified: true, error: null };
  } catch (error) {
    return { status: "ERROR", row: null, source: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL", source_date: null, source_date_verified: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchLending(symbol: string, asOf: string, fetcher: typeof fetch): Promise<CurrentLayer<SecuritiesLendingRow>> {
  const body = await fetchJsonCached(`https://www.twse.com.tw/exchangeReport/TWT72U?date=${asOf.replaceAll("-", "")}&selectType=SLBNLB&response=json`, fetcher);
  return layerFromBody({ body, symbol, as_of: asOf, source: "TWSE_TWT72U", parser: normalizeTwseSecuritiesLending, symbolOf: (row) => row.symbol, dateOf: (row) => row.trade_date });
}

function uniqueByDate<T extends { trade_date: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.trade_date, row);
  return [...map.values()].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

function inferMarket(history: HistoryBundle): TwMarket | null {
  return history.margin.at(-1)?.market ?? history.sbl_short_sale.at(-1)?.market ?? history.securities_lending.at(-1)?.market ?? null;
}

function exactRow<T extends { trade_date: string }>(rows: T[], asOf: string) {
  return rows.find((row) => row.trade_date === asOf) ?? null;
}

function strictSum<T>(rows: T[], pick: (row: T) => number | null) {
  if (!rows.length) return null;
  let sum = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

function lotEquivalent(shares: number | null) {
  return shares === null ? null : shares / 1000;
}

function buildMarginWindow(rows: MarginRow[], start: string, end: string, requestedDays: number) {
  const slice = rows.filter((row) => row.trade_date >= start && row.trade_date <= end);
  const marginChange = strictSum(slice, (row) => row.margin_balance_change_lots);
  const shortChange = strictSum(slice, (row) => row.short_balance_change_lots);
  const complete = slice.length === requestedDays && marginChange !== null && shortChange !== null;
  return {
    status: slice.length ? (complete ? "READY" : "PARTIAL") : "UNAVAILABLE",
    requested_days: requestedDays,
    observed_days: slice.length,
    range_start: start,
    range_end: end,
    margin_balance_change_lots: marginChange,
    short_balance_change_lots: shortChange,
    margin_start_balance_lots: slice[0]?.margin_previous_balance_lots ?? null,
    margin_end_balance_lots: slice.at(-1)?.margin_balance_lots ?? null,
    short_start_balance_lots: slice[0]?.short_previous_balance_lots ?? null,
    short_end_balance_lots: slice.at(-1)?.short_balance_lots ?? null,
    unknown_is_zero: false,
  };
}

function buildSblWindow(rows: SblShortSaleRow[], start: string, end: string, requestedDays: number) {
  const slice = rows.filter((row) => row.trade_date >= start && row.trade_date <= end);
  const sold = strictSum(slice, (row) => row.sold_shares);
  const returned = strictSum(slice, (row) => row.returned_shares);
  const adjustment = strictSum(slice, (row) => row.adjustment_shares);
  const startBalance = slice[0]?.previous_balance_shares ?? null;
  const endBalance = slice.at(-1)?.balance_shares ?? null;
  const balanceChange = startBalance !== null && endBalance !== null ? endBalance - startBalance : null;
  const complete = slice.length === requestedDays && sold !== null && returned !== null && adjustment !== null && balanceChange !== null;
  return {
    status: slice.length ? (complete ? "READY" : "PARTIAL") : "UNAVAILABLE",
    requested_days: requestedDays,
    observed_days: slice.length,
    range_start: start,
    range_end: end,
    sold_shares: sold,
    returned_shares: returned,
    adjustment_shares: adjustment,
    start_balance_shares: startBalance,
    end_balance_shares: endBalance,
    balance_change_shares: balanceChange,
    sold_lots_equivalent: lotEquivalent(sold),
    returned_lots_equivalent: lotEquivalent(returned),
    start_balance_lots_equivalent: lotEquivalent(startBalance),
    end_balance_lots_equivalent: lotEquivalent(endBalance),
    balance_change_lots_equivalent: lotEquivalent(balanceChange),
    unknown_is_zero: false,
  };
}

function buildLendingWindow(rows: SecuritiesLendingRow[], start: string, end: string, requestedDays: number) {
  const slice = rows.filter((row) => row.trade_date >= start && row.trade_date <= end);
  const borrowed = strictSum(slice, (row) => row.borrowed_shares);
  const returned = strictSum(slice, (row) => row.returned_shares);
  const startBalance = slice[0]?.previous_balance_shares ?? null;
  const endBalance = slice.at(-1)?.balance_shares ?? null;
  const balanceChange = startBalance !== null && endBalance !== null ? endBalance - startBalance : null;
  const complete = slice.length === requestedDays && borrowed !== null && returned !== null && balanceChange !== null;
  return {
    status: slice.length ? (complete ? "READY" : "PARTIAL") : "UNAVAILABLE",
    requested_days: requestedDays,
    observed_days: slice.length,
    range_start: start,
    range_end: end,
    borrowed_shares: borrowed,
    returned_shares: returned,
    net_borrowed_shares: borrowed !== null && returned !== null ? borrowed - returned : null,
    start_balance_shares: startBalance,
    end_balance_shares: endBalance,
    balance_change_shares: balanceChange,
    unknown_is_zero: false,
  };
}

function extractWindows(query: string) {
  const found = new Set<CreditSblWindowDays>();
  for (const match of String(query ?? "").matchAll(/(?<!\d)(1|5|10|20|60)\s*(?:日|天|[dD])(?![A-Za-z])/g)) {
    found.add(Number(match[1]) as CreditSblWindowDays);
  }
  if (!found.size) return [...CREDIT_WINDOWS];
  found.add(1);
  return CREDIT_WINDOWS.filter((window) => found.has(window));
}

export function isFamilyCreditSblQueryText(query: string) {
  const text = String(query ?? "");
  if (MAINTENANCE_RATIO_PATTERN.test(text)) return false;
  return CREDIT_SBL_PATTERN.test(text);
}

function requestedLayers(query: string) {
  const text = String(query ?? "");
  const margin = MARGIN_PATTERN.test(text);
  const sbl = SBL_PATTERN.test(text);
  const lending = LENDING_DETAIL_PATTERN.test(text);
  return {
    margin: margin || (!margin && !sbl && !lending),
    sbl: sbl || (!margin && !sbl && !lending),
    lending,
  };
}

async function resolveAsOf(input: {
  as_of: string;
  explicit: boolean;
  resolveWindow: WindowResolver;
}) {
  if (input.explicit) {
    const exact = await input.resolveWindow({ as_of: input.as_of, trading_days: 1 });
    return { resolved: exact.end_date, mode: "EXPLICIT_EXACT_TRADING_DAY" as const };
  }
  let candidate = input.as_of;
  for (let guard = 0; guard < 14; guard += 1) {
    try {
      const exact = await input.resolveWindow({ as_of: candidate, trading_days: 1 });
      return { resolved: exact.end_date, mode: candidate === input.as_of ? "IMPLICIT_CURRENT_TRADING_DAY" as const : "IMPLICIT_LATEST_TRADING_DAY" as const };
    } catch (error) {
      if (!/requested_as_of_not_trading_day/.test(error instanceof Error ? error.message : String(error))) throw error;
      candidate = shiftDays(candidate, -1);
    }
  }
  throw new Error("unable_to_resolve_latest_trading_day");
}

export async function runFamilyCreditSblQueryFastPath(
  env: Env,
  input: {
    symbol: string;
    query: string;
    as_of: string;
    as_of_explicit?: boolean;
  },
  deps: FastPathDeps = {},
) {
  const symbol = String(input.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new Error("invalid_taiwan_symbol");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.as_of)) throw new Error("invalid_as_of_date");
  const baseFetcher = deps.fetcher ?? fetch;
  let externalRequestCount = 0;
  const countedFetcher: typeof fetch = async (...args) => {
    externalRequestCount += 1;
    return baseFetcher(...args);
  };
  const resolveWindow: WindowResolver = deps.window_resolver ?? ((value) => resolveTwseTradingWindowStart({ ...value, fetcher: countedFetcher }));
  let asOfResolution: Awaited<ReturnType<typeof resolveAsOf>>;
  try {
    asOfResolution = await resolveAsOf({ as_of: input.as_of, explicit: input.as_of_explicit === true, resolveWindow });
  } catch (error) {
    return {
      ok: false,
      version: TW_CREDIT_SBL_QUERY_FAST_PATH_VERSION,
      route: "CREDIT_SBL_FAST_PATH" as const,
      status: "INVALID_AS_OF",
      symbol,
      requested_as_of: input.as_of,
      resolved_as_of: null,
      previous_day_substitution: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const resolvedAsOf = asOfResolution.resolved;
  const windows = extractWindows(input.query);
  const windowDefs = await Promise.all(windows.map(async (days) => {
    const range = await resolveWindow({ as_of: resolvedAsOf, trading_days: days });
    return { days, start_date: range.start_date, end_date: range.end_date };
  }));
  const earliest = windowDefs.reduce((min, item) => item.start_date < min ? item.start_date : min, resolvedAsOf);
  const historyReader = deps.history_reader ?? ((value) => readOfficialHistory(env, value));
  const history = await historyReader({ symbol, start_date: earliest, end_date: resolvedAsOf });
  const wants = requestedLayers(input.query);
  let market = inferMarket(history);

  let marginCurrent: CurrentLayer<MarginRow> | null = null;
  let sblCurrent: CurrentLayer<SblShortSaleRow> | null = null;
  let lendingCurrent: CurrentLayer<SecuritiesLendingRow> | null = null;
  const exactMargin = exactRow(history.margin, resolvedAsOf);
  const exactSbl = exactRow(history.sbl_short_sale, resolvedAsOf);
  const exactLending = exactRow(history.securities_lending, resolvedAsOf);

  if (!market) {
    if (wants.margin) {
      marginCurrent = await fetchListedMargin(symbol, resolvedAsOf, countedFetcher);
      if (marginCurrent.row) market = "listed";
      else {
        const otc = await fetchOtcMargin(symbol, resolvedAsOf, countedFetcher);
        if (otc.row) market = "otc";
        if (!marginCurrent.row) marginCurrent = otc;
      }
    } else if (wants.sbl) {
      sblCurrent = await fetchListedSbl(symbol, resolvedAsOf, countedFetcher);
      if (sblCurrent.row) market = "listed";
      else {
        const otc = await fetchOtcSbl(symbol, resolvedAsOf, countedFetcher);
        if (otc.row) market = "otc";
        if (!sblCurrent.row) sblCurrent = otc;
      }
    } else if (wants.lending) {
      lendingCurrent = await fetchLending(symbol, resolvedAsOf, countedFetcher);
      if (lendingCurrent.row) market = lendingCurrent.row.market;
    }
  }

  if (wants.margin && !exactMargin && !marginCurrent) {
    marginCurrent = market === "otc"
      ? await fetchOtcMargin(symbol, resolvedAsOf, countedFetcher)
      : await fetchListedMargin(symbol, resolvedAsOf, countedFetcher);
  }
  if (wants.sbl && !exactSbl && !sblCurrent) {
    sblCurrent = market === "otc"
      ? await fetchOtcSbl(symbol, resolvedAsOf, countedFetcher)
      : await fetchListedSbl(symbol, resolvedAsOf, countedFetcher);
  }
  if (wants.lending && !exactLending && !lendingCurrent) {
    lendingCurrent = await fetchLending(symbol, resolvedAsOf, countedFetcher);
  }

  const marginRows = uniqueByDate([...history.margin, ...(marginCurrent?.row ? [marginCurrent.row] : [])]);
  const sblRows = uniqueByDate([...history.sbl_short_sale, ...(sblCurrent?.row ? [sblCurrent.row] : [])]);
  const lendingRows = uniqueByDate([...history.securities_lending, ...(lendingCurrent?.row ? [lendingCurrent.row] : [])]);
  const marginWindows = Object.fromEntries(windowDefs.map((window) => [`${window.days}D`, buildMarginWindow(marginRows, window.start_date, window.end_date, window.days)]));
  const sblWindows = Object.fromEntries(windowDefs.map((window) => [`${window.days}D`, buildSblWindow(sblRows, window.start_date, window.end_date, window.days)]));
  const lendingWindows = Object.fromEntries(windowDefs.map((window) => [`${window.days}D`, buildLendingWindow(lendingRows, window.start_date, window.end_date, window.days)]));

  const selectedWindowMaps = [wants.margin ? marginWindows : null, wants.sbl ? sblWindows : null, wants.lending ? lendingWindows : null].filter(Boolean) as Record<string, any>[];
  const states = selectedWindowMaps.flatMap((map) => Object.values(map).map((value: any) => value.status));
  const status = states.length && states.every((value) => value === "READY")
    ? "READY"
    : states.some((value) => value === "READY" || value === "PARTIAL")
      ? "DEGRADED"
      : "UNAVAILABLE";

  return {
    ok: status !== "UNAVAILABLE",
    version: TW_CREDIT_SBL_QUERY_FAST_PATH_VERSION,
    route: "CREDIT_SBL_FAST_PATH" as const,
    read_only: true,
    persistence: "NONE" as const,
    symbol,
    market,
    query: input.query,
    requested_as_of: input.as_of,
    resolved_as_of: resolvedAsOf,
    as_of_resolution: asOfResolution.mode,
    previous_day_substitution: false,
    requested_windows: windows,
    requested_layers: wants,
    status,
    layers: {
      margin_short: wants.margin ? {
        latest: marginRows.at(-1) ?? null,
        rows: marginRows.slice(-60),
        windows: marginWindows,
        current_source: exactMargin ? "OFFICIAL_GITHUB_ARCHIVE_EXACT_DATE" : marginCurrent?.source ?? null,
        current_status: exactMargin ? "READY" : marginCurrent?.status ?? "UNAVAILABLE",
      } : null,
      sbl_short_sale: wants.sbl ? {
        latest: sblRows.at(-1) ?? null,
        rows: sblRows.slice(-60),
        windows: sblWindows,
        current_source: exactSbl ? "OFFICIAL_GITHUB_ARCHIVE_EXACT_DATE" : sblCurrent?.source ?? null,
        current_status: exactSbl ? "READY" : sblCurrent?.status ?? "UNAVAILABLE",
        semantics: "借券賣出餘額是已借券賣出且尚未回補的部位；借券成交/借券餘額本身不等同放空。",
      } : null,
      securities_lending: wants.lending ? {
        latest: lendingRows.at(-1) ?? null,
        rows: lendingRows.slice(-60),
        windows: lendingWindows,
        current_source: exactLending ? "OFFICIAL_GITHUB_ARCHIVE_EXACT_DATE" : lendingCurrent?.source ?? null,
        current_status: exactLending ? "READY" : lendingCurrent?.status ?? "UNAVAILABLE",
      } : null,
    },
    history_context: {
      source: "TV_PAPERTRADER_OFFICIAL_MARKET_DATA_ARCHIVE",
      role: "OFFICIAL_HISTORY_CONTEXT_ONLY",
      range_start: earliest,
      range_end: resolvedAsOf,
      datasets: history.datasets,
      margin_rows: marginRows.length,
      sbl_rows: sblRows.length,
      lending_rows: lendingRows.length,
      missing_days_are_unknown_not_zero: true,
    },
    diagnostics: {
      current_market_provider_http_requests: externalRequestCount,
      full_chip_snapshot_used: false,
      heavy_family_analysis_used: false,
      ohlc_fetch: false,
      jin10_fetch: false,
      fundamental_fetch: false,
      moneydj_fetch: false,
      web_fetch: false,
      finmind_fetch: false,
    },
    response_instructions: [
      "只依本 fast path 的 TWSE/TPEx official current evidence 與既有 official history context 回答融資、融券、借券與借券賣出問題；不要啟動完整11點研究。",
      "explicit 日期必須 exact-date；未明示日期才允許解析為最近交易日，並必須顯示 resolved_as_of。",
      "UNKNOWN/null 絕對不得當成 0；window status=PARTIAL 代表歷史觀測不足，不得包裝成完整趨勢。",
      "借券賣出餘額與單純借券餘額是不同概念；不得把借券成交直接等同新增空單。",
      "SBL 正式原始單位保留 shares；lots_equivalent 只供顯示換算。",
    ],
  };
}

export function resetTwCreditSblFastPathCacheForTests() {
  rawCache.clear();
}
