import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DeterministicBacktestResult, FrozenDatasetManifest } from "./deterministic-backtester";
import { resolveAmbiguousBacktestWith1m, SelectiveReplayError } from "./selective-1m-replay";

const originalSchema = z.object({
  status: z.literal("OK"), deterministic: z.literal(true), backtest_run_id: z.string().min(1),
  engine_version: z.string().min(1), dataset_id: z.string().min(1), dataset_version: z.string().min(1), dataset_hash: z.string().min(1),
  signal_id: z.string().min(1), signal_version: z.string().min(1), parameter_version: z.string().min(1), symbol: z.string().regex(/^\d{4,6}$/),
  side: z.enum(["LONG","SHORT"]), entry_price: z.number().positive(), stop_price: z.number().positive(), target_price: z.number().positive(),
  exit_ts_ms: z.number().positive(), entry_bar_time_tw: z.string(), exit_bar_time_tw: z.string(), exit_reason: z.literal("STOP"), exit_price: z.number().positive(),
  cost_pct: z.number().min(0), net_return_pct: z.number(), ambiguous_intrabar: z.literal(true), intrabar_status: z.literal("AMBIGUOUS_INTRABAR"),
  conservative_resolution: z.literal("STOP_FIRST"), requires_1m_replay: z.literal(true),
}).passthrough();

const datasetSchema = z.object({
  schema_version:z.literal("ohlc-dataset/v1"), dataset_id:z.string().min(1), dataset_version:z.string().regex(/^sha256:[0-9a-f]{64}$/), dataset_hash:z.string().regex(/^[0-9a-f]{64}$/),
  frozen_view:z.literal(true), complete_view:z.literal(true), truncated:z.literal(false), formal_research_eligible:z.literal(true), row_count:z.number().int().positive(), total_validated_rows:z.number().int().positive(), source:z.string().min(1),
  source_files:z.array(z.object({path:z.string().optional(),sha:z.string().optional(),trade_date:z.string().nullable().optional(),year:z.number().nullable().optional()}).passthrough()).optional(),
  provenance:z.object({market:z.literal("tw-stock"),symbol:z.string().regex(/^\d{4,6}$/),timeframe:z.literal("1m"),source:z.string().optional()}).passthrough(),
}).passthrough();

const barSchema = z.object({symbol:z.string().regex(/^\d{4,6}$/),bar_time_tw:z.string().min(1),ts_ms:z.union([z.number(),z.string()]),open:z.union([z.number(),z.string()]),high:z.union([z.number(),z.string()]),low:z.union([z.number(),z.string()]),close:z.union([z.number(),z.string()]),volume:z.union([z.number(),z.string()]),trade_date:z.string().optional()}).passthrough();

export function registerSelective1mReplayTool(server: McpServer) {
  server.registerTool("resolve_ambiguous_backtest_with_1m", {
    description:"P6 Selective Replay：只接受 P3/P5 已標記 AMBIGUOUS_INTRABAR + requires_1m_replay 的 5m 結果，以及 OHLC MCP P2 完整 frozen 1m dataset。依 1m 時序解析 Stop/Target 先後，絕不覆蓋原 5m conservative 結果。若同一 1m 仍雙碰則保留 STOP_FIRST 並標 still_ambiguous_at_1m。",
    inputSchema:{original_5m_result:originalSchema,dataset_1m:datasetSchema,bars_1m:z.array(barSchema).min(1).max(1000)},
  }, async ({original_5m_result,dataset_1m,bars_1m}) => {
    try {
      const result=await resolveAmbiguousBacktestWith1m({original_5m_result:original_5m_result as unknown as DeterministicBacktestResult,dataset_1m:dataset_1m as unknown as FrozenDatasetManifest,bars_1m});
      return {content:[{type:"text" as const,text:JSON.stringify(result,null,2)}]};
    } catch(error) {
      const payload=error instanceof SelectiveReplayError?{ok:false,status:error.code,error:error.message,detail:error.detail??null}:{ok:false,status:"REPLAY_INTERNAL_ERROR",error:error instanceof Error?error.message:String(error)};
      return {content:[{type:"text" as const,text:JSON.stringify(payload,null,2)}],isError:true};
    }
  });
}
