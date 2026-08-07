import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type OhlcRuntimeEnv = Env & {
  OHLC_API_URL?: string;
  OHLC_API_TOKEN?: string;
  TV_FUGLE_1D_URL?: string;
  TV_FUGLE_5M_URL?: string;
  TV_FUGLE_1M_URL?: string;
  TV_ALERT_RAW_URL?: string;
  TV_GITHUB_EXPORT_URL?: string;
};

const marketSchema = z.enum(["tw_stock", "txf", "mtx", "tmf"]);
const timeframeSchema = z.enum(["1m", "5m", "1d"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  };
}

function trimUrl(value?: string) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function requireApi(env: OhlcRuntimeEnv) {
  const baseUrl = trimUrl(env.OHLC_API_URL);
  if (!baseUrl) throw new Error("OHLC_API_URL 尚未設定；目前 MCP 介面已建立，但統一 OHLC 後端尚未串接。");
  return { baseUrl, token: String(env.OHLC_API_TOKEN ?? "").trim() };
}

async function requestJson(env: OhlcRuntimeEnv, path: string, init: RequestInit = {}) {
  const { baseUrl, token } = requireApi(env);
  const headers = new Headers(init.headers ?? {});
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let payload: unknown = text;
  try { payload = JSON.parse(text); } catch { /* keep text */ }
  if (!response.ok) throw new Error(`OHLC backend ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  return payload;
}

async function probeHealth(url: string) {
  if (!url) return { configured: false, ok: false, reason: "not_configured" };
  try {
    const response = await fetch(`${trimUrl(url)}/health`, { headers: { accept: "application/json" } });
    const text = await response.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return { configured: true, ok: response.ok, status: response.status, body };
  } catch (error) {
    return { configured: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerOhlcMcpTools(server: McpServer, rawEnv: Env) {
  const env = rawEnv as OhlcRuntimeEnv;

  server.registerTool("get_ohlc_mcp_status", {
    description: "檢查 OHLC MCP 與舊 Cloudflare Workers 的串接狀態。只讀，不會抓大量行情、補資料或修改正式資料。",
    inputSchema: {},
  }, async () => {
    try {
      const unified = trimUrl(env.OHLC_API_URL);
      const legacy = {
        fugle_1d: trimUrl(env.TV_FUGLE_1D_URL),
        fugle_5m: trimUrl(env.TV_FUGLE_5M_URL),
        fugle_1m: trimUrl(env.TV_FUGLE_1M_URL),
        alert_raw: trimUrl(env.TV_ALERT_RAW_URL),
        github_export: trimUrl(env.TV_GITHUB_EXPORT_URL),
      };
      const entries = await Promise.all(Object.entries(legacy).map(async ([name, url]) => [name, await probeHealth(url)] as const));
      return ok({
        system: "OHLC MCP",
        version: "0.1-contract",
        unified_backend: unified ? await probeHealth(unified) : { configured: false, ok: false, reason: "not_configured" },
        legacy_workers: Object.fromEntries(entries),
        design: "MCP facade -> unified OHLC API -> Cloudflare fetch/state/indicator layers -> R2/D1 -> validated GitHub archive",
        formal_strategy_changes_allowed: false,
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_ohlc_bars", {
    description: "從統一 OHLC 後端讀取台股或台指期 OHLC。支援日K、5分K、1分K。這是讀取工具，不會修改正式資料。",
    inputSchema: {
      market: marketSchema.describe("tw_stock=台股；txf=台指期；mtx=小台；tmf=微台"),
      symbol: z.string().trim().min(1).max(30).describe("台股代號或期貨合約/連續合約識別碼"),
      timeframe: timeframeSchema,
      start_date: dateSchema,
      end_date: dateSchema,
      limit: z.number().int().min(1).max(20_000).optional(),
      include_indicators: z.boolean().default(false),
    },
  }, async (input) => {
    try {
      const query = new URLSearchParams({
        market: input.market,
        symbol: input.symbol,
        timeframe: input.timeframe,
        start_date: input.start_date,
        end_date: input.end_date,
        include_indicators: String(input.include_indicators),
      });
      if (input.limit) query.set("limit", String(input.limit));
      return ok(await requestJson(env, `/v1/bars?${query.toString()}`));
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_ohlc_symbol_status", {
    description: "查看某標的在各週期的最後完成時間、缺K、重複K、初始化狀態與指標狀態。只讀。",
    inputSchema: {
      market: marketSchema,
      symbol: z.string().trim().min(1).max(30),
    },
  }, async (input) => {
    try {
      const query = new URLSearchParams({ market: input.market, symbol: input.symbol });
      return ok(await requestJson(env, `/v1/symbol-status?${query.toString()}`));
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_ohlc_missing_ranges", {
    description: "查詢某標的日K、5分K或1分K缺少的時間區間。僅診斷，不自動補資料。",
    inputSchema: {
      market: marketSchema,
      symbol: z.string().trim().min(1).max(30),
      timeframe: timeframeSchema,
      start_date: dateSchema,
      end_date: dateSchema,
    },
  }, async (input) => {
    try {
      const query = new URLSearchParams({
        market: input.market,
        symbol: input.symbol,
        timeframe: input.timeframe,
        start_date: input.start_date,
        end_date: input.end_date,
      });
      return ok(await requestJson(env, `/v1/missing-ranges?${query.toString()}`));
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_ohlc_watchlist", {
    description: "讀取 OHLC 追蹤池，包含快訊來源新標的與手動標的。只讀。",
    inputSchema: {
      market: marketSchema.default("tw_stock"),
      source: z.enum(["all", "alerts", "manual", "system"]).default("all"),
      active_only: z.boolean().default(true),
    },
  }, async (input) => {
    try {
      const query = new URLSearchParams({
        market: input.market,
        source: input.source,
        active_only: String(input.active_only),
      });
      return ok(await requestJson(env, `/v1/watchlist?${query.toString()}`));
    } catch (error) { return fail(error); }
  });

  server.registerTool("preview_alert_symbols_for_ohlc", {
    description: "預覽快訊來源目前有哪些新標的尚未加入 OHLC 追蹤池。只做比較，不會新增標的、不會抓資料。",
    inputSchema: {
      market: z.literal("tw_stock").default("tw_stock"),
      limit: z.number().int().min(1).max(1000).default(200),
    },
  }, async (input) => {
    try {
      const query = new URLSearchParams({ market: input.market, limit: String(input.limit) });
      return ok(await requestJson(env, `/v1/watchlist/alerts/preview?${query.toString()}`));
    } catch (error) { return fail(error); }
  });

  server.registerTool("validate_incremental_indicators", {
    description: "驗證『上一根成熟指標狀態＋新K』的增量計算，是否與完整歷史重算一致。只做測試與比較，不修改正式指標公式或 Stable 版本。",
    inputSchema: {
      market: marketSchema,
      symbol: z.string().trim().min(1).max(30),
      timeframe: timeframeSchema,
      as_of_date: dateSchema.optional(),
      sample_bars: z.number().int().min(50).max(2000).default(300),
      indicators: z.array(z.enum(["ema5", "ema10", "ema20", "ema60", "ema120", "ema240", "rsi14", "macd", "atr14", "kd"])).min(1).max(10).default(["ema20", "rsi14", "macd", "atr14"]),
    },
  }, async (input) => {
    try {
      return ok(await requestJson(env, "/v1/indicators/validate", {
        method: "POST",
        body: JSON.stringify(input),
      }));
    } catch (error) { return fail(error); }
  });
}
