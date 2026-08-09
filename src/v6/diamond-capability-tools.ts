import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDiamondStrategyLabP12 } from "./diamond-capability-p12";
import {
  getDiamondArchitectureStatusP14,
  getDiamondResearchLabP14,
  getDiamondToolRegistryP14,
} from "./diamond-capability-p14";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerDiamondCapabilityTools(server: McpServer) {
  server.registerTool("get_diamond_tool_registry", {
    description: "鑽石引擎正式工具列：P14 已加入台指期 TXF OHLC surface，TXF/台股 OHLC 都只透過 OHLC MCP；供應鏈 Research Data 維持獨立治理。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondToolRegistryP14()));

  server.registerTool("get_diamond_research_lab", {
    description: "鑽石引擎 Research & Validation Lab：包含台股 P3-P11、TXF Signal/5m Review/Selective 1m Replay，以及 TW Stock × TXF no-lookahead Context。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondResearchLabP14()));

  server.registerTool("get_diamond_strategy_lab", {
    description: "P12 鑽石引擎 Strategy Lab：15 個 daily_stock_analysis 外部策略已鎖定 immutable source blob / MIT license 並進入治理流程；全部仍是 Research Candidate，未形式化、未台股驗證、Production disabled。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondStrategyLabP12()));

  server.registerTool("get_diamond_architecture_status", {
    description: "鑽石引擎整體狀態：Production Data Plane / Trading Research Plane / Engineering Control Plane、Supply Chain，以及 P14 台股+TXF 雙市場復盤與資料/成本/驗證邊界。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondArchitectureStatusP14()));
}
