import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerBatchBacktestTool } from "./batch-backtest-tool";
import { registerDeterministicBacktestTool } from "./deterministic-backtest-tool";
import { registerDiamondCapabilityTools } from "./diamond-capability-tools";
import { registerExperimentLedgerTools } from "./experiment-ledger-tools";
import { registerFormalBlindOhlcReaderTool } from "./formal-blind-ohlc-reader";
import { registerGptJudgmentMemoryTools } from "./gpt-judgment-memory-tools";
import { registerResearchBlindOhlcFallbackTool } from "./research-blind-ohlc-fallback";
import { getResearchStatus, getStoredCandles } from "./research-pipeline";
import { createResearchVNextCompatRegistrationServer } from "./research-vnext/compat-cutover";
import { registerResearchValidationTools } from "./research-validation-tools";
import { registerReviewOrchestratorTools } from "./review-orchestrator-tools";
import { registerSelective1mReplayTool } from "./selective-1m-replay-tool";
import { registerSignalEventLedgerTools } from "./signal-event-ledger-tools";
import { registerStrategyLabTools } from "./strategy-lab-tools";
import { registerSupplyChainDataPlaneTools } from "./supply-chain-data-plane-tools";
import { registerSupplyChainTools } from "./supply-chain-tools";
import { registerSwingOutcomePathTool } from "./swing-outcome-path-tool";
import { registerTxfReviewTools } from "./txf-review-tools";

const ok = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerResearchTools(server: McpServer, env: Env) {
  const compatServer = createResearchVNextCompatRegistrationServer(server);

  server.registerTool("get_research_pipeline_status", {
    description: "查詢 Diamond 舊研究資料狀態。舊直抓行情流程已停用，正式 OHLC 一律走 OHLC MCP。",
    inputSchema: {},
  }, async () => ok(await getResearchStatus(env)));

  server.registerTool("get_research_universe", {
    description: "舊 research_universe D1 路徑已退休。正式研究候選池由目前研究流程重建；Diamond 長期資料僅保存於 GitHub。",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      limit: z.number().int().min(1).max(100).optional().default(40),
    },
  }, async ({ date, limit }) => ok({
    date,
    requested_limit: limit,
    count: 0,
    data: [],
    status: "LEGACY_RESEARCH_UNIVERSE_RETIRED",
    storage: "GITHUB_ONLY",
    policy: "OHLC_MCP_ONLY",
  }));

  server.registerTool("get_stored_intraday_candles", {
    description: "舊研究 candle persistence 已退休；此工具只回報 retired 狀態，正式台股/TXF OHLC 必須透過 OHLC MCP。",
    inputSchema: {
      symbol: z.string().trim().regex(/^\d{4,6}$/),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeframe: z.enum(["1m", "5m"]).optional().default("5m"),
    },
  }, async ({ symbol, date, timeframe }) => ok(await getStoredCandles(env, date, symbol, timeframe)));

  registerResearchBlindOhlcFallbackTool(server, env);
  registerFormalBlindOhlcReaderTool(server, env);
  registerDeterministicBacktestTool(server);
  registerBatchBacktestTool(server, env);
  registerSelective1mReplayTool(compatServer);
  registerSwingOutcomePathTool(server);
  registerResearchValidationTools(server);
  registerSignalEventLedgerTools(server, env);
  registerExperimentLedgerTools(server, env);
  registerTxfReviewTools(server, env);
  registerReviewOrchestratorTools(compatServer, env);
  registerGptJudgmentMemoryTools(server, env);
  registerStrategyLabTools(server);
  registerSupplyChainTools(server);
  registerSupplyChainDataPlaneTools(server, env);
  registerDiamondCapabilityTools(server);
}
