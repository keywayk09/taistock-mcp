import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { runSmartFamilyAnalysis } from "./family-analysis";
import { familyResearchDirective } from "./family-research-policy";
import { registerFamilyStockSelectionToolsV2 } from "./family-stock-selection-v2";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";

export const FAMILY_MCP_VERSION = "family-mcp/v2.1.0";
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
    version: "2.1.0",
  });

  async init() {
    this.server.registerTool("family_engine_status", {
      description: "確認家人版台股引擎的安全邊界、即時來源、Open Web研究政策與可用能力。唯讀，不修改策略、GitHub、Diamond 記憶或 Production。",
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
        stock_analysis: "FIXED_11_POINT_PLUS_OPEN_WORLD_RESEARCH",
        stock_compare: "FIXED_11_POINT_NORMALIZED_PLUS_OPEN_WORLD_RESEARCH",
        swing_screening: "V2_FULL_SNAPSHOT_PREFILTER_BOUNDED_DEEP_SCAN",
        realtime: "FUGLE_PRIMARY_WHEN_AVAILABLE_WITH_MARKET_CONTEXT",
        formal_chip_history: "READY",
        holder_distribution_400_1000_lots: "FINMIND_FAIL_SOFT",
        monthly_revenue_summary: "READY_WITH_MOM_YOY",
        accounting_summary: "READY_WITH_MARGIN_EPS_CASHFLOW_RISK_FLAGS",
        official_valuation: "TWSE_TPEX_OPENAPI_FAIL_SOFT",
        web_research: "OPEN_WORLD_AUTONOMOUS_NO_FIXED_SITE_OR_KEYWORD_LIMIT",
        global_supply_chain: "SEARCH_AND_VERIFY_WHEN_RELEVANT; NEVER_GUESS",
      },
      research_policy: familyResearchDirective([]),
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
      description: "家人版單股完整分析入口。固定回傳1到11點，結構化資料與Fugle即時資訊先打底，同時允許GPT自由上網延伸研究公司、產業、產能、客戶、供應鏈、同業、海外消息、政策、法說、催化劑與機構觀點；不限制固定網站或關鍵字。正式籌碼仍以Published generation為準，正式OHLC/技術價位仍由OHLC MCP負責。",
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
      description: "家人版2到5檔股票比較。每檔使用相同固定11點資料契約，並允許Open Web自主補證；適合接在波段選股V2或Web發現候選後面，交叉驗證基本面、即時、正式籌碼、估值與事件，再做研究排序。",
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
