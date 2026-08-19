import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TW_MARKET_DATA_VERSION,
  getTwInstitutionalFlow,
  getTwMarginShort,
  getTwMarketDataBundle,
  getTwMarketDataStatus,
} from "./tw-market-data-d1";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const symbolSchema = z.string().trim().regex(/^\d{4,6}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerTwMarketDataTools(server: McpServer, env: Env) {
  server.registerTool("get_tw_market_data_contract", {
    description: "P18 台股 Market Data 契約。法人與融資融券由 Diamond 官方優先資料層負責；OHLC/K線仍只由 OHLC MCP 提供。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out({
    version: TW_MARKET_DATA_VERSION,
    owner: "Diamond Market Data Plane",
    official_sources: {
      listed_institutional: "TWSE T86",
      otc_institutional: "TPEx tpex_3insti_daily_trading",
      listed_margin: "TWSE MI_MARGN",
      otc_margin: "TPEx tpex_mainboard_margin_balance",
    },
    fallback: "FinMind history only",
    storage: "Cloudflare D1 only; R2 forbidden by project policy",
    rolling_windows: [1,3,5,10,20],
    hard_boundaries: {
      ohlc_gateway: "OHLC_MCP_ONLY",
      market_data_ohlc_write: "FORBIDDEN",
      finmind_price_as_formal_ohlc: "FORBIDDEN",
      r2_usage: "FORBIDDEN",
      market_data_failure_blocks_ohlc: false,
      market_data_failure_blocks_unrelated_swing_layers: false,
    },
  }));

  server.registerTool("get_tw_institutional_flow", {
    description: "查詢台股個股三大法人 1/3/5/10/20 日累積。Diamond 官方 D1 封存資料優先，FinMind僅補歷史/降級。",
    inputSchema: {
      symbol: symbolSchema,
      as_of: dateSchema.optional(),
      calendar_days: z.number().int().min(30).max(180).optional().default(60),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async ({ symbol, as_of, calendar_days }) => out(await getTwInstitutionalFlow(env, { symbol, as_of, calendar_days })));

  server.registerTool("get_tw_margin_short", {
    description: "查詢台股個股融資融券餘額與 1/3/5/10/20 日變化。Diamond 官方 D1 封存資料優先，FinMind僅補歷史/降級。",
    inputSchema: {
      symbol: symbolSchema,
      as_of: dateSchema.optional(),
      calendar_days: z.number().int().min(30).max(180).optional().default(60),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async ({ symbol, as_of, calendar_days }) => out(await getTwMarginShort(env, { symbol, as_of, calendar_days })));

  server.registerTool("get_tw_market_data_bundle", {
    description: "正式 Swing/研究用籌碼資料 bundle：法人＋融資融券分層回傳 readiness；缺一層只降級該層，不得封鎖 OHLC。",
    inputSchema: {
      symbol: symbolSchema,
      as_of: dateSchema.optional(),
      calendar_days: z.number().int().min(30).max(180).optional().default(60),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async ({ symbol, as_of, calendar_days }) => out(await getTwMarketDataBundle(env, { symbol, as_of, calendar_days })));

  server.registerTool("get_tw_market_data_status", {
    description: "查詢 Diamond 台股官方法人/融資融券四層 D1 readiness；此狀態永遠不作為 OHLC 全域 blocker。",
    inputSchema: { trade_date: dateSchema.optional() },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ trade_date }) => out(await getTwMarketDataStatus(env, trade_date)));
}
