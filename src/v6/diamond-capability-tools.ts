import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDiamondStrategyLabP12 } from "./diamond-capability-p12";
import {
  getDiamondArchitectureStatusP15,
  getDiamondResearchLabP15,
  getDiamondToolRegistryP15,
} from "./diamond-capability-p15";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerDiamondCapabilityTools(server: McpServer) {
  server.registerTool("get_diamond_tool_registry", {
    description: "鑽石引擎正式工具列：P15 已加入台股/TXF Daily Review 與 Swing Selector orchestration；所有 OHLC 仍只透過 OHLC MCP。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondToolRegistryP15()));

  server.registerTool("get_diamond_research_lab", {
    description: "鑽石引擎 Research & Validation Lab：包含台股 P3-P11、TXF 雙市場復盤，以及 P15 Daily Review / Swing Selection+Outcome 閉環。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondResearchLabP15()));

  server.registerTool("get_diamond_strategy_lab", {
    description: "P12 鑽石引擎 Strategy Lab：15 個 daily_stock_analysis 外部策略已鎖定 immutable source blob / MIT license 並進入治理流程；全部仍是 Research Candidate，未形式化、未台股驗證、Production disabled。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondStrategyLabP12()));

  server.registerTool("get_diamond_architecture_status", {
    description: "鑽石引擎整體狀態：Production Data Plane / Trading Research Plane / Engineering Control Plane、Supply Chain、台股+TXF 雙市場復盤，以及 P15 復盤/波段 orchestration 安全邊界。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getDiamondArchitectureStatusP15()));
}
