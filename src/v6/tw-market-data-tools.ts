import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTwMarketCrossSection } from "./market-data-cross-section";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";
import { getTwMarketDataDayStatus } from "./market-data-day-status";
import { getTwChipOnDemandSnapshot, TW_CHIP_ON_DEMAND_VERSION } from "./tw-chip-on-demand.ts";
import {
  TW_MARKET_DATA_VERSION,
  getTwInstitutionalFlow,
  getTwMarginShort,
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
  // Compatibility only. Both values now resolve current-day evidence through
  // the same exact-date on-demand provider; the public schema is frozen.
  consistency: z.enum(["published", "live"]).optional().default("published"),
  reference_price: z.number().positive().optional(),
  estimated_financing_cost: z.number().positive().optional(),
  financing_ratio: z.number().min(0.1).max(0.9).optional().default(0.6),
};
const familyChipSchema = {
  ...querySchema,
  reference_price: z.number().positive().optional(),
  estimated_financing_cost: z.number().positive().optional(),
  financing_ratio: z.number().min(0.1).max(0.9).optional().default(0.6),
};
const crossSectionSchema = {
  as_of: dateSchema.optional(),
  calendar_days: z.number().int().min(20).max(62).optional().default(20),
  prefix: z.string().regex(/^[0-9]$/).optional(),
  limit: z.number().int().min(1).max(2500).optional(),
};

type QueryInput = { symbol: string; as_of?: string; calendar_days?: number };

async function currentWithLegacyHistory(
  env: Env,
  input: QueryInput,
  layer: "institutional" | "margin_short" | "securities_lending" | "sbl_short_sale",
  historyReader: (env: Env, input: QueryInput) => Promise<any>,
) {
  const [current, history] = await Promise.all([
    getTwChipOnDemandSnapshot({ symbol: input.symbol, as_of: input.as_of }),
    historyReader(env, input),
  ]);
  const currentLayer = current.layers[layer];
  const currentUsable = currentLayer.status === "READY" || currentLayer.status === "READY_EMPTY";
  return {
    ...history,
    ok: currentUsable || history?.ok === true,
    version: TW_CHIP_ON_DEMAND_VERSION,
    storage: "ON_DEMAND_CURRENT+LEGACY_ARCHIVE_READ_ONLY",
    read_strategy: "OFFICIAL_EXACT_DATE_ON_DEMAND_FIRST; LEGACY_HISTORY_CONTEXT_ONLY",
    requested_as_of: current.requested_as_of,
    status: currentUsable ? currentLayer.status : currentLayer.status === "PENDING" ? "PENDING" : (history?.status ?? "UNAVAILABLE"),
    preferred_current_evidence: "on_demand_current",
    on_demand_current: currentLayer,
    on_demand_source_health: current.source_health,
    previous_day_substitution: false,
    history_context: {
      role: "LEGACY_ARCHIVE_CONTEXT_ONLY",
      status: history?.status ?? "UNAVAILABLE",
      as_of: history?.as_of ?? null,
      windows: history?.windows ?? null,
      rows: history?.rows ?? [],
      datasets: history?.datasets ?? [],
    },
  };
}

