import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerBatchBacktestTool } from "./batch-backtest-tool";
import { registerDeterministicBacktestTool } from "./deterministic-backtest-tool";
import { registerDiamondCapabilityTools } from "./diamond-capability-tools";
import { registerExperimentLedgerTools } from "./experiment-ledger-tools";
import { registerGptJudgmentMemoryTools } from "./gpt-judgment-memory-tools";
import { getResearchStatus, getStoredCandles } from "./research-pipeline";
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
  server.registerTool("get_research_pipeline_status", {
    description: "查詢 Diamond 舊研究資料狀態。舊直抓行情流程已停用，正式 OHLC 一律走 OHLC MCP。",
    inputSchema: {},
  }, async () => ok(await getResearchStatus(env)));

  server.registerTool("get_research_universe", {
    description: "查詢指定交易日既有研究候選池；此工具只讀 D1 歷史資料。",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      limit: z.number().int().min(1).max(100).optional().default(40),
    },
  }, async ({ date, limit }) => {
    const result = await env.RESEARCH_DB.prepare(`
      SELECT trade_date, symbol, market, name, close, change_percent, trade_volume,
             trade_value, range_percent, selected_rank, selected_reasons_json, updated_at
      FROM research_universe WHERE trade_date=? ORDER BY selected_rank LIMIT ?
    `).bind(date, limit).all();
    return ok({ date, count: result.results.length, data: result.results, storage:"D1_ONLY", policy:"LEGACY_DATA_ONLY" });
  });

  server.registerTool("get_stored_intraday_candles", {
    description: "讀取 D1 中既有的舊研究 candle payload/品質統計；僅供歷史相容查閱，正式台股/TXF OHLC 必須透過 OHLC MCP。",
    inputSchema: {
      symbol: z.string().trim().regex(/^\d{4,6}$/),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeframe: z.enum(["1m", "5m"]).optional().default("5m"),
    },
  }, async ({ symbol, date, timeframe }) => ok(await getStoredCandles(env, date, symbol, timeframe)));

  registerDeterministicBacktestTool(server);
  registerBatchBacktestTool(server, env);
  registerSelective1mReplayTool(server);
  registerSwingOutcomePathTool(server);
  registerResearchValidationTools(server);
  registerSignalEventLedgerTools(server, env);
  registerExperimentLedgerTools(server, env);
  registerTxfReviewTools(server, env);
  registerReviewOrchestratorTools(server, env);
  registerGptJudgmentMemoryTools(server, env);
  registerStrategyLabTools(server);
  registerSupplyChainTools(server);
  registerSupplyChainDataPlaneTools(server, env);
  registerDiamondCapabilityTools(server);
}
