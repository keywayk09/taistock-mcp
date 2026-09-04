import {
  resolveTwseTradingWindowStart,
  TWSE_TRADING_CALENDAR_ON_DEMAND_VERSION,
} from "./twse-trading-calendar-on-demand.ts";

export const TW_BROKER_RANKED_ON_DEMAND_VERSION = "tw-broker-ranked-on-demand/v1.5.0";

export type TwBrokerWindowDays = 1 | 5 | 10 | 20 | 40 | 60 | 120 | 240;

type FetchLike = typeof fetch;

type RankedBrokerRow = {
  side: "BUY" | "SELL";
  rank: number;
  broker_branch: string;
  buy_lots: number;
  sell_lots: number;
  net_lots: number;
  turnover_share_pct: number | null;
};

type DecodedPage = {
  text: string;
  charset: string;
  charset_resolution: "HTTP_HEADER" | "HTML_META" | "AUTO_SEMANTIC";
  attempts: number;
  http_status: number;
};

type CacheEntry = { expires_at: number; promise: Promise<DecodedPage> };
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_TRANSPORT_ATTEMPTS = 2;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504, 520]);
const cache = new Map<string, CacheEntry>();

const WINDOW_CONFIG: Record<TwBrokerWindowDays, { selector: number; label: string }> = {
  1: { selector: 1, label: "近一日" },
  5: { selector: 2, label: "近五日" },
  10: { selector: 3, label: "近十日" },
  20: { selector: 4, label: "近20日" },
  40: { selector: 5, label: "近40日" },
  60: { selector: 6, label: "近60日" },
  120: { selector: 7, label: "近120日" },
  240: { selector: 8, label: "近240日" },
};

const DEFAULT_MULTI_WINDOWS = [1, 5, 10, 20, 60] as const;

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

