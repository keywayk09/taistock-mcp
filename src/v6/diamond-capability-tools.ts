import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDiamondResearchLabP11 } from "./diamond-capability-p11";
import { getDiamondStrategyLabP12 } from "./diamond-capability-p12";
import {
  getDiamondArchitectureStatusP13,
  getDiamondToolRegistryP13,
} from "./diamond-capability-p13";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerDiamondCapabilityTools(server: McpServer) {
  server.registerTool("get_diamond_tool_registry", {
    description: "鑽石引擎正式工具列：列出 Market Data、Research Data、Workflow 能力與接入狀態。P13 已加入跨市場 Supply Chain Research Data surface；海外 OHLC 仍只透過 OHLC MCP。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondToolRegistryP13()));

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
    description: "鑽石引擎整體狀態：Production Data Plane / Trading Research Plane / Engineering Control Plane、P11 驗證、P12 Strategy Lab，以及 P13 台股+海外跨市場 Supply Chain Graph 的 Evidence/Time-safe 邊界。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondArchitectureStatusP13()));
}
