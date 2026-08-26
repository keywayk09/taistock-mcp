import { readGitHubText } from "./github-data-store.ts";

/**
 * Cross-account-safe read adapter.
 *
 * Cloudflare Service Bindings can only target Workers in the same Cloudflare
 * account. taistock-mcp and tv-fugle-1d are intentionally kept in separate
 * accounts, so this adapter reads the same sources without adding a public
 * mutation route or moving either Worker:
 *
 * - formal stock OHLC: existing GitHub canonical CSV written by tv-fugle-1d
 * - stock realtime: Fugle REST quote + trades using taistock-mcp's existing key
 *
 * This module is read-only. It never writes GitHub/KV/R2/D1/OHLC and never
 * places or cancels orders.
 */
export const CROSS_ACCOUNT_READ_SERVICE_VERSION = "cross-account-read-service/v1.0.0";

const FUGLE_STOCK = "https://api.fugle.tw/marketdata/v1.0/stock";
const TRADE_TAPE_WINDOW_MS = 180_000;
const TRADE_TAPE_LIMIT = 300;

type AnyRecord = Record<string, any>;

type ReadOhlcArgs = {
  symbol?: string;
  timeframe?: string;
  from?: string;
  to?: string;
  limit?: number;
};

function rec(value: unknown): AnyRecord {
  return value !== null && typeof value === "object" ? value as AnyRecord : {};
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string, maxDays = 14) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const out: string[] = [];
  for (let cursor = start; cursor <= end && out.length < maxDays; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
  }
  return out;
}

function yearsBetween(from: string, to: string) {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  const out: number[] = [];
  if (!Number.isInteger(first) || !Number.isInteger(last)) return out;
  for (let year = first; year <= last; year += 1) out.push(year);
  return out;
}

function csvLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function scalar(value: string) {
  const text = value.trim();
  if (text === "") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return n;
  }
  return text;
}

function parseCanonicalCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [] as AnyRecord[];
  const headers = csvLine(lines[0]).map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = csvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, scalar(values[index] ?? "")])) as AnyRecord;
  });
}

function rowDate(row: AnyRecord) {
  return String(row.date ?? row.trade_date ?? row.datetime ?? row.time ?? row.bar_time_tw ?? "").slice(0, 10);
}

