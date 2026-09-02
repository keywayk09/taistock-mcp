import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFamilyStockMarketContext } from "./family-ohlc-read-bridge";
import { getTwMarketCrossSection } from "./market-data-cross-section";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";
import { getSupplyChainContract } from "./supply-chain-graph";
import {
  getTwInstitutionalFlow,
  getTwMarginShort,
  getTwMarketDataBundle,
} from "./tw-market-data-github-live";

export const DIAMOND_CHATGPT_FIXED_FACADE_VERSION = "diamond-chatgpt-fixed-facade/v1";

/**
 * These are the names present in the frozen 79-tool ChatGPT App snapshot but
 * no longer registered by the modern Owner composition root. They MUST remain
 * callable because ChatGPT may keep the old tool schema even after reconnect.
 *
 * Do not restore the historical D1-backed implementations. This adapter keeps
 * the public name stable and routes safe reads to the current GitHub/read-only
 * plane. Retired writes fail closed with an explicit structured result.
 */
export const DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES = Object.freeze([
  "add_industry_evidence",
  "create_classification_candidate",
  "get_active_etf_daily_change_report",
  "get_active_etf_holding_changes",
  "get_active_etf_holdings",
  "get_active_etf_list",
  "get_company_industry_map",
  "get_daily_chip_report",
  "get_global_industry_coverage",
  "get_official_market_institutional",
  "get_official_market_margin",
  "get_official_stock_institutional",
  "get_official_stock_margin",
  "get_stock_active_etf_activity",
  "get_supply_chain_network",
  "get_taifex_futures_daily",
  "get_taifex_futures_positions",
  "get_taifex_institutional_general",
  "get_taifex_options_daily",
  "get_taifex_options_positions",
  "get_taiwan_stock_analysis_12",
  "get_taiwan_stock_analysis_kpis",
  "get_taiwan_stock_analysis_template_12",
  "get_theme_industry_map",
  "get_unclassified_taiwan_companies",
  "import_global_industry_batch",
  "initialize_global_industry_map",
  "list_active_etf_official_sources",
  "refresh_active_etf_official_holdings",
  "review_classification_candidate",
  "search_global_industry_map",
  "set_active_etf_official_source",
  "set_company_theme_membership",
  "set_supply_chain_edge",
  "set_taiwan_stock_analysis_context",
  "sync_taiwan_company_universe",
  "upsert_global_company",
  "upsert_industry_theme",
  "upsert_taiwan_stock_analysis_kpi",
] as const);

const retiredWrites = new Set<string>([
  "add_industry_evidence",
  "create_classification_candidate",
  "import_global_industry_batch",
  "initialize_global_industry_map",
  "refresh_active_etf_official_holdings",
  "review_classification_candidate",
  "set_active_etf_official_source",
  "set_company_theme_membership",
  "set_supply_chain_edge",
  "set_taiwan_stock_analysis_context",
  "sync_taiwan_company_universe",
  "upsert_global_company",
  "upsert_industry_theme",
  "upsert_taiwan_stock_analysis_kpi",
]);

const etfReads = new Set<string>([
  "get_active_etf_daily_change_report",
  "get_active_etf_holding_changes",
  "get_active_etf_holdings",
  "get_active_etf_list",
  "get_stock_active_etf_activity",
  "list_active_etf_official_sources",
]);

const taifexReads = new Set<string>([
  "get_taifex_futures_daily",
  "get_taifex_futures_positions",
  "get_taifex_institutional_general",
  "get_taifex_options_daily",
  "get_taifex_options_positions",
]);

const globalMapReads = new Set<string>([
  "get_company_industry_map",
  "get_global_industry_coverage",
  "get_supply_chain_network",
  "get_theme_industry_map",
  "get_unclassified_taiwan_companies",
  "search_global_industry_map",
]);

const analysis12Reads = new Set<string>([
  "get_taiwan_stock_analysis_12",
  "get_taiwan_stock_analysis_kpis",
  "get_taiwan_stock_analysis_template_12",
]);

const permissiveCompatSchema = {
  symbol: z.string().trim().max(32).optional(),
  stock_id: z.string().trim().max(32).optional(),
  stock: z.string().trim().max(32).optional(),
  code: z.string().trim().max(32).optional(),
  date: z.string().trim().max(32).optional(),
  as_of: z.string().trim().max(32).optional(),
  as_of_date: z.string().trim().max(32).optional(),
  start_date: z.string().trim().max(32).optional(),
  end_date: z.string().trim().max(32).optional(),
  query: z.string().trim().max(4000).optional(),
  keyword: z.string().trim().max(1000).optional(),
  market: z.string().trim().max(64).optional(),
  limit: z.number().int().min(1).max(2500).optional(),
};

type CompatInput = z.infer<z.ZodObject<typeof permissiveCompatSchema>>;

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function symbolOf(input: CompatInput) {
  const value = String(input.symbol ?? input.stock_id ?? input.stock ?? input.code ?? "").trim();
  return /^\d{4,6}$/.test(value) ? value : "";
}

