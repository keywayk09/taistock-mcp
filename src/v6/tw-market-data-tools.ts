import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTwMarketChipSummaryFast } from "./market-data-fast-gateway";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";
import { getTwMarketDataDayStatus } from "./market-data-day-status";
import {
  TW_MARKET_DATA_VERSION,
  getTwInstitutionalFlow,
  getTwMarginShort,
  getTwMarketDataBundle,
  getTwSecuritiesLending,
  getTwSblShortSale,
} from "./tw-market-data-github-live";

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
const fastSummarySchema = {
  ...querySchema,
  consistency: z.enum(["published", "live"]).optional().default("published"),
  reference_price: z.number().positive().optional(),
  estimated_financing_cost: z.number().positive().optional(),
  financing_ratio: z.number().min(0.1).max(0.9).optional().default(0.6),
};

export function registerTwMarketDataTools(server: McpServer, env: Env) {
  server.registerTool("get_tw_market_data_contract", {
    description: "P19 台股 Market Data 契約。法人、融資融券、借券/還券、借券賣出由 Diamond GitHub canonical data 負責；OHLC/K線仍只由 OHLC MCP 提供。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out({
    version: TW_MARKET_DATA_VERSION,
    owner: "Diamond Market Data Plane",
    preferred_symbol_read_tool: "get_tw_market_chip_summary",
    read_model: "published generation by default; live prefix-month index + exact-day snapshot overlay only when consistency=live",
    formal_consistency: "PUBLISHED",
    live_consistency: "LIVE_OVERLAY",
    official_sources: {
      listed_institutional: "TWSE T86",
      otc_institutional: "TPEx tpex_3insti_daily_trading",
      listed_margin: "TWSE MI_MARGN",
      otc_margin: "TPEx tpex_mainboard_margin_balance",
      securities_lending: "TWSE TWT72U (listed + OTC market label)",
      listed_sbl_short_sale: "TWSE TWT93U",
      otc_sbl_short_sale: "TPEx tpex_margin_sbl + tpex_short_sell",
    },
    semantic_layers: ["institutional", "margin", "securities_lending", "sbl_short_sale", "maintenance_risk"],
    fallback: {
      institutional: "FinMind history only",
      margin: "FinMind history only",
      securities_lending: "OFFICIAL_ONLY",
      sbl_short_sale: "OFFICIAL_ONLY",
    },
    storage: "GitHub canonical only: keywayk09/tv-papertrader main/data; D1/R2 forbidden for app data",
    rolling_windows: [1,3,5,10,20],
    hard_boundaries: {
      ohlc_gateway: "OHLC_MCP_ONLY",
      market_data_ohlc_write: "FORBIDDEN",
      finmind_price_as_formal_ohlc: "FORBIDDEN",
      official_account_maintenance_ratio_reconstruction: "FORBIDDEN_WITHOUT_BROKER_ACCOUNT_DATA",
      d1_app_persistence: "FORBIDDEN",
      r2_usage: "FORBIDDEN",
      market_data_failure_blocks_ohlc: false,
      market_data_failure_blocks_unrelated_swing_layers: false,
      formal_read_mixed_generation: "FORBIDDEN",
      formal_read_daily_snapshot_overlay: "FORBIDDEN",
    },
  }));

  server.registerTool("get_tw_market_chip_summary", {
    description: "正式個股籌碼入口。預設 consistency=published，只讀已完成 audit 並由 published pointer 原子發布的 generation；若要檢查尚未發布的最新 canonical/index/snapshot 狀態，明確指定 consistency=live。整合法人、融資融券、借券、借券賣出與估算維持率風險契約。",
    inputSchema: fastSummarySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(
    input.consistency === "live"
      ? await getTwMarketChipSummaryFast(env, input)
      : await getTwMarketChipSummaryPublished(env, input),
  ));

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
    description: "相容型 Swing/研究籌碼 bundle：法人＋融資融券＋借券/還券＋借券賣出分層回傳 readiness；需要 FinMind 歷史 fallback 時使用。一般個股讀取優先 get_tw_market_chip_summary。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await getTwMarketDataBundle(env, input)));

  server.registerTool("get_tw_market_data_status", {
    description: "查詢 Diamond GitHub canonical market-data 日狀態：交易日回傳八層 readiness，正式休市日回傳 NO_TRADING_DAY；永遠不作為 OHLC 全域 blocker。",
    inputSchema: { trade_date: dateSchema.optional() },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ trade_date }) => {
    const date = trade_date ?? new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
    return out(await getTwMarketDataDayStatus(env, date));
  });
}
