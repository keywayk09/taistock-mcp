import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readFamilyCanonicalOhlc,
  readFamilyStockMarketContext,
} from "./family-ohlc-read-bridge";

export const SHARED_STOCK_MARKET_CONTEXT_TOOLS_VERSION = "shared-stock-market-context-tools/v1.0.0";

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
    source: "OHLC_READ_SERVICE_STOCK_LIVE",
    symbol,
    live_status: "LIVE_UNAVAILABLE",
    display_ready: false,
    decision_eligible: false,
    formal_research_eligible: false,
    book: { bids: [], asks: [] },
    error: reason,
    persistence: "none",
  };
}

async function fugleRestQuoteFallback(env: Env, symbol: string, type: "normal" | "oddlot") {
  const key = String((env as any)?.FUGLE_API_KEY ?? "").trim();
  if (!key) return { status: "UNAVAILABLE", source: "FUGLE_REST_DISPLAY_FALLBACK", data: null, error: "FUGLE_API_KEY_NOT_CONFIGURED" };
  const url = new URL(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(symbol)}`);
  if (type === "oddlot") url.searchParams.set("type", "oddlot");
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-API-KEY": key },
    });
    const text = await response.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      return {
        status: "UNAVAILABLE",
        source: "FUGLE_REST_DISPLAY_FALLBACK",
        data: null,
        error: `FUGLE_REST_HTTP_${response.status}`,
      };
    }
    return {
      status: "READY",
      source: "FUGLE_REST_DISPLAY_FALLBACK",
      formal_research_eligible: false,
      data: body,
      error: null,
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      source: "FUGLE_REST_DISPLAY_FALLBACK",
      data: null,
      error: `FUGLE_REST:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function sharedStockContext(env: Env, symbol: string) {
  const asOf = taipeiDate();
  const [live, canonical] = await Promise.all([
    readFamilyStockMarketContext(env, { symbol, books: true, wait_ms: 1_800 }),
    readFamilyCanonicalOhlc(env, {
      symbol,
      as_of_date: asOf,
      question: "盤中 現在 五檔 技術 量價",
      intent: "QUICK_STOCK_QUESTION",
    }),
  ]);

  return {
    ok: live.status !== "UNAVAILABLE" || canonical.status === "READY",
    version: SHARED_STOCK_MARKET_CONTEXT_TOOLS_VERSION,
    symbol,
    as_of_date: asOf,
    source_priority: [
      "OHLC_READ_SERVICE_STOCK_LIVE",
      "OHLC_MCP_VERIFIED_CANONICAL",
      "FUGLE_REST_DISPLAY_FALLBACK",
    ],
    live_context: live,
    canonical_ohlc: canonical,
    identity: {
      live: "EPHEMERAL_READ_ONLY_CONTEXT_NOT_FORMAL_OHLC",
      canonical_ohlc: "FORMAL_TRUTH_ONLY_WHEN_OHLC_MCP_GATE_READY",
      writes: false,
      orders: false,
    },
  };
}

export function registerSharedStockMarketContextTools(server: McpServer, env: Env) {
  server.registerTool("get_stock_market_context", {
    description: "單股盤中首選入口：一次取得OHLC MCP正式1D/5m結構，以及tv-fugle-1d StockLiveHub的最新成交、買一到買五、賣一到賣五、深度不平衡與短窗Order Flow。Live只讀且不持久化；正式技術結構只認OHLC MCP。",
    inputSchema: { symbol: symbolSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol }) => out(await sharedStockContext(env, symbol)));

  // Keep the long-standing tool name so the Owner/妹妹 GPT does not need a prompt
  // rewrite. Normal-lot quote now prefers the shared Stock Live service and returns
  // formal OHLC alongside it; odd-lot remains REST display-only because StockLiveHub
  // intentionally models the normal continuous book.
  server.registerTool("get_quote", {
    description: "台股即時報價。normal模式優先回傳StockLiveHub最新成交、五檔與Order Flow，並同時附OHLC MCP正式1D/5m；oddlot維持Fugle REST顯示資料。",
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
        canonical_ohlc: canonical,
        display_fallback: fallback,
      });
    }

    const result = await sharedStockContext(env, symbol);
    const displayFallback = result.live_context.status === "UNAVAILABLE"
      ? await fugleRestQuoteFallback(env, symbol, "normal")
      : null;
    return out({
      ...result,
      quote_type: "normal",
      display_fallback: displayFallback,
    });
  });

  // Freeze the old FinMind daily-price identity behind the existing tool name.
  // The response now comes only from the verified OHLC MCP read bridge.
  server.registerTool("get_daily_price", {
    description: "正式台股日K。只讀OHLC MCP verified canonical，不再把FinMind價格冒充正式日K。",
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
      source: "OHLC_MCP",
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
