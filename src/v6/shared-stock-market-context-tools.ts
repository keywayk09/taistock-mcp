import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readFamilyCanonicalOhlc,
  readFamilyStockMarketContext,
} from "./family-ohlc-read-bridge";

export const SHARED_STOCK_MARKET_CONTEXT_TOOLS_VERSION = "shared-stock-market-context-tools/v1.3.0";

const symbolSchema = z.string().trim().regex(/^\d{4,6}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function unavailableLive(symbol: string, reason: string) {
  return {
    status: "UNAVAILABLE",
    source: "FUGLE_REST_READ_ONLY",
    symbol,
    live_status: "LIVE_UNAVAILABLE",
    display_ready: false,
    decision_eligible: false,
    formal_research_eligible: false,
    book: { bids: [], asks: [] },
    recent_trades: [],
    trade_tape: null,
    error: reason,
    persistence: "none",
  };
}

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

function normalizeTapeRow(row: unknown) {
  const value = rec(row);
  return {
    time: Number.isFinite(Number(value.time)) ? Number(value.time) : null,
    serial: Number.isFinite(Number(value.serial)) ? Number(value.serial) : null,
    price: Number.isFinite(Number(value.price)) ? Number(value.price) : null,
    size: Number.isFinite(Number(value.size)) ? Number(value.size) : null,
    bid: Number.isFinite(Number(value.bid)) ? Number(value.bid) : null,
    ask: Number.isFinite(Number(value.ask)) ? Number(value.ask) : null,
    side: String(value.side ?? "unknown"),
    aggressor: String(value.aggressor ?? "UNKNOWN"),
    taiwan_side: String(value.taiwan_side ?? "UNKNOWN"),
    classification_method: String(value.classification_method ?? "unknown"),
    cumulative_volume: Number.isFinite(Number(value.cumulative_volume)) ? Number(value.cumulative_volume) : null,
    is_large: value.is_large === true,
  };
}

type TapeRow = ReturnType<typeof normalizeTapeRow>;

function projectTradeTape(live: any, symbol: string) {
  const rawRows: unknown[] = Array.isArray(live?.recent_trades) ? live.recent_trades.slice(0, 300) : [];
  const rows: TapeRow[] = rawRows
    .map(normalizeTapeRow)
    .filter((row: TapeRow) => row.time !== null && row.price !== null && row.size !== null);
  const metadata = rec(live?.trade_tape);
  const status = rows.length > 0 ? "READY" : live?.status === "DEGRADED" ? "DEGRADED" : "UNAVAILABLE";
  return {
    status,
    source: String(live?.source ?? "FUGLE_REST_READ_ONLY"),
    symbol,
    live_status: String(live?.live_status ?? "LIVE_UNAVAILABLE"),
    recent_trades: rows,
    trade_tape: {
      window_ms: Number(metadata.window_ms ?? 0),
      returned: rows.length,
      available_in_window: Number(metadata.available_in_window ?? rows.length),
      limit: Number(metadata.limit ?? 300),
      truncated: metadata.truncated === true,
      large_trade_threshold: metadata.large_trade_threshold == null ? null : Number(metadata.large_trade_threshold),
      classification: String(metadata.classification ?? "quote_then_tick_rule"),
      persisted: false,
    },
    semantics: {
      BUY: "主動買；成交在Ask/外盤，沒有可靠quote時才用tick rule",
      SELL: "主動賣；成交在Bid/內盤，沒有可靠quote時才用tick rule",
      OUTSIDE: "外盤",
      INSIDE: "內盤",
      classification_method: "quote優先；沒有可靠quote時才用tick/continuity",
    },
    persistence: "none",
    error: status === "UNAVAILABLE" ? String(live?.error ?? "trade_tape_unavailable") : null,
  };
}

async function readOwnerStockTradeTape(env: Env, symbol: string) {
  const live = await readFamilyStockMarketContext(env, { symbol, books: true, wait_ms: 0 });
  return projectTradeTape(live, symbol);
}

async function fugleRestQuoteFallback(env: Env, symbol: string, type: "normal" | "oddlot") {
  const key = String((env as any)?.FUGLE_API_KEY ?? "").trim();
  if (!key) return { status: "UNAVAILABLE", source: "FUGLE_REST_DISPLAY_FALLBACK", data: null, error: "FUGLE_API_KEY_NOT_CONFIGURED" };
  const url = new URL(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(symbol)}`);
  if (type === "oddlot") url.searchParams.set("type", "oddlot");
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "X-API-KEY": key } });
    const text = await response.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) return { status: "UNAVAILABLE", source: "FUGLE_REST_DISPLAY_FALLBACK", data: null, error: `FUGLE_REST_HTTP_${response.status}` };
    return { status: "READY", source: "FUGLE_REST_DISPLAY_FALLBACK", formal_research_eligible: false, data: body, error: null };
  } catch (error) {
    return { status: "UNAVAILABLE", source: "FUGLE_REST_DISPLAY_FALLBACK", data: null, error: `FUGLE_REST:${error instanceof Error ? error.message : String(error)}` };
  }
}

async function sharedStockContext(env: Env, symbol: string) {
  const asOf = taipeiDate();
  const [live, canonical] = await Promise.all([
    readFamilyStockMarketContext(env, { symbol, books: true, wait_ms: 0 }),
    readFamilyCanonicalOhlc(env, {
      symbol,
      as_of_date: asOf,
      question: "盤中 現在 五檔 技術 量價",
      intent: "QUICK_STOCK_QUESTION",
    }),
  ]);
  const tape = projectTradeTape(live, symbol);

  return {
    ok: live.status !== "UNAVAILABLE" || canonical.status === "READY" || tape.status !== "UNAVAILABLE",
    version: SHARED_STOCK_MARKET_CONTEXT_TOOLS_VERSION,
    symbol,
    as_of_date: asOf,
    source_priority: [
      "FUGLE_REST_READ_ONLY_QUOTE_TRADES",
      "OHLC_MCP_GITHUB_CANONICAL_READ",
      "FUGLE_REST_DISPLAY_FALLBACK",
    ],
    live_context: {
      ...live,
      recent_trades: tape.recent_trades,
      trade_tape: tape.trade_tape,
      trade_tape_semantics: tape.semantics,
    },
    trade_tape: tape,
    canonical_ohlc: canonical,
    identity: {
      live: "EPHEMERAL_READ_ONLY_CONTEXT_NOT_FORMAL_OHLC",
      trade_tape: "EPHEMERAL_NORMALIZED_FUGLE_REST_TRADES_NOT_PERSISTED",
      canonical_ohlc: "FORMAL_EXISTING_GITHUB_CANONICAL_READ_ONLY",
      writes: false,
      orders: false,
    },
  };
}

export function registerSharedStockMarketContextTools(server: McpServer, env: Env) {
  server.registerTool("get_stock_market_context", {
    description: "單股盤中首選入口：同一個taistock-mcp唯讀取得Fugle最新成交、最近逐筆、買一到買五、賣一到賣五與短窗主動買賣，同時讀取tv-fugle-1d既有GitHub canonical正式1D/5m。無跨Cloudflare帳號Service Binding，無Live持久化。",
    inputSchema: { symbol: symbolSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol }) => out(await sharedStockContext(env, symbol)));

  server.registerTool("get_stock_trade_tape", {
    description: "股票逐筆成交明細。回傳Fugle REST最近約3分鐘、最多300筆成交，包含時間、價格、張數、Bid/Ask、主動買賣、外盤/內盤、分類方法、累積量與自適應大單標記。只讀、不持久化。",
    inputSchema: { symbol: symbolSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol }) => out(await readOwnerStockTradeTape(env, symbol)));

  // Compatibility name for GPT/tool clients that describe Fugle's
  // /intraday/trades/{symbol} endpoint literally. Keep one implementation so
  // trade classification, limits and read-only semantics cannot drift.
  server.registerTool("get_intraday_trades", {
    description: "台股逐筆即時成交相容入口。唯讀取得Fugle /intraday/trades/{symbol} 正規化結果，包含成交時間、價格、張數、Bid/Ask、serial、累積量、主動買賣與內外盤；不開放原始WebSocket、不持久化。",
    inputSchema: { symbol: symbolSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol }) => out(await readOwnerStockTradeTape(env, symbol)));

  server.registerTool("get_quote", {
    description: "台股即時報價。normal模式直接用Fugle REST回傳最新成交、逐筆成交、五檔與短窗主動買賣，並附GitHub canonical正式1D/5m；oddlot維持Fugle REST顯示資料。",
    inputSchema: {
      symbol: symbolSchema,
      type: z.enum(["normal", "oddlot"]).optional().default("normal"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol, type }) => {
    if (type === "oddlot") {
      const [fallback, canonical] = await Promise.all([
        fugleRestQuoteFallback(env, symbol, "oddlot"),
        readFamilyCanonicalOhlc(env, {
          symbol,
          as_of_date: taipeiDate(),
          question: "零股即時報價",
          intent: "QUICK_STOCK_QUESTION",
        }),
      ]);
      return out({
        ok: fallback.status === "READY" || canonical.status === "READY",
        version: SHARED_STOCK_MARKET_CONTEXT_TOOLS_VERSION,
        symbol,
        quote_type: "oddlot",
        live_context: unavailableLive(symbol, "ODDLOT_USES_FUGLE_REST_DISPLAY_ONLY"),
        trade_tape: { status: "UNAVAILABLE", source: "FUGLE_REST_READ_ONLY", symbol, recent_trades: [], trade_tape: null, persistence: "none", error: "ODDLOT_TAPE_NOT_MODELED" },
        canonical_ohlc: canonical,
        display_fallback: fallback,
      });
    }

    const result = await sharedStockContext(env, symbol);
    const displayFallback = result.live_context.status === "UNAVAILABLE"
      ? await fugleRestQuoteFallback(env, symbol, "normal")
      : null;
    return out({ ...result, quote_type: "normal", display_fallback: displayFallback });
  });

  server.registerTool("get_daily_price", {
    description: "正式台股日K。直接唯讀tv-fugle-1d已寫入GitHub的canonical CSV，不把FinMind或盤中Fugle快照冒充正式日K。",
    inputSchema: {
      symbol: symbolSchema,
      start_date: isoDate.optional(),
      end_date: isoDate.optional(),
      limit: z.number().int().min(1).max(500).optional().default(120),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol, start_date, end_date, limit }) => {
    const end = end_date ?? taipeiDate();
    const canonical = await readFamilyCanonicalOhlc(env, {
      symbol,
      as_of_date: end,
      question: "正式日K 技術 趨勢",
      intent: "FULL_STOCK_ANALYSIS",
    });
    const rows = Array.isArray(canonical?.daily?.rows) ? canonical.daily.rows : [];
    const filtered = rows.filter((row: any) => {
      const date = String(row?.date ?? row?.trade_date ?? row?.time ?? "").slice(0, 10);
      if (start_date && date && date < start_date) return false;
      if (end && date && date > end) return false;
      return true;
    });
    return out({
      ok: canonical.status === "READY",
      source: String(canonical.source ?? "OHLC_MCP_GITHUB_CANONICAL_READ"),
      formal_research_eligible: canonical.formal_research_eligible === true,
      symbol,
      start_date: start_date ?? null,
      end_date: end,
      dataset_version: canonical.dataset_version ?? null,
      provenance: canonical.provenance ?? null,
      data: filtered.slice(-limit),
      canonical,
      error: canonical.error ?? null,
      version: SHARED_STOCK_MARKET_CONTEXT_TOOLS_VERSION,
    });
  });
}