function asOfOf(input: CompatInput) {
  const value = String(input.as_of ?? input.as_of_date ?? input.date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function retired(tool: string, modernCapability: string, detail: string) {
  return out({
    ok: false,
    status: "LEGACY_COMPATIBILITY_RETAINED_FAIL_CLOSED",
    facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
    legacy_tool: tool,
    modern_capability: modernCapability,
    detail,
    persistence: "NONE",
    d1_app_persistence: "FORBIDDEN",
    r2_app_persistence: "FORBIDDEN",
    production_mutation: "NONE",
  });
}

async function handleLegacyRead(tool: string, env: Env, input: CompatInput) {
  const symbol = symbolOf(input);
  const as_of = asOfOf(input);

  if (tool === "get_official_stock_institutional") {
    if (!symbol) return retired(tool, "get_tw_institutional_flow", "legacy call requires a 4-6 digit Taiwan stock symbol");
    return out({
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tool: "get_tw_institutional_flow",
      data: await getTwInstitutionalFlow(env, { symbol, as_of, calendar_days: 60 }),
    });
  }

  if (tool === "get_official_stock_margin") {
    if (!symbol) return retired(tool, "get_tw_margin_short", "legacy call requires a 4-6 digit Taiwan stock symbol");
    return out({
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tool: "get_tw_margin_short",
      data: await getTwMarginShort(env, { symbol, as_of, calendar_days: 60 }),
    });
  }

  if (tool === "get_daily_chip_report") {
    if (!symbol) return retired(tool, "get_tw_market_data_bundle", "legacy call requires a 4-6 digit Taiwan stock symbol");
    return out({
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tool: "get_tw_market_data_bundle",
      data: await getTwMarketDataBundle(env, { symbol, as_of, calendar_days: 60 }),
    });
  }

  if (tool === "get_official_market_institutional" || tool === "get_official_market_margin") {
    const data = await getTwMarketCrossSection(env, {
      ...(as_of ? { as_of } : {}),
      calendar_days: 20,
      limit: input.limit,
    });
    return out({
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tool: "get_tw_market_cross_section",
      projection: tool.endsWith("institutional") ? "institutional" : "margin",
      data,
    });
  }

  if (analysis12Reads.has(tool)) {
    if (!symbol) {
      return out({
        ok: true,
        status: "LEGACY_TEMPLATE_COMPATIBILITY",
        facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
        legacy_tool: tool,
        modern_tools: ["get_stock_market_context", "get_tw_market_chip_summary", "get_monthly_revenue", "get_valuation", "get_stock_news"],
        note: "舊12項 facade 保留；現代資料由既有固定工具內部組合，不新增 ChatGPT 公開工具。",
      });
    }
    const [marketContext, chip] = await Promise.all([
      readFamilyStockMarketContext(env, { symbol, books: true, wait_ms: 0 }),
      getTwMarketChipSummaryPublished(env, { symbol, as_of, calendar_days: 60 }),
    ]);
    return out({
      ok: true,
      status: "LEGACY_12_ANALYSIS_COMPATIBILITY",
      facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      symbol,
      market_context: marketContext,
      chip,
      enrichment_contract: {
        existing_public_tools: ["get_monthly_revenue", "get_valuation", "get_stock_news", "get_material_events", "get_derivatives_sentiment"],
        rule: "existing tool -> internal provider/capability enrichment",
      },
    });
  }

  if (globalMapReads.has(tool)) {
    return out({
      ok: true,
      status: "LEGACY_GLOBAL_MAP_COMPATIBILITY",
      facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tools: ["get_supply_chain_contract", "query_supply_chain_graph", "query_archived_supply_chain"],
      contract: getSupplyChainContract(),
      note: "舊D1 global-map資料層不復活；供應鏈/產業圖改由現代 deterministic snapshot + evidence graph 承接。",
      persistence: "NONE",
    });
  }

  if (etfReads.has(tool)) {
    return retired(tool, "current read-only market/research plane", "舊Active ETF獨立資料面已退役；保留名稱避免ChatGPT frozen schema出現 unknown tool，但不重啟舊D1/舊來源寫入。");
  }

  if (taifexReads.has(tool)) {
    return retired(tool, "get_txf_review_contract/get_txf_signal/build_stock_txf_context", "舊TAIFEX raw facade已由目前TXF deterministic research plane取代；不以舊來源冒充現代正式資料。");
  }

  return retired(tool, "modern Diamond runtime", "legacy compatibility surface retained without unsafe historical persistence");
}

export function registerDiamondFixedFacadeCompat(server: McpServer, env: Env) {
  for (const tool of DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES) {
    const isRetiredWrite = retiredWrites.has(tool);
    server.registerTool(tool, {
      description: `鑽石引擎固定79-tool facade相容入口：${tool}。保留舊ChatGPT App名稱；底層只走現代唯讀/GitHub canonical能力，禁止復活舊D1/R2 app persistence。`,
      inputSchema: permissiveCompatSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async (input) => {
      if (isRetiredWrite) {
        return retired(tool, "modern deterministic/GitHub-only capability", "此舊名稱原本具有D1/管理型寫入語義；現在永久fail-closed，不允許為相容而恢復舊app persistence。");
      }
      return handleLegacyRead(tool, env, input as CompatInput);
    });
  }
}
