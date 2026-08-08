import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BatchBacktestError, runDeterministicBatchBacktest5m, type BatchSignalRecord } from "./batch-backtester";
import { getSignalLedger, LedgerError } from "./signal-event-ledger";

const sourceFileSchema = z.object({
  path: z.string().optional(),
  sha: z.string().optional(),
  trade_date: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
}).passthrough();

const datasetSchema = z.object({
  schema_version: z.literal("ohlc-dataset/v1"),
  dataset_id: z.string().min(1),
  dataset_version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  dataset_hash: z.string().regex(/^[0-9a-f]{64}$/),
  frozen_view: z.literal(true),
  complete_view: z.literal(true),
  truncated: z.literal(false),
  formal_research_eligible: z.literal(true),
  row_count: z.number().int().positive(),
  total_validated_rows: z.number().int().positive(),
  source: z.string().min(1),
  source_files: z.array(sourceFileSchema).optional().default([]),
  provenance: z.object({
    market: z.literal("tw-stock"),
    symbol: z.string().regex(/^\d{4,6}$/),
    timeframe: z.literal("5m"),
    source: z.string().optional(),
  }).passthrough(),
}).passthrough();

const barSchema = z.object({
  symbol: z.string().regex(/^\d{4,6}$/),
  bar_time_tw: z.string().min(1),
  ts_ms: z.union([z.number(), z.string()]),
  open: z.union([z.number(), z.string()]),
  high: z.union([z.number(), z.string()]),
  low: z.union([z.number(), z.string()]),
  close: z.union([z.number(), z.string()]),
  volume: z.union([z.number(), z.string()]),
}).passthrough();

const parameterSchema = z.object({
  parameter_schema_version: z.string().optional(),
  entry_rule: z.literal("NEXT_BAR_OPEN").optional(),
  stop_atr: z.number().positive().optional(),
  target_atr: z.number().positive().optional(),
  max_bars: z.number().int().min(1).max(200).optional(),
  cost_rate_round_trip: z.number().min(0).max(0.1).optional(),
  tie_break: z.literal("STOP_FIRST").optional(),
  end_of_day_exit: z.literal(true).optional(),
}).optional();

function failure(error: unknown) {
  if (error instanceof BatchBacktestError || error instanceof LedgerError) {
    return { ok: false as const, deterministic: true as const, status: error.code, error: error.message, detail: error.detail ?? null };
  }
  return { ok: false as const, deterministic: true as const, status: "BATCH_BACKTEST_INTERNAL_ERROR", error: error instanceof Error ? error.message : String(error) };
}

function toBatchSignal(row: Record<string, unknown>): BatchSignalRecord {
  return {
    signal_id: String(row.signal_id ?? ""),
    signal_version: String(row.signal_version ?? ""),
    symbol: String(row.symbol ?? ""),
    trade_date: String(row.trade_date ?? ""),
    timeframe: String(row.timeframe ?? ""),
    side: String(row.side ?? ""),
    signal_ts_ms: Number(row.signal_ts_ms),
    atr: row.atr === undefined || row.atr === null ? null : Number(row.atr),
    strategy: String(row.strategy ?? ""),
    stage: row.stage ? String(row.stage) : undefined,
    event_refs: Array.isArray(row.event_refs) ? row.event_refs : [],
  };
}

export function registerBatchBacktestTool(server: McpServer, env: Env) {
  server.registerTool("run_signal_ledger_batch_backtest_5m", {
    description: [
      "P5 5m 大樣本正式統計工具。",
      "Signal 只能從 P4 immutable Signal Ledger 依 signal_id/version 讀取；evaluation datasets 必須是 OHLC MCP P2 complete frozen research datasets。",
      "工具不抓 Fugle、不寫 OHLC、不修改 Signal；任何 case 缺資料/不符合 contract 都整批 fail closed，避免因靜默 skip 造成 selection bias。",
      "回傳 deterministic batch_run_id、逐筆 P3 結果、PF/勝率/expectancy/MFE/MAE/ambiguous rate 與 P6 selective replay queue。",
    ].join(" "),
    inputSchema: {
      datasets: z.array(z.object({
        dataset: datasetSchema,
        bars: z.array(barSchema).min(1).max(2000),
      })).min(1).max(50),
      cases: z.array(z.object({
        signal_id: z.string().min(1).max(240),
        signal_version: z.string().min(1).max(160),
        evaluation_dataset_version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })).min(1).max(500),
      parameters: parameterSchema,
    },
  }, async ({ datasets, cases, parameters }) => {
    try {
      const resolvedCases = [];
      for (const item of cases) {
        const row = await getSignalLedger(env, item.signal_id, item.signal_version);
        if (!row) throw new BatchBacktestError("SIGNAL_NOT_FOUND", "P5 case references a Signal Ledger entry that does not exist", { signal_id: item.signal_id, signal_version: item.signal_version });
        resolvedCases.push({ signal: toBatchSignal(row), evaluation_dataset_version: item.evaluation_dataset_version });
      }
      const result = await runDeterministicBatchBacktest5m({ datasets, cases: resolvedCases, parameters });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const result = failure(error);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: true };
    }
  });
}