function textOf(html: string) {
  return decodeHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberOf(value: string): number | null {
  const cleaned = value.replace(/,/g, "").replace(/%/g, "").replace(/\+/g, "").trim();
  if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizePageDate(raw: string, requestedDate: string) {
  const text = raw.trim().replace(/／/g, "/").replace(/．/g, ".");
  const full = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (full) return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  const short = text.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
  if (short) return `${requestedDate.slice(0, 4)}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  return null;
}

function parseUpdatedDate(html: string, requestedDate: string) {
  const text = textOf(html);
  const match = text.match(/(?:最後更新日(?:期)?|更新日期|資料日期)\s*[：:]?\s*((?:\d{4}[\/\.\-／．])?\d{1,2}[\/\.\-／．]\d{1,2})/);
  return match ? normalizePageDate(match[1], requestedDate) : null;
}

function parseRows(html: string) {
  const buys: RankedBrokerRow[] = [];
  const sells: RankedBrokerRow[] = [];
  const trMatches = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const tr of trMatches) {
    const cells = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => textOf(match[1]));
    if (cells.length < 10) continue;

    const buyIn = numberOf(cells[1]);
    const buyOut = numberOf(cells[2]);
    const buyNet = numberOf(cells[3]);
    const buyShare = numberOf(cells[4]);
    const sellIn = numberOf(cells[6]);
    const sellOut = numberOf(cells[7]);
    const sellNet = numberOf(cells[8]);
    const sellShare = numberOf(cells[9]);

    if (cells[0] && buyIn !== null && buyOut !== null && buyNet !== null) {
      buys.push({
        side: "BUY",
        rank: buys.length + 1,
        broker_branch: cells[0],
        buy_lots: buyIn,
        sell_lots: buyOut,
        net_lots: Math.abs(buyNet),
        turnover_share_pct: buyShare,
      });
    }
    if (cells[5] && sellIn !== null && sellOut !== null && sellNet !== null) {
      sells.push({
        side: "SELL",
        rank: sells.length + 1,
        broker_branch: cells[5],
        buy_lots: sellIn,
        sell_lots: sellOut,
        net_lots: -Math.abs(sellNet),
        turnover_share_pct: sellShare,
      });
    }
  }

  return { buys, sells };
}

function parseRankedOutputTotals(html: string) {
  const text = textOf(html);
  const match = text.match(/合計買超張數\s*([\d,]+).*?合計賣超張數\s*([\d,]+)/);
  if (!match) return null;
  const buy = numberOf(match[1]);
  const sell = numberOf(match[2]);
  if (buy === null || sell === null) return null;
  return {
    buy_net_lots: Math.abs(buy),
    sell_net_lots: -Math.abs(sell),
    scope: "DISPLAYED_RANKED_ROWS_ONLY" as const,
  };
}

function normalizeCharset(rawValue: string | null) {
  if (!rawValue) return null;
  const raw = rawValue.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "cp950" || raw === "950" || raw === "big-5") return "big5";
  if (raw === "utf8") return "utf-8";
  return raw;
}

function headerCharset(contentType: string | null) {
  const match = contentType?.match(/charset\s*=\s*["']?([^;\s"']+)/i);
  return normalizeCharset(match?.[1] ?? null);
}

function asciiPrefix(bytes: ArrayBuffer, maxBytes = 8192) {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, maxBytes));
  let out = "";
  for (const byte of view) out += String.fromCharCode(byte);
  return out;
}

function metaCharset(bytes: ArrayBuffer) {
  const ascii = asciiPrefix(bytes);
  const direct = ascii.match(/<meta\b[^>]*charset\s*=\s*["']?\s*([A-Za-z0-9._-]+)/i);
  if (direct) return normalizeCharset(direct[1]);
  const content = ascii.match(/<meta\b[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([A-Za-z0-9._-]+)/i);
  return normalizeCharset(content?.[1] ?? null);
}

function decodeBytes(bytes: ArrayBuffer, charset: string) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    throw new Error(`unsupported_charset:${charset}`);
  }
}

function brokerSemanticScore(text: string) {
  let score = 0;
  if (/(?:最後更新日(?:期)?|更新日期|資料日期)/.test(text)) score += 30;
  if (/券商分點|進出明細/.test(text)) score += 20;
  if (/買超券商|賣超券商/.test(text)) score += 20;
  if (/合計買超張數|合計賣超張數/.test(text)) score += 8;
  if (/<table\b/i.test(text)) score += 2;
  const replacements = text.match(/\uFFFD/g)?.length ?? 0;
  score -= Math.min(replacements, 100);
  return score;
}

async function decodeResponse(response: Response) {
  const bytes = await response.arrayBuffer();
  const declared = headerCharset(response.headers.get("content-type"));
  if (declared) {
    return {
      text: decodeBytes(bytes, declared),
      charset: declared,
      charset_resolution: "HTTP_HEADER" as const,
    };
  }

  const meta = metaCharset(bytes);
  if (meta) {
    return {
      text: decodeBytes(bytes, meta),
      charset: meta,
      charset_resolution: "HTML_META" as const,
    };
  }

  const candidates = ["utf-8", "big5"] as const;
  let best: { text: string; charset: string; score: number } | null = null;
  for (const charset of candidates) {
    try {
      const text = decodeBytes(bytes, charset);
      const score = brokerSemanticScore(text);
      if (!best || score > best.score) best = { text, charset, score };
    } catch {
      // Unsupported candidate is ignored; at least UTF-8 is expected to exist.
    }
  }
  if (!best) throw new Error("unable_to_decode_broker_page");
  return {
    text: best.text,
    charset: best.charset,
    charset_resolution: "AUTO_SEMANTIC" as const,
  };
}

async function fetchPageCached(url: string, fetcher: FetchLike) {
  const now = Date.now();
  const existing = cache.get(url);
  if (existing && existing.expires_at > now) return existing.promise;

  const promise = (async (): Promise<DecodedPage> => {
    let lastError = "transport_failed";
    for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
      const response = await fetcher(url, {
        cache: "no-store",
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*",
          "User-Agent": "Diamond-Broker-Ranked-ReadOnly/1.0",
        },
      });
      const decoded = await decodeResponse(response);
      if (response.ok) {
        return {
          text: decoded.text,
          charset: decoded.charset,
          charset_resolution: decoded.charset_resolution,
          attempts: attempt,
          http_status: response.status,
        };
      }

      lastError = `http_${response.status}:${textOf(decoded.text).slice(0, 120)}`;
      if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt >= MAX_TRANSPORT_ATTEMPTS) {
        throw new Error(lastError);
      }
    }
    throw new Error(lastError);
  })();

  cache.set(url, { expires_at: now + CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    cache.delete(url);
    throw error;
  }
}

function customRangeUrl(symbol: string, startDate: string, endDate: string) {
  return `https://www.moneydj.com/z/zc/zco/zco.djhtm?a=${encodeURIComponent(symbol)}&e=${encodeURIComponent(startDate)}&f=${encodeURIComponent(endDate)}`;
}

function baseResult(input: {
  symbol: string;
  as_of: string;
  url: string | null;
  window_days: TwBrokerWindowDays;
  retrieved_at: string;
  range_start: string | null;
  calendar_years?: number[];
  calendar_source_urls?: string[];
  page?: DecodedPage;
}) {
  const config = WINDOW_CONFIG[input.window_days];
  return {
    version: TW_BROKER_RANKED_ON_DEMAND_VERSION,
    symbol: input.symbol,
    requested_as_of: input.as_of,
    source: "MoneyDJ broker ranked public page",
    source_url: input.url,
    source_charset: input.page?.charset ?? null,
    source_charset_resolution: input.page?.charset_resolution ?? null,
    transport_attempts: input.page?.attempts ?? null,
    tier: "PUBLIC_SECONDARY" as const,
    completeness: "RANKED_ONLY" as const,
    persistence: "NONE" as const,
    window_days: input.window_days,
    source_window_selector: config.selector,
    source_window_label: config.label,
    source_query_mode: input.window_days === 1 ? "CUSTOM_EXACT_DATE" as const : "CUSTOM_TRADING_DAY_RANGE" as const,
    server_side_interval_aggregation: input.window_days > 1,
    requested_range_start: input.range_start,
    requested_range_end: input.as_of,
    range_basis: input.window_days === 1 ? "EXACT_DATE" as const : "TWSE_OFFICIAL_TRADING_CALENDAR" as const,
    trading_calendar_version: input.window_days === 1 ? null : TWSE_TRADING_CALENDAR_ON_DEMAND_VERSION,
    trading_calendar_years: input.calendar_years ?? [],
    trading_calendar_source_urls: input.calendar_source_urls ?? [],
    missing_branch_means_zero: false,
    retrieved_at: input.retrieved_at,
  };
}

/**
 * Read-only secondary evidence adapter for MoneyDJ's public stock -> broker
 * ranking page. It intentionally exposes only ranked output and never claims a
 * complete branch inventory. One-day reads use MoneyDJ's custom exact-date
 * range (start=end=as_of). Multi-day reads resolve the exact N trading sessions
 * from TWSE's official historical holiday schedule and then ask MoneyDJ to rank
 * that custom server-side interval. Daily ranked rows are never summed.
 * This adapter is fail-soft and must not block official TWSE/TPEx chip layers.
 */
export async function getTwBrokerRankedOnDemand(input: {
  symbol: string;
  as_of: string;
  window_days?: TwBrokerWindowDays;
  fetcher?: FetchLike;
  calendar_fetcher?: FetchLike;
}) {
  const symbol = String(input.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new Error("invalid_taiwan_symbol");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.as_of)) throw new Error("invalid_as_of_date");
  const windowDays = input.window_days ?? 1;
  if (!(windowDays in WINDOW_CONFIG)) throw new Error("unsupported_broker_window_days");
  const fetcher = input.fetcher ?? fetch;
  const retrievedAt = new Date().toISOString();
  let rangeStart: string | null = windowDays === 1 ? input.as_of : null;
  let calendarYears: number[] = [];
  let calendarSourceUrls: string[] = [];
  let url: string | null = null;

  try {
    if (windowDays > 1) {
      const tradingWindow = await resolveTwseTradingWindowStart({
        as_of: input.as_of,
        trading_days: windowDays,
        fetcher: input.calendar_fetcher,
      });
      rangeStart = tradingWindow.start_date;
      calendarYears = tradingWindow.calendar_years;
      calendarSourceUrls = tradingWindow.source_urls;
    }
    if (!rangeStart) throw new Error("broker_range_start_unresolved");
    url = customRangeUrl(symbol, rangeStart, input.as_of);

    const page = await fetchPageCached(url, fetcher);
    const common = baseResult({
      symbol,
      as_of: input.as_of,
      url,
      window_days: windowDays,
      retrieved_at: retrievedAt,
      range_start: rangeStart,
      calendar_years: calendarYears,
      calendar_source_urls: calendarSourceUrls,
      page,
    });

    const pageDate = parseUpdatedDate(page.text, input.as_of);
    if (!pageDate) {
      return {
        ...common,
        ok: false,
        status: "ERROR" as const,
        source_date: null,
        source_date_verified: false,
        source_window_verified: true,
        source_range_verified: false,
        error: "last_updated_date_not_found",
        buys: [],
        sells: [],
      };
    }
    if (pageDate !== input.as_of) {
      return {
        ...common,
        ok: false,
        status: "PENDING" as const,
        source_date: pageDate,
        source_date_verified: false,
        source_window_verified: true,
        source_range_verified: false,
        error: `source_date_mismatch:${pageDate}`,
        buys: [],
        sells: [],
      };
    }

    const { buys, sells } = parseRows(page.text);
    const rankedOutputTotals = parseRankedOutputTotals(page.text);
    if (!buys.length && !sells.length) {
      const noData = /查無[^<\n]*券商分點|查無.*進出明細/i.test(textOf(page.text));
      return {
        ...common,
        ok: noData,
        status: noData ? "READY_EMPTY" as const : "ERROR" as const,
        source_date: pageDate,
        source_date_verified: true,
        source_window_verified: true,
        source_range_verified: true,
        ranked_output_totals: rankedOutputTotals,
        error: noData ? null : "ranked_table_parse_empty",
        buys: [],
        sells: [],
      };
    }

    return {
      ...common,
      ok: true,
      status: "READY" as const,
      source_date: pageDate,
      source_date_verified: true,
      source_window_verified: true,
      source_range_verified: true,
      rank_count: { buy: buys.length, sell: sells.length },
      ranked_output_totals: rankedOutputTotals,
      buys,
      sells,
      interpretation_boundary: "Rows shown are MoneyDJ server-ranked public-page output for the requested range. Missing branches must NOT be interpreted as zero activity; missing branches/windows are UNKNOWN, never zero. Ranked-output totals cover displayed ranked rows only and are not a complete branch inventory.",
    };
  } catch (error) {
    return {
      ...baseResult({
        symbol,
        as_of: input.as_of,
        url,
        window_days: windowDays,
        retrieved_at: retrievedAt,
        range_start: rangeStart,
        calendar_years: calendarYears,
        calendar_source_urls: calendarSourceUrls,
      }),
      ok: false,
      status: "ERROR" as const,
      source_date: null,
      source_date_verified: false,
      source_window_verified: false,
      source_range_verified: false,
      error: error instanceof Error ? error.message : String(error),
      buys: [],
      sells: [],
    };
  }
}

type BrokerWindowResult = Awaited<ReturnType<typeof getTwBrokerRankedOnDemand>>;
type MatrixObservation = {
  side: "BUY" | "SELL";
  rank: number;
  net_lots: number;
  avg_net_lots_per_trading_day: number;
};

function windowKey(days: TwBrokerWindowDays) {
  return `${days}D` as `${TwBrokerWindowDays}D`;
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

function signOf(value: number | null | undefined) {
  if (value == null || value === 0) return 0;
  return value > 0 ? 1 : -1;
}

function branchPattern(windows: Record<string, MatrixObservation | null>) {
  const structural = ["5D", "10D", "20D", "60D"]
    .map((key) => windows[key]?.net_lots ?? null)
    .filter((value): value is number => value !== null && value !== 0);
  if (structural.length >= 3 && structural.every((value) => value > 0)) return "PERSISTENT_ACCUMULATION" as const;
  if (structural.length >= 3 && structural.every((value) => value < 0)) return "PERSISTENT_DISTRIBUTION" as const;

  const d5 = windows["5D"]?.net_lots ?? null;
  const d10 = windows["10D"]?.net_lots ?? null;
  const d20 = windows["20D"]?.net_lots ?? null;
  const d60 = windows["60D"]?.net_lots ?? null;
  const shortSigns = [d5, d10].map(signOf).filter((x) => x !== 0);
  const longSigns = [d20, d60].map(signOf).filter((x) => x !== 0);
  const shortSign = shortSigns.length && shortSigns.every((x) => x === shortSigns[0]) ? shortSigns[0] : 0;
  const longSign = longSigns.length && longSigns.every((x) => x === longSigns[0]) ? longSigns[0] : 0;

  if (shortSign < 0 && (longSign > 0 || (d60 != null && d60 > 0))) {
    return "SHORT_TERM_DISTRIBUTION_AGAINST_LONGER_ACCUMULATION" as const;
  }
  if (shortSign > 0 && (longSign < 0 || (d60 != null && d60 < 0))) {
    return "SHORT_TERM_ACCUMULATION_AGAINST_LONGER_DISTRIBUTION" as const;
  }
  if (structural.length < 2) return "INSUFFICIENT_RANKED_COVERAGE" as const;
  return "MIXED" as const;
}

function buildBranchMatrix(results: BrokerWindowResult[], requestedWindows: TwBrokerWindowDays[]) {
  const matrix = new Map<string, {
    broker_branch: string;
    windows: Record<string, MatrixObservation | null>;
    observed_windows: string[];
    appearances: number;
    pattern: ReturnType<typeof branchPattern>;
    max_abs_avg_net_lots_per_day: number;
  }>();
  const keys = requestedWindows.map(windowKey);

  function ensure(branch: string) {
    const existing = matrix.get(branch);
    if (existing) return existing;
    const windows = Object.fromEntries(keys.map((key) => [key, null])) as Record<string, MatrixObservation | null>;
    const row = {
      broker_branch: branch,
      windows,
      observed_windows: [] as string[],
      appearances: 0,
      pattern: "INSUFFICIENT_RANKED_COVERAGE" as ReturnType<typeof branchPattern>,
      max_abs_avg_net_lots_per_day: 0,
    };
    matrix.set(branch, row);
    return row;
  }

  results.forEach((result, index) => {
    const days = requestedWindows[index];
    const key = windowKey(days);
    if (result.status !== "READY") return;
    for (const sourceRow of [...result.buys, ...result.sells]) {
      const row = ensure(sourceRow.broker_branch);
      const avg = Number((sourceRow.net_lots / days).toFixed(3));
      row.windows[key] = {
        side: sourceRow.side,
        rank: sourceRow.rank,
        net_lots: sourceRow.net_lots,
        avg_net_lots_per_trading_day: avg,
      };
      row.observed_windows.push(key);
      row.appearances += 1;
      row.max_abs_avg_net_lots_per_day = Math.max(row.max_abs_avg_net_lots_per_day, Math.abs(avg));
    }
  });

  for (const row of matrix.values()) row.pattern = branchPattern(row.windows);
  return [...matrix.values()].sort((a, b) =>
    b.appearances - a.appearances
    || b.max_abs_avg_net_lots_per_day - a.max_abs_avg_net_lots_per_day
    || a.broker_branch.localeCompare(b.broker_branch, "zh-Hant"));
}

/**
 * Bounded multi-horizon broker evidence for explicit/deep stock analysis only.
 * Each N-day interval is resolved from the official TWSE trading calendar and
 * ranked by MoneyDJ server-side through its custom range. Daily Top-N rows are
 * never summed. Origin concurrency remains capped to avoid bursty fan-out.
 */
export async function getTwBrokerRankedWindowBundleOnDemand(input: {
  symbol: string;
  as_of: string;
  windows?: readonly TwBrokerWindowDays[];
  fetcher?: FetchLike;
  calendar_fetcher?: FetchLike;
}) {
  const requestedWindows = [...(input.windows ?? DEFAULT_MULTI_WINDOWS)];
  if (!requestedWindows.length) throw new Error("broker_windows_required");
  if (new Set(requestedWindows).size !== requestedWindows.length) throw new Error("duplicate_broker_windows");
  for (const days of requestedWindows) {
    if (!(days in WINDOW_CONFIG)) throw new Error(`unsupported_broker_window_days:${days}`);
  }

  const results = await mapWithConcurrency(requestedWindows, 3, (days) => getTwBrokerRankedOnDemand({
    symbol: input.symbol,
    as_of: input.as_of,
    window_days: days,
    fetcher: input.fetcher,
    calendar_fetcher: input.calendar_fetcher,
  }));
  const windows = Object.fromEntries(results.map((result, index) => [windowKey(requestedWindows[index]), result])) as Record<string, BrokerWindowResult>;
  const usable = results.filter((result) => result.status === "READY" || result.status === "READY_EMPTY").length;
  const pending = results.filter((result) => result.status === "PENDING").length;
  const status = usable === results.length
    ? "READY"
    : usable > 0
      ? "DEGRADED"
      : pending > 0
        ? "PENDING"
        : "ERROR";

  return {
    version: "tw-broker-ranked-window-bundle/v1.1.0",
    status,
    symbol: String(input.symbol),
    requested_as_of: input.as_of,
    requested_windows: requestedWindows,
    windows,
    ready_window_count: usable,
    branch_matrix: buildBranchMatrix(results, requestedWindows),
    server_side_interval_aggregation: true,
    range_basis: "TWSE_OFFICIAL_TRADING_CALENDAR+MONEYDJ_CUSTOM_SERVER_RANGE" as const,
    daily_rank_summing: false,
    missing_branch_means_zero: false,
    missing_window_observation: "UNKNOWN" as const,
    tier: "PUBLIC_SECONDARY" as const,
    completeness: "RANKED_ONLY" as const,
    persistence: "NONE" as const,
    previous_day_substitution: false,
    origin_concurrency_limit: 3,
    interpretation_boundary: "Each MoneyDJ interval is independently server-ranked for an exact TWSE trading-day range ending at requested_as_of. A branch absent from a window is UNKNOWN, not zero. Broker names are execution channels and must not be treated as investor identity.",
  };
}

export function resetTwBrokerRankedCacheForTests() {
  cache.clear();
}
