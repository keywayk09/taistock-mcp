import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { runSmartFamilyAnalysis } from "./family-analysis";
import { registerFamilyStockSelectionTools } from "./family-stock-selection";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";

export const FAMILY_MCP_VERSION = "family-mcp/v1.1.0";
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
    version: "1.1.0",
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
        stock_analysis: "READY_NORMALIZED",
        stock_compare: "READY_NORMALIZED",
        swing_screening: "READY",
        formal_chip_history: "READY",
        monthly_revenue_summary: "READY_WITH_MOM_YOY",
        accounting_summary: "READY_WITH_MARGIN_EPS_CASHFLOW_RISK_FLAGS",
        official_valuation: "TWSE_TPEX_OPENAPI_FAIL_SOFT",
        global_supply_chain: "ONLY_WHEN_VERIFIED_DATASET_IS_AVAILABLE; NEVER_GUESS",
      },
    }));

    registerFamilyStockSelectionTools(this.server, this.env);

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
      description: "家人版單股綜合資料入口。整合顯示用即時行情、技術摘要、月營收MoM/YoY、財報毛利/營益/EPS/現金流風險摘要、TWSE/TPEx官方估值與正式published籌碼；資料不足明示null，不自行補值。正式OHLC仍由OHLC MCP負責。",
      inputSchema: {
        symbol: symbolSchema,
        as_of_date: dateSchema.optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ symbol, as_of_date }) => {
      const result = await runSmartFamilyAnalysis(this.env, {
        symbols: [symbol],
        as_of_date,
      });
      return out({
        ...result,
        requested_tool: "analyze_family_stock",
      });
    });

    this.server.registerTool("compare_family_stocks", {
      description: "家人版2到5檔股票比較。逐檔使用相同唯讀標準化資料：技術、月營收、財報摘要、官方估值與正式published籌碼；缺資料不猜測。",
      inputSchema: {
        symbols: z.array(symbolSchema).min(2).max(5),
        as_of_date: dateSchema.optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ symbols, as_of_date }) => {
      const result = await runSmartFamilyAnalysis(this.env, {
        symbols: [...new Set(symbols)],
        as_of_date,
      });
      return out({
        ...result,
        requested_tool: "compare_family_stocks",
      });
    });
  }
}
