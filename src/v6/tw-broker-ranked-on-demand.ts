export const TW_BROKER_RANKED_ON_DEMAND_VERSION = "tw-broker-ranked-on-demand/v1.1.0";

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
  attempts: number;
  http_status: number;
};

type CacheEntry = { expires_at: number; promise: Promise<DecodedPage> };
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_TRANSPORT_ATTEMPTS = 2;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504, 520]);
const cache = new Map<string, CacheEntry>();

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
  const text = raw.trim();
  const full = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (full) return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  const short = text.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (short) return `${requestedDate.slice(0, 4)}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  return null;
}

function parseUpdatedDate(html: string, requestedDate: string) {
  const text = textOf(html);
  const match = text.match(/最後更新日\s*[：:]?\s*((?:\d{4}[\/-])?\d{1,2}[\/-]\d{1,2})/);
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

function normalizeCharset(contentType: string | null) {
  const match = contentType?.match(/charset\s*=\s*["']?([^;\s"']+)/i);
  const raw = match?.[1]?.trim().toLowerCase() ?? "utf-8";
  if (raw === "cp950" || raw === "950" || raw === "big-5") return "big5";
  if (raw === "utf8") return "utf-8";
  return raw;
}

async function decodeResponse(response: Response) {
  const charset = normalizeCharset(response.headers.get("content-type"));
  const bytes = await response.arrayBuffer();
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    throw new Error(`unsupported_charset:${charset}`);
  }
  return { text: decoder.decode(bytes), charset };
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

/**
 * Read-only secondary evidence adapter for MoneyDJ's public stock -> broker
 * ranking page. It intentionally exposes only ranked output and never claims a
 * complete branch inventory. This adapter is fail-soft and must not block the
 * official TWSE/TPEx chip layers.
 */
export async function getTwBrokerRankedOnDemand(input: {
  symbol: string;
  as_of: string;
  fetcher?: FetchLike;
}) {
  const symbol = String(input.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new Error("invalid_taiwan_symbol");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.as_of)) throw new Error("invalid_as_of_date");
  const fetcher = input.fetcher ?? fetch;
  const url = `https://www.moneydj.com/Z/ZC/ZCO/ZCO.djhtm?a=${encodeURIComponent(symbol)}&e=`;
  const retrievedAt = new Date().toISOString();

  try {
    const page = await fetchPageCached(url, fetcher);
    const pageDate = parseUpdatedDate(page.text, input.as_of);
    if (!pageDate) {
      return {
        ok: false,
        version: TW_BROKER_RANKED_ON_DEMAND_VERSION,
        status: "ERROR" as const,
        symbol,
        requested_as_of: input.as_of,
        source_date: null,
        source_date_verified: false,
        source: "MoneyDJ broker ranked public page",
        source_url: url,
        source_charset: page.charset,
        transport_attempts: page.attempts,
        tier: "PUBLIC_SECONDARY" as const,
        completeness: "RANKED_ONLY" as const,
        persistence: "NONE" as const,
        error: "last_updated_date_not_found",
        retrieved_at: retrievedAt,
        buys: [],
        sells: [],
      };
    }
    if (pageDate !== input.as_of) {
      return {
        ok: false,
        version: TW_BROKER_RANKED_ON_DEMAND_VERSION,
        status: "PENDING" as const,
        symbol,
        requested_as_of: input.as_of,
        source_date: pageDate,
        source_date_verified: false,
        source: "MoneyDJ broker ranked public page",
        source_url: url,
        source_charset: page.charset,
        transport_attempts: page.attempts,
        tier: "PUBLIC_SECONDARY" as const,
        completeness: "RANKED_ONLY" as const,
        persistence: "NONE" as const,
        error: `source_date_mismatch:${pageDate}`,
        retrieved_at: retrievedAt,
        buys: [],
        sells: [],
      };
    }

    const { buys, sells } = parseRows(page.text);
    if (!buys.length && !sells.length) {
      const noData = /查無[^<\n]*券商分點|查無.*進出明細/i.test(textOf(page.text));
      return {
        ok: noData,
        version: TW_BROKER_RANKED_ON_DEMAND_VERSION,
        status: noData ? "READY_EMPTY" as const : "ERROR" as const,
        symbol,
        requested_as_of: input.as_of,
        source_date: pageDate,
        source_date_verified: true,
        source: "MoneyDJ broker ranked public page",
        source_url: url,
        source_charset: page.charset,
        transport_attempts: page.attempts,
        tier: "PUBLIC_SECONDARY" as const,
        completeness: "RANKED_ONLY" as const,
        persistence: "NONE" as const,
        error: noData ? null : "ranked_table_parse_empty",
        retrieved_at: retrievedAt,
        buys: [],
        sells: [],
      };
    }

    return {
      ok: true,
      version: TW_BROKER_RANKED_ON_DEMAND_VERSION,
      status: "READY" as const,
      symbol,
      requested_as_of: input.as_of,
      source_date: pageDate,
      source_date_verified: true,
      source: "MoneyDJ broker ranked public page",
      source_url: url,
      source_charset: page.charset,
      transport_attempts: page.attempts,
      tier: "PUBLIC_SECONDARY" as const,
      completeness: "RANKED_ONLY" as const,
      persistence: "NONE" as const,
      rank_count: { buy: buys.length, sell: sells.length },
      buys,
      sells,
      interpretation_boundary: "Rows shown are ranked public-page output. Missing branches must NOT be interpreted as zero activity or no trading.",
      retrieved_at: retrievedAt,
    };
  } catch (error) {
    return {
      ok: false,
      version: TW_BROKER_RANKED_ON_DEMAND_VERSION,
      status: "ERROR" as const,
      symbol,
      requested_as_of: input.as_of,
      source_date: null,
      source_date_verified: false,
      source: "MoneyDJ broker ranked public page",
      source_url: url,
      tier: "PUBLIC_SECONDARY" as const,
      completeness: "RANKED_ONLY" as const,
      persistence: "NONE" as const,
      error: error instanceof Error ? error.message : String(error),
      retrieved_at: retrievedAt,
      buys: [],
      sells: [],
    };
  }
}

export function resetTwBrokerRankedCacheForTests() {
  cache.clear();
}
