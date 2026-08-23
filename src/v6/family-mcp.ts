import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { familyResearchDirective } from "./family-research-policy";
import { familySharedReadManifest } from "./family-shared-read-plane";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";

export const FAMILY_MCP_VERSION = "family-mcp/v3.1.0";
export const FAMILY_MCP_TOOL_NAMES = [
  "family_engine_status",
  "screen_family_swing_candidates",
  "get_family_market_chip_summary",
  "analyze_family_stock",
  "compare_family_stocks",
] as const;

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const symbolSchema = z.string().trim().regex(/^\d{4,6}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export class FamilyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "Taiwan Stock AI Family",
    version: "3.1.0",
  });

  async init() {
    this.server.registerTool("family_engine_status", {
      description: "確認Family Shared Read Plane、安全邊界、Evidence身份、即時來源、Open Web研究政策與可用能力。家人與Owner共用市場/研究讀取能力，但Family永遠唯讀。",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => out({
      ok: true,
      service: "Taiwan Stock AI Family MCP",
      version: FAMILY_MCP_VERSION,
      intelligence_model: "SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS",
      access: "READ_ONLY_FAMILY_SURFACE",
      tools: FAMILY_MCP_TOOL_NAMES,
      startup_graph: "LAZY_DEEP_FAMILY_MODULES",
      shared_read_plane: familySharedReadManifest(),
      boundaries: {
        production_writes: false,
        diamond_judgment_writes: false,
        strategy_changes: false,
        github_writes: false,
        owner_private_context_shared_by_default: false,
        evidence_contract: "family-evidence/v1",
        evidence_identity: "EVIDENCE_CLASS_CANNOT_BE_SELF_PROMOTED",
        formal_market_chip: "PUBLISHED_GENERATION_ONLY",
        formal_ohlc: "OHLC_MCP_ONLY",
        finmind_price_is_formal_ohlc: false,
      },
      capability_notes: {
        natural_language_query: "REST_QUERY_ADAPTIVE_INTENT_PLANNER",
        stock_analysis: "INTENT_ADAPTIVE; FULL_ANALYSIS_HAS_FIXED_11_POINT_COMPLETENESS_CONTRACT",
        stock_compare: "COMMON_11_POINT_EVIDENCE_MODEL_ADAPTIVE_RENDERING",
        unified_evidence_bundle: "FAMILY_EVIDENCE_V1_READY",
        evidence_classes: "FORMAL_TRUTH|GOVERNED_CONTEXT|DISPLAY_FALLBACK|WEB_EVIDENCE",
        swing_screening: "V2_FULL_SNAPSHOT_PREFILTER_BOUNDED_DEEP_SCAN",
        realtime: "FUGLE_PRIMARY_WHEN_AVAILABLE_WITH_MARKET_CONTEXT",
        formal_chip_history: "READY",
        holder_distribution_400_1000_lots: "FINMIND_FAIL_SOFT",
        monthly_revenue_summary: "READY_WITH_MOM_YOY",
        accounting_summary: "READY_WITH_MARGIN_EPS_CASHFLOW_RISK_FLAGS",
        official_valuation: "TWSE_TPEX_OPENAPI_FAIL_SOFT",
        canonical_ohlc_bridge: "PENDING_OHLC_MCP_READ_ADAPTER",
        txf_context_bridge: "PENDING_OHLC_MCP_TXF_READ_ADAPTER",
        global_context_bridge: "PENDING_READ_ONLY_ADAPTERS",
        web_research: "OPEN_WORLD_AUTONOMOUS_NO_FIXED_SITE_OR_KEYWORD_LIMIT",
        owner_market_research_reads: "SHARED_BY_DEFAULT_WHEN_AVAILABLE",
        global_supply_chain: "SEARCH_AND_VERIFY_WHEN_RELEVANT; NEVER_GUESS",
      },
      research_policy: familyResearchDirective([]),
    }));

    // Family Swing V2 is registered when the Family Durable Object is actually
    // initialized, not during Worker top-level module evaluation. Tool surface is
    // unchanged; this only isolates the heavy V2 research/schema graph from startup.
    const { registerFamilyStockSelectionToolsV2 } = await import("./family-stock-selection-v2");
    registerFamilyStockSelectionToolsV2(this.server, this.env);

    this.server.registerTool("get_family_market_chip_summary", {
      description: "家人版正式個股籌碼入口。只讀 published generation；不允許 live overlay、不寫入資料、不具交易權限。可查最多180自然日法人、融資融券、借券與借券賣出。",
      inputSchema: {
        symbol: symbolSchema,
        as_of: dateSchema.optional(),
        calendar_days: z.number().int().min(30).max(180).optional().default(60),
        reference_price: z.number().positive().optional(),
        estimated_financing_cost: z.number().positive().optional(),
        financing_ratio: z.number().min(0.1).max(0.9).optional().default(0.6),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input) => out(await getTwMarketChipSummaryPublished(this.env, input)));

    this.server.registerTool("analyze_family_stock", {
      description: "家人版完整單股分析入口。提供Family Unified Evidence V1與1到11點完整證據包，結構化資料與Fugle即時資訊先打底，同時允許GPT自由上網延伸研究；正式籌碼仍以Published generation為準，正式OHLC/技術價位仍由OHLC MCP負責，Evidence等級不得自行升級。",
      inputSchema: {
        symbol: symbolSchema,
        as_of_date: dateSchema.optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ symbol, as_of_date }) => {
      const { runSmartFamilyAnalysis } = await import("./family-analysis");
      const result = await runSmartFamilyAnalysis(this.env, { symbols: [symbol], as_of_date });
      return out({ ...result, requested_tool: "analyze_family_stock" });
    });

    this.server.registerTool("compare_family_stocks", {
      description: "家人版2到5檔股票比較。每檔使用相同Family Unified Evidence與11點證據模型、Open Web自主補證；最終呈現依使用者真正問題調整，不強迫逐檔輸出11個固定段落。",
      inputSchema: {
        symbols: z.array(symbolSchema).min(2).max(5),
        as_of_date: dateSchema.optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ symbols, as_of_date }) => {
      const { runSmartFamilyAnalysis } = await import("./family-analysis");
      const result = await runSmartFamilyAnalysis(this.env, { symbols: [...new Set(symbols)], as_of_date });
      return out({ ...result, requested_tool: "compare_family_stocks" });
    });
  }
}
