import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TW_MARKET_DATA_VERSION,
  getTwInstitutionalFlow,
  getTwMarginShort,
  getTwMarketDataBundle,
  getTwMarketDataStatus,
  getTwSecuritiesLending,
  getTwSblShortSale,
} from "./tw-market-data-github";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const symbolSchema = z.string().trim().regex(/^\d{4,6}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = {
  symbol: symbolSchema,
  as_of: dateSchema.optional(),
  calendar_days: z.number().int().min(30).max(180).optional().default(60),
};

export function registerTwMarketDataTools(server: McpServer, env: Env) {
  server.registerTool("get_tw_market_data_contract", {
    description: "P19 台股 Market Data 契約。法人、融資融券、借券/還券、借券賣出由 Diamond GitHub canonical data 負責；OHLC/K線仍只由 OHLC MCP 提供。",
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
      securities_lending: "TWSE TWT72U (listed + OTC market label)",
      listed_sbl_short_sale: "TWSE TWT93U",
      otc_sbl_short_sale: "TPEx tpex_margin_sbl + tpex_short_sell",
    },
    fallback: {
      institutional: "FinMind history only",
      margin: "FinMind history only",
      securities_lending: "OFFICIAL_ONLY",
      sbl_short_sale: "OFFICIAL_ONLY",
    },
    storage: "GitHub diamond-data only; D1/R2 forbidden for app data",
    rolling_windows: [1,3,5,10,20],
    hard_boundaries: {
      ohlc_gateway: "OHLC_MCP_ONLY",
      market_data_ohlc_write: "FORBIDDEN",
      finmind_price_as_formal_ohlc: "FORBIDDEN",
      d1_app_persistence: "FORBIDDEN",
      r2_usage: "FORBIDDEN",
      market_data_failure_blocks_ohlc: false,
      market_data_failure_blocks_unrelated_swing_layers: false,
    },
  }));

  server.registerTool("get_tw_institutional_flow", {
    description: "查詢台股個股三大法人 1/3/5/10/20 日累積。GitHub 官方封存資料優先，FinMind 僅補歷史/降級。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await getTwInstitutionalFlow(env, input)));

  server.registerTool("get_tw_margin_short", {
    description: "查詢台股個股融資融券餘額與 1/3/5/10/20 日變化。GitHub 官方封存資料優先，FinMind 僅補歷史/降級。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await getTwMarginShort(env, input)));

  server.registerTool("get_tw_securities_lending", {
    description: "查詢借券成交、還券/了結、借券餘額與 1/3/5/10/20 日變化。來源為 TWSE TWT72U 官方封存；還券是官方借券返還/了結欄位，不等同盤中買回成交量。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await getTwSecuritiesLending(env, input)));

  server.registerTool("get_tw_sbl_short_sale", {
    description: "查詢借券賣出、借券賣出還券/調整/餘額及 1/3/5/10/20 日變化。上市取 TWSE TWT93U，上櫃取 TPEx tpex_margin_sbl + tpex_short_sell。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await getTwSblShortSale(env, input)));

  server.registerTool("get_tw_market_data_bundle", {
    description: "正式 Swing/研究籌碼 bundle：法人＋融資融券＋借券/還券＋借券賣出分層回傳 readiness；缺一層只降級該層，不封鎖 OHLC。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await getTwMarketDataBundle(env, input)));

  server.registerTool("get_tw_market_data_status", {
    description: "查詢 Diamond GitHub canonical market-data 八層 readiness（四種類 × 上市/上櫃）；永遠不作為 OHLC 全域 blocker。",
    inputSchema: { trade_date: dateSchema.optional() },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ trade_date }) => out(await getTwMarketDataStatus(env, trade_date)));
}