export function registerTwMarketDataTools(server: McpServer, env: Env) {
  server.registerTool("get_tw_market_data_contract", {
    description: "台股籌碼資料契約。OHLC/K線維持既有 canonical pipeline；法人、融資融券、借券/還券、借券賣出改為需要時直接讀 TWSE/TPEx 官方來源，不做每日 raw capture。舊 GitHub 籌碼資料僅保留唯讀歷史背景。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out({
    version: TW_CHIP_ON_DEMAND_VERSION,
    legacy_market_data_version: TW_MARKET_DATA_VERSION,
    owner: "Diamond On-Demand Chip Gateway",
    preferred_symbol_read_tool: "get_tw_market_chip_summary",
    preferred_cross_sectional_read_tool: null,
    family_symbol_read_tool: "get_family_market_chip_summary",
    family_access: "READ_ONLY_SAME_PROVIDER",
    current_read_model: "exact-date official on-demand; no previous-day substitution; no current raw/normalized persistence",
    legacy_history_model: "existing GitHub archive is read-only context only and is not required to continue daily capture",
    official_sources: {
      listed_institutional: "TWSE T86",
      otc_institutional: "TPEx tpex_3insti_daily_trading",
      listed_margin: "TWSE MI_MARGN",
      otc_margin: "TPEx tpex_mainboard_margin_balance",
      securities_lending: "TWSE TWT72U (listed + OTC market label)",
      listed_sbl_short_sale: "TWSE TWT93U",
      otc_sbl_short_sale: "TPEx tpex_margin_sbl + tpex_short_sell",
    },
    semantic_layers: ["institutional", "margin", "securities_lending", "sbl_short_sale", "broker_branch_experimental", "warrant_planned", "maintenance_ratio_proxy_only"],
    persistence: {
      current_raw: "NONE",
      current_normalized: "NONE",
      legacy_archive: "READ_ONLY",
      ohlc: "UNCHANGED_CANONICAL_PIPELINE",
    },
    hard_boundaries: {
      public_ingress_change: "FORBIDDEN",
      ohlc_gateway: "OHLC_MCP_ONLY",
      market_data_ohlc_write: "FORBIDDEN",
      previous_day_substitution: "FORBIDDEN",
      official_account_maintenance_ratio_reconstruction: "FORBIDDEN_WITHOUT_BROKER_ACCOUNT_DATA",
      family_market_data_write: "FORBIDDEN",
      broker_branch_ranked_output_as_complete_inventory: "FORBIDDEN",
    },
  }));

  server.registerTool("get_tw_market_cross_section", {
    description: "舊全市場籌碼橫截面唯讀歷史工具。資料來自既有 GitHub archive，停止作為每日最新選股資料面；目前 18:00/22:00 GPT 選股應以個股 on-demand 官方資料補證。保留此名稱只為相容與歷史研究。",
    inputSchema: crossSectionSchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out({
    role: "LEGACY_ARCHIVE_CONTEXT_ONLY",
    current_selection_source: false,
    data: await getTwMarketCrossSection(env, input),
  }));

  server.registerTool("get_tw_market_chip_summary", {
    description: "Owner 個股籌碼主入口。公開名稱不變；內部已改為 TWSE/TPEx 官方 exact-date on-demand current evidence，法人、融資融券、借券與借券賣出不做每日 raw 保存。舊 GitHub generation 只作歷史背景。若當日尚未公布，回 PENDING，禁止拿前一日冒充。",
    inputSchema: fastSummarySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out({
    ...(await getTwMarketChipSummaryPublished(env, input)),
    requested_legacy_consistency: input.consistency,
    consistency_compatibility_note: "published/live input retained for ABI compatibility; current evidence always prefers exact-date on-demand official sources.",
  }));

  server.registerTool("get_family_market_chip_summary", {
    description: "家人版唯讀個股籌碼入口。公開名稱與 /family-mcp 入口不變；與 Owner 共用 TWSE/TPEx exact-date on-demand current evidence，但 Family 永遠唯讀、不寫 GitHub、不下單。舊 archive 僅作歷史背景。",
    inputSchema: familyChipSchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await getTwMarketChipSummaryPublished(env, input)));

  server.registerTool("get_tw_institutional_flow", {
    description: "查詢個股法人籌碼。當日資料優先直接讀 TWSE/TPEx 官方 exact-date on-demand；既有 GitHub/FinMind 歷史只標為背景，不得覆蓋或冒充當日。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await currentWithLegacyHistory(env, input, "institutional", getTwInstitutionalFlow)));

  server.registerTool("get_tw_margin_short", {
    description: "查詢個股融資融券。當日融資/融券餘額與增減直接讀 TWSE MI_MARGN 或 TPEx 官方來源；不再依賴每日 GitHub raw capture。當日未公布回 PENDING，不得拿前一日冒充。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await currentWithLegacyHistory(env, input, "margin_short", getTwMarginShort)));

  server.registerTool("get_tw_securities_lending", {
    description: "查詢借券成交、還券/了結與借券餘額。當日直接讀 TWSE TWT72U exact-date 官方來源，不保存 raw；還券是官方返還/了結欄位，不等同盤中買回成交量。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await currentWithLegacyHistory(env, input, "securities_lending", getTwSecuritiesLending)));

  server.registerTool("get_tw_sbl_short_sale", {
    description: "查詢借券賣出、還券/調整/餘額。上市當日直接讀 TWSE TWT93U；上櫃直接讀 TPEx tpex_margin_sbl + tpex_short_sell。exact-date fail-closed，不保存 raw。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await currentWithLegacyHistory(env, input, "sbl_short_sale", getTwSblShortSale)));

  server.registerTool("get_tw_market_data_bundle", {
    description: "相容型個股籌碼 bundle。公開名稱保留；目前直接回傳與 get_tw_market_chip_summary 相同的 on-demand current evidence + 唯讀歷史背景，不再啟動每日 capture/publish。",
    inputSchema: querySchema,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true },
  }, async (input) => out(await getTwMarketChipSummaryPublished(env, input)));

  server.registerTool("get_tw_market_data_status", {
    description: "舊 GitHub market-data archive 狀態查詢，僅供歷史/遷移診斷。它不代表目前 on-demand 官方來源是否可用；目前選股請看各個股工具回傳的 on_demand_source_health。",
    inputSchema: { trade_date: dateSchema.optional() },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ trade_date }) => {
    const date = trade_date ?? new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
    return out({
      role: "LEGACY_ARCHIVE_DIAGNOSTIC_ONLY",
      scheduled_capture_enabled: false,
      data: await getTwMarketDataDayStatus(env, date),
    });
  });
}
