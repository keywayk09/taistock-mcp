import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDiamondToolRegistry } from "./diamond-capability-registry";
import { getDiamondResearchLabP11 } from "./diamond-capability-p11";
import {
  getDiamondArchitectureStatusP12,
  getDiamondStrategyLabP12,
} from "./diamond-capability-p12";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerDiamondCapabilityTools(server: McpServer) {
  server.registerTool("get_diamond_tool_registry", {
    description: "鑽石引擎正式工具列：列出 Market Data、Research Data、Workflow 能力與接入狀態。海外 OHLC 只透過 OHLC MCP；未完成驗證的能力會明確標示狀態。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondToolRegistry()));

  server.registerTool("get_diamond_research_lab", {
    description: "鑽石引擎 Research & Validation Lab：列出 P3-P11 研究能力，包括 deterministic Walk-Forward、Bootstrap、Monte Carlo；未實作的方法仍維持 Candidate。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondResearchLabP11()));

  server.registerTool("get_diamond_strategy_lab", {
    description: "P12 鑽石引擎 Strategy Lab：15 個 daily_stock_analysis 外部策略已鎖定 immutable source blob / MIT license 並進入治理流程；全部仍是 Research Candidate，未形式化、未台股驗證、Production disabled。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondStrategyLabP12()));

  server.registerTool("get_diamond_architecture_status", {
    description: "鑽石引擎整體狀態：Production Data Plane / Trading Research Plane / Engineering Control Plane、P11 驗證能力、P12 Strategy Lab 治理與硬性安全邊界。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondArchitectureStatusP12()));
}
