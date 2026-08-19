import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDiamondStrategyLabP12 } from "./diamond-capability-p12";
import {
  getDiamondArchitectureStatusP18,
  getDiamondResearchLabP18,
  getDiamondToolRegistryP18,
} from "./diamond-capability-p18";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerDiamondCapabilityTools(server: McpServer) {
  server.registerTool("get_diamond_tool_registry", {
    description: "鑽石引擎正式工具列：P18 納入官方優先台股法人/融資融券 Market Data Plane；OHLC/K線與 Outcome 仍只透過 OHLC MCP。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondToolRegistryP18()));

  server.registerTool("get_diamond_research_lab", {
    description: "鑽石引擎 Research & Validation Lab：包含台股/TXF 回測復盤、Swing 閉環，以及 GPT 認知、型態與趨勢線長期統計記憶。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondResearchLabP18()));

  server.registerTool("get_diamond_strategy_lab", {
    description: "P12 鑽石引擎 Strategy Lab：15 個 daily_stock_analysis 外部策略已鎖定 immutable source blob / MIT license 並進入治理流程；全部仍是 Research Candidate，未形式化、未台股驗證、Production disabled。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondStrategyLabP12()));

  server.registerTool("get_diamond_architecture_status", {
    description: "鑽石引擎整體狀態：P18 官方法人/融資融券 Market Data、台股+TXF 復盤、Swing orchestration、Supply Chain 與 GPT Judgment→Outcome→Review→Knowledge 閉環。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondArchitectureStatusP18()));
}