async function readCanonicalPaths(env: Env, paths: string[]) {
  const reads = await Promise.all(paths.map(async (path) => {
    try {
      const value = await readGitHubText(env, path);
      return { path, ...value, error: null as string | null };
    } catch (error) {
      return {
        path,
        exists: false,
        sha: null,
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  return reads;
}

async function readStockCanonicalOhlc(env: Env, args: ReadOhlcArgs) {
  const symbol = String(args.symbol ?? "").trim();
  const timeframe = String(args.timeframe ?? "").toLowerCase();
  const to = String(args.to ?? new Date().toISOString().slice(0, 10));
  const from = String(args.from ?? subtractDays(to, timeframe === "1d" ? 280 : 10));
  const limit = Math.max(1, Math.min(2_000, Math.trunc(Number(args.limit ?? 420) || 420)));
  if (!/^\d{4,6}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ok: false, blocked: true, status: "UNAVAILABLE", data_status: "UNAVAILABLE", error: "INVALID_OHLC_REQUEST" };
  }

  let paths: string[] = [];
  if (timeframe === "1d") {
    paths = yearsBetween(from, to).map((year) => `data/OHLC/tw/1d/${year}/${symbol}.csv`);
  } else if (timeframe === "5m") {
    paths = datesBetween(from, to, 14).map((date) => {
      const [year, month, day] = date.split("-");
      return `data/OHLC/tw/5m/${year}/${month}/${day}/${symbol}.csv`;
    });
  } else {
    return { ok: false, blocked: true, status: "UNAVAILABLE", data_status: "UNAVAILABLE", error: "UNSUPPORTED_TIMEFRAME" };
  }

  const reads = await readCanonicalPaths(env, paths);
  const good = reads.filter((item) => item.exists && typeof item.value === "string" && item.sha);
  const rows = good
    .flatMap((item) => parseCanonicalCsv(String(item.value)))
    .filter((row) => {
      const date = rowDate(row);
      return date && date >= from && date <= to && String(row.symbol ?? symbol) === symbol;
    })
    .sort((a, b) => String(a.bar_time_tw ?? a.datetime ?? a.time ?? a.date ?? "").localeCompare(String(b.bar_time_tw ?? b.datetime ?? b.time ?? b.date ?? "")))
    .slice(-limit);

  if (!rows.length) {
    return {
      ok: false,
      blocked: true,
      status: "UNAVAILABLE",
      data_status: "UNAVAILABLE",
      market: "stock",
      symbol,
      timeframe,
      error: reads.some((item) => item.error) ? "GITHUB_CANONICAL_READ_FAILED" : "DATA_NOT_FOUND",
      provenance: {
        source: "OHLC_MCP_GITHUB_CANONICAL_READ",
        attempted_paths: paths,
        errors: reads.filter((item) => item.error).map((item) => ({ path: item.path, error: item.error })),
      },
    };
  }

  const shas = good.map((item) => String(item.sha));
  const resolvedDate = rowDate(rows.at(-1) ?? {});
  return {
    ok: true,
    blocked: false,
    status: "READY",
    data_status: "OK",
    market: "stock",
    symbol,
    timeframe,
    mode: "research",
    source: "OHLC_MCP_GITHUB_CANONICAL_READ",
    resolved_date: resolvedDate || to,
    dataset_id: `OHLC_MCP_GITHUB_CANONICAL:${symbol}:${timeframe}`,
    dataset_version: `github-canonical:${shas.join(":")}`,
    dataset_hash: shas.join(":"),
    dataset_complete_view: true,
    formal_research_eligible: true,
    verification_level: "GITHUB_CANONICAL_PATH_SHA_BOUND",
    quality: {
      gate: "PASS",
      identity: "EXISTING_TV_FUGLE_1D_CANONICAL_ONLY",
      read_only: true,
    },
    provenance: {
      source: "OHLC_MCP_GITHUB_CANONICAL_READ",
      repository: String((env as any)?.GITHUB_DATA_REPO ?? "keywayk09/tv-papertrader"),
      branch: String((env as any)?.GITHUB_DATA_BRANCH ?? "main"),
      files: good.map((item) => ({ path: item.path, sha: item.sha })),
      transport: "GITHUB_CONTENTS_READ_ONLY",
    },
    row_count: rows.length,
    returned: rows.length,
    rows,
  };
}

function microToMs(value: unknown) {
  const n = finite(value);
  if (n === null) return null;
  if (n > 100_000_000_000_000) return Math.trunc(n / 1_000);
  if (n > 100_000_000_000) return Math.trunc(n);
  return Math.trunc(n * 1_000);
}

async function fugleJson(env: Env, path: string) {
  const apiKey = String((env as any)?.FUGLE_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("FUGLE_API_KEY_NOT_CONFIGURED");
  const response = await fetch(`${FUGLE_STOCK}${path}`, {
    headers: { Accept: "application/json", "X-API-KEY": apiKey },
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`FUGLE_HTTP_${response.status}`);
  if (!body || typeof body !== "object") throw new Error("FUGLE_INVALID_JSON");
  return body;
}

function normalizeBook(rows: unknown) {
  return Array.isArray(rows)
    ? rows.slice(0, 5).map((row) => ({ price: finite(rec(row).price), size: finite(rec(row).size) }))
      .filter((row) => row.price !== null && row.size !== null)
    : [];
}

function percentile90(values: number[]) {
  if (values.length < 20) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
}

function normalizedTrades(raw: unknown) {
  const source = Array.isArray(raw) ? raw : [];
  const ascending = source.map((item) => {
    const row = rec(item);
    return {
      time: microToMs(row.time),
      serial: finite(row.serial),
      price: finite(row.price),
      size: finite(row.size),
      bid: finite(row.bid),
      ask: finite(row.ask),
      cumulative_volume: finite(row.volume),
    };
  }).filter((row) => row.time !== null && row.price !== null && row.size !== null)
    .sort((a, b) => Number(a.time) - Number(b.time));

  let previousPrice: number | null = null;
  let previousAggressor = "UNKNOWN";
  const classified = ascending.map((row) => {
    let aggressor = "UNKNOWN";
    let method = "unknown";
    if (row.ask !== null && Number(row.price) >= row.ask) {
      aggressor = "BUY";
      method = "quote";
    } else if (row.bid !== null && Number(row.price) <= row.bid) {
      aggressor = "SELL";
      method = "quote";
    } else if (previousPrice !== null && Number(row.price) > previousPrice) {
      aggressor = "BUY";
      method = "tick";
    } else if (previousPrice !== null && Number(row.price) < previousPrice) {
      aggressor = "SELL";
      method = "tick";
    } else if (previousAggressor !== "UNKNOWN") {
      aggressor = previousAggressor;
      method = "continuity";
    }
    previousPrice = Number(row.price);
    if (aggressor !== "UNKNOWN") previousAggressor = aggressor;
    return {
      ...row,
      side: aggressor === "BUY" ? "buy" : aggressor === "SELL" ? "sell" : "unknown",
      aggressor,
      taiwan_side: aggressor === "BUY" ? "OUTSIDE" : aggressor === "SELL" ? "INSIDE" : "UNKNOWN",
      classification_method: method,
    };
  });

  const latestTime = classified.length ? Number(classified.at(-1)?.time ?? 0) : 0;
  const withinWindow = classified.filter((row) => Number(row.time) >= latestTime - TRADE_TAPE_WINDOW_MS);
  const largeThreshold = percentile90(withinWindow.map((row) => Number(row.size)));
  const recent = withinWindow.slice(-TRADE_TAPE_LIMIT).map((row) => ({
    ...row,
    is_large: largeThreshold !== null && Number(row.size) >= largeThreshold,
  })).reverse();

  return {
    rows: recent,
    latest_time: latestTime || null,
    available_in_window: withinWindow.length,
    large_trade_threshold: largeThreshold,
    truncated: withinWindow.length > TRADE_TAPE_LIMIT,
  };
}

function flowWindow(rows: AnyRecord[], latestTime: number | null, windowMs: number) {
  if (!latestTime) return { buy: 0, sell: 0, unknown: 0, delta: 0, buy_ratio: null };
  const selected = rows.filter((row) => Number(row.time) >= latestTime - windowMs);
  let buy = 0;
  let sell = 0;
  let unknown = 0;
  for (const row of selected) {
    const size = Number(row.size ?? 0);
    if (row.aggressor === "BUY") buy += size;
    else if (row.aggressor === "SELL") sell += size;
    else unknown += size;
  }
  const known = buy + sell;
  return {
    buy,
    sell,
    unknown,
    delta: buy - sell,
    buy_ratio: known > 0 ? buy / known : null,
  };
}

async function readStockMarketContextDirect(env: Env, args: AnyRecord) {
  const symbol = String(args.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new Error("INVALID_STOCK_SYMBOL");
  const [quote, trades] = await Promise.all([
    fugleJson(env, `/intraday/quote/${encodeURIComponent(symbol)}`),
    fugleJson(env, `/intraday/trades/${encodeURIComponent(symbol)}?limit=${TRADE_TAPE_LIMIT}&sort=desc&isTrial=false`),
  ]);

  const bids = normalizeBook(quote.bids);
  const asks = normalizeBook(quote.asks);
  const lastPrice = finite(quote.lastPrice ?? quote.closePrice ?? rec(quote.lastTrade).price);
  const bestBid = finite(rec(bids[0]).price);
  const bestAsk = finite(rec(asks[0]).price);
  const bidDepth = bids.reduce((sum, row) => sum + Number(row.size ?? 0), 0);
  const askDepth = asks.reduce((sum, row) => sum + Number(row.size ?? 0), 0);
  const imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;
  const tape = normalizedTrades(trades.data);
  const window30 = flowWindow(tape.rows, tape.latest_time, 30_000);
  const window60 = flowWindow(tape.rows, tape.latest_time, 60_000);
  const window180 = flowWindow(tape.rows, tape.latest_time, TRADE_TAPE_WINDOW_MS);
  const buyRatio = window60.buy_ratio;
  const state = buyRatio !== null && buyRatio >= 0.58
    ? "BUY_CONTROL"
    : buyRatio !== null && buyRatio <= 0.42
      ? "SELL_CONTROL"
      : "MIXED";
  const displayReady = lastPrice !== null && bids.length > 0 && asks.length > 0;
  const liveStatus = displayReady && tape.rows.length > 0 ? "READY" : displayReady ? "DEGRADED" : "LIVE_UNAVAILABLE";
  const quoteTime = microToMs(quote.lastUpdated ?? quote.closeTime ?? rec(quote.total).time);
  const tradeTime = tape.latest_time;

  return {
    ok: displayReady,
    market: "stock",
    symbol,
    historical: {},
    live: {
      ok: displayReady,
      symbol,
      live_status: liveStatus,
      decision_eligible: displayReady && tape.rows.length > 0,
      rpc_display_ready: displayReady,
      rpc_wait_ms: 0,
      connection: {
        alive: true,
        authenticated: true,
        transport: "FUGLE_REST_READ_ONLY",
        last_error: "",
      },
      stream: {
        trade_fresh: tape.rows.length > 0,
        book_fresh: bids.length > 0 && asks.length > 0,
        market_quiet: tape.rows.length === 0,
        profile: "REST_QUOTE_PLUS_TRADES",
      },
      snapshot: {
        symbol,
        last_price: lastPrice,
        best_bid: bestBid,
        best_ask: bestAsk,
        state,
        feed: {
          quality: tape.rows.length > 0 ? "FULL_REST" : "QUOTE_ONLY",
          transport: "FUGLE_REST_READ_ONLY",
          quote_time_ms: quoteTime,
          trade_time_ms: tradeTime,
        },
        book: { bids, asks, bid_depth: bidDepth, ask_depth: askDepth, imbalance },
        recent_trades: tape.rows,
        trade_tape: {
          window_ms: TRADE_TAPE_WINDOW_MS,
          returned: tape.rows.length,
          available_in_window: tape.available_in_window,
          limit: TRADE_TAPE_LIMIT,
          truncated: tape.truncated,
          large_trade_threshold: tape.large_trade_threshold,
          classification: "quote_then_tick_rule",
          persisted: false,
        },
        windows: { "30s": window30, "60s": window60, "180s": window180 },
        context_30m: null,
        cumulative: {
          trade_volume: finite(rec(quote.total).tradeVolume),
          trade_volume_at_bid: finite(rec(quote.total).tradeVolumeAtBid),
          trade_volume_at_ask: finite(rec(quote.total).tradeVolumeAtAsk),
          transaction: finite(rec(quote.total).transaction),
        },
      },
      persistence: "none",
    },
    contract: {
      source: "FUGLE_REST_READ_ONLY",
      persistence: "none",
      writes: { github: false, ohlc: false, kv: false, r2: false, d1: false, orders: false },
    },
  };
}

function unavailable(kind: string) {
  return Promise.resolve({ ok: false, blocked: true, status: "UNAVAILABLE", data_status: "UNAVAILABLE", error: `${kind}_CROSS_ACCOUNT_DIRECT_ADAPTER_NOT_IMPLEMENTED` });
}

export function createCrossAccountReadService(env: Env) {
  return {
    readOhlc: (args?: AnyRecord) => readStockCanonicalOhlc(env, args ?? {}),
    readStockMarketContext: (args?: AnyRecord) => readStockMarketContextDirect(env, args ?? {}),
    readStockLive: (args?: AnyRecord) => readStockMarketContextDirect(env, args ?? {}),
    readTxfOhlc: () => unavailable("TXF_OHLC"),
    getTxfOhlcStatus: () => unavailable("TXF_STATUS"),
    readGlobalOhlc: () => unavailable("GLOBAL_OHLC"),
    readGlobalFuturesOhlc: () => unavailable("GLOBAL_FUTURES_OHLC"),
    getGlobalFuturesStatus: () => unavailable("GLOBAL_FUTURES_STATUS"),
    readTxfLive: () => unavailable("TXF_LIVE"),
    readTxfMarketContext: () => unavailable("TXF_CONTEXT"),
  };
}
