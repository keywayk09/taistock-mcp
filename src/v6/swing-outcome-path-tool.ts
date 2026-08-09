import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runSwingOutcomePath,
  SWING_OUTCOME_ENGINE_VERSION,
  SwingOutcomeError,
} from "./swing-outcome-path";

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
    timeframe: z.literal("1d"),
    source: z.string().optional(),
  }).passthrough(),
}).passthrough();

const barSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().regex(/^\d{4,6}$/),
  open: z.union([z.number(), z.string()]),
  high: z.union([z.number(), z.string()]),
  low: z.union([z.number(), z.string()]),
  close: z.union([z.number(), z.string()]),
  volume: z.union([z.number(), z.string()]),
}).passthrough();

const signalSchema = z.object({
  signal_id: z.string().min(1),
  signal_version: z.string().min(1),
  symbol: z.string().regex(/^\d{4,6}$/),
  side: z.enum(["LONG", "SHORT"]),
  signal_ts_ms: z.number().int().positive(),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strategy: z.string().optional(),
  event: z.string().optional(),
}).passthrough();

const parameterSchema = z.object({
  parameter_schema_version: z.string().optional(),
  max_horizon_days: z.number().int().min(1).max(20).optional().default(5),
  reference_rule: z.literal("NEXT_SESSION_OPEN").optional().default("NEXT_SESSION_OPEN"),
}).optional();

const payloadSchema = z.object({
  dataset: datasetSchema,
  bars: z.array(barSchema).min(2).max(2000),
  signal: signalSchema,
  parameters: parameterSchema,
});

function failure(code: string, message: string, detail?: Record<string, unknown>) {
  return {
    ok: false as const,
    deterministic: true as const,
    engine_version: SWING_OUTCOME_ENGINE_VERSION,
    status: code,
    error: message,
    detail: detail ?? null,
  };
}

export async function executeSwingOutcomePathTool(rawPayload: unknown) {
  const parsed = payloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return failure("INVALID_INPUT_SCHEMA", "Swing Path 輸入不符合固定 Schema", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  try {
    const result = await runSwingOutcomePath(parsed.data);
    return {
      ok: true as const,
      ...result,
      path_policy: "OUTCOME_ONLY_NO_STRATEGY_PROMOTION" as const,
      future_data_policy: "POST_SIGNAL_BARS_USED_ONLY_FOR_OUTCOME_EVALUATION" as const,
    };
  } catch (error) {
    if (error instanceof SwingOutcomeError) return failure(error.code, error.message, error.detail);
    return failure("SWING_OUTCOME_INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
  }
}

export function registerSwingOutcomePathTool(server: McpServer) {
  server.registerTool("run_swing_outcome_path", {
    description: [
      "鑽石引擎 P7 Swing Path：以同一 Signal 建立獨立於 Intraday 的 1D 波段結果路徑。",
      "只做 outcome evaluation，不把未來K流入 Signal 判斷，也不自動升級正式策略。",
      "必須傳入 OHLC MCP research mode 的完整 frozen 1D dataset；引擎會重新驗證 dataset SHA-256。",
      "基準價固定為訊號後下一交易日開盤，輸出 D1..Dn directional close return、累積 MFE/MAE；預設最多5交易日。",
    ].join(" "),
    inputSchema: {
      dataset: datasetSchema,
      bars: z.array(barSchema).min(2).max(2000),
      signal: signalSchema,
      parameters: parameterSchema,
    },
  }, async (payload) => {
    const result = await executeSwingOutcomePathTool(payload);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      ...(result.ok ? {} : { isError: true }),
    };
  });
}
