import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getDiamondArchitectureStatus,
  getDiamondResearchLab,
  getDiamondStrategyLab,
  getDiamondToolRegistry,
} from "./diamond-capability-registry";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerDiamondCapabilityTools(server: McpServer) {
  server.registerTool("get_diamond_tool_registry", {
    description: "鑽石引擎正式工具列：列出 Market Data、Research Data、Workflow 能力與接入狀態。海外 OHLC 僅作 Diamond product surface，底層仍強制走 OHLC MCP；未啟用的外部能力會明確標示 Candidate。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondToolRegistry()));

  server.registerTool("get_diamond_research_lab", {
    description: "鑽石引擎 Research & Validation Lab：列出已啟用的 P3-P8 研究能力，以及 Vibe-Trading 方法論的候選能力；候選不冒充已實作。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondResearchLab()));

  server.registerTool("get_diamond_strategy_lab", {
    description: "鑽石引擎 Strategy Lab：列出 daily_stock_analysis 15 個外部 Strategy Skill 候選及正式驗證管線。全部預設未通過台股驗證且 Production disabled。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondStrategyLab()));

  server.registerTool("get_diamond_architecture_status", {
    description: "鑽石引擎整體整合狀態：Production Data Plane / Trading Research Plane / Engineering Control Plane、外部專案接入位置與硬性安全邊界。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondArchitectureStatus()));
}
