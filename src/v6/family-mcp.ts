import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { runSmartFamilyAnalysis } from "./family-analysis";
import { registerFamilyStockSelectionToolsV2 } from "./family-stock-selection-v2";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";

export const FAMILY_MCP_VERSION = "family-mcp/v2.0.0";
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
    version: "2.0.0",
  });

  async init() {
    this.server.registerTool("family_engine_status", {
      description: "確認家人版台股引擎的安全邊界、資料來源與可用能力。唯讀，不修改策略、GitHub、Diamond 記憶或 Production。",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => out({
      ok: true,
      service: "Taiwan Stock AI Family MCP",
      version: FAMILY_MCP_VERSION,
      access: "READ_ONLY_FAMILY_SURFACE",
      tools: FAMILY_MCP_TOOL_NAMES,
      boundaries: {
        production_writes: false,
        diamond_judgment_writes: false,
        strategy_changes: false,
        github_writes: false,
        formal_market_chip: "PUBLISHED_GENERATION_ONLY",
        formal_ohlc: "OHLC_MCP_ONLY",
        finmind_price_is_formal_ohlc: false,
      },
      capability_notes: {
        stock_analysis: "FIXED_11_POINT_WITH_WEB_RESEARCH_PLAN",
        stock_compare: "FIXED_11_POINT_NORMALIZED",
        swing_screening: "V2_FULL_SNAPSHOT_PREFILTER_BOUNDED_DEEP_SCAN",
        formal_chip_history: "READY",
        holder_distribution_400_1000_lots: "FINMIND_FAIL_SOFT",
        monthly_revenue_summary: "READY_WITH_MOM_YOY",
        accounting_summary: "READY_WITH_MARGIN_EPS_CASHFLOW_RISK_FLAGS",
        official_valuation: "TWSE_TPEX_OPENAPI_FAIL_SOFT",
        web_research: "ALLOWED_AND_EXPECTED_FOR_QUALITATIVE_FORWARD_LOOKING_POINTS",
        global_supply_chain: "ONLY_WHEN_VERIFIED_DATASET_OR_WEB_EVIDENCE_IS_AVAILABLE; NEVER_GUESS",
      },
    }));

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
      description: "家人版單股完整分析入口。固定回傳1到11點：公司/產業/財務/成長/全球產能與地緣政治/客戶訂單/催化與風險/400與1000張大戶+正式籌碼/同業/估值目標價/技術操作。結構化資料先由引擎取得；需要公司法說、產能、客戶、題材與機構目標價的點會回傳Web research plan，允許再上網補證。正式OHLC仍由OHLC MCP負責。",
      inputSchema: {
        symbol: symbolSchema,
        as_of_date: dateSchema.optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ symbol, as_of_date }) => {
      const result = await runSmartFamilyAnalysis(this.env, { symbols: [symbol], as_of_date });
      return out({ ...result, requested_tool: "analyze_family_stock" });
    });

    this.server.registerTool("compare_family_stocks", {
      description: "家人版2到5檔股票比較。每一檔都使用相同固定11點資料契約；適合接在波段選股V2後面，補正式籌碼、財務、估值與Web研究缺口，再做最後研究排序。",
      inputSchema: {
        symbols: z.array(symbolSchema).min(2).max(5),
        as_of_date: dateSchema.optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ symbols, as_of_date }) => {
      const result = await runSmartFamilyAnalysis(this.env, { symbols: [...new Set(symbols)], as_of_date });
      return out({ ...result, requested_tool: "compare_family_stocks" });
    });
  }
}
