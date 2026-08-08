import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerDeterministicBacktestTool } from "./deterministic-backtest-tool";
import { getResearchStatus, getStoredCandles } from "./research-pipeline";

const ok = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerResearchTools(server: McpServer, env: Env) {
  server.registerTool("get_research_pipeline_status", {
    description: "查詢 Cloudflare TRAI 盤後資料管線狀態、綁定與最近一次執行結果。",
    inputSchema: {},
  }, async () => ok(await getResearchStatus(env)));

  server.registerTool("get_research_universe", {
    description: "查詢指定交易日由成交值、波動與漲跌幅篩出的研究候選池。",
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
    return ok({ date, count: result.results.length, data: result.results });
  });

  server.registerTool("get_stored_intraday_candles", {
    description: "從 Cloudflare D1 索引與 R2 讀取已保存的富果1分K或5分K及資料品質統計。",
    inputSchema: {
      symbol: z.string().trim().regex(/^\d{4,6}$/),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeframe: z.enum(["1m", "5m"]).optional().default("5m"),
    },
  }, async ({ symbol, date, timeframe }) => ok(await getStoredCandles(env, date, symbol, timeframe)));

  registerDeterministicBacktestTool(server);
}
