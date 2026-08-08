import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  BacktestInputError,
  DEFAULT_INTRADAY_5M_PARAMETERS,
  DETERMINISTIC_BACKTEST_ENGINE_VERSION,
  runDeterministicIntraday5mBacktest,
} from "./deterministic-backtester";

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

const signalSchema = z.object({
  signal_id: z.string().min(1),
  signal_version: z.string().min(1),
  symbol: z.string().regex(/^\d{4,6}$/),
  side: z.enum(["LONG", "SHORT"]),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  signal_ts_ms: z.number().positive(),
  atr: z.number().positive(),
  strategy: z.string().optional(),
  event: z.string().optional(),
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

const payloadSchema = z.object({
  dataset: datasetSchema,
  bars: z.array(barSchema).min(1).max(2000),
  signal: signalSchema,
  parameters: parameterSchema,
});

export type DeterministicBacktestToolPayload = z.infer<typeof payloadSchema>;

function barTradeDate(barTime: string): string {
  const raw = String(barTime ?? "");
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const match = raw.match(/\b[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/);
  if (!match) return "";
  const months: Record<string, string> = {
    Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06",
    Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12",
  };
  return `${match[3]}-${months[match[1]] ?? "00"}-${String(match[2]).padStart(2, "0")}`;
}

function failure(code: string, message: string, detail?: Record<string, unknown>) {
  return {
    ok: false as const,
    deterministic: true as const,
    engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    status: code,
    error: message,
    detail: detail ?? null,
  };
}

export async function executeDeterministicBacktestTool(rawPayload: unknown) {
  const parsed = payloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return failure("INVALID_INPUT_SCHEMA", "回測輸入不符合固定 Schema", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }

  const { dataset, bars, signal, parameters } = parsed.data;
  const firstAfterSignal = bars.find((bar) => Number(bar.ts_ms) > signal.signal_ts_ms);
  if (!firstAfterSignal) return failure("NO_NEXT_BAR", "訊號後沒有下一根 5m bar");
  const entryDate = barTradeDate(firstAfterSignal.bar_time_tw);
  if (entryDate !== signal.trade_date) {
    return failure("NO_NEXT_BAR_SAME_DAY", "台股當沖禁止跨日；訊號後第一根可用 bar 不在同一交易日", {
      signal_trade_date: signal.trade_date,
      next_bar_trade_date: entryDate || null,
    });
  }

  try {
    const result = await runDeterministicIntraday5mBacktest({
      dataset,
      bars,
      signal,
      parameters,
    });
    return {
      ok: true as const,
      ...result,
      signal_trade_date: signal.trade_date,
      mfe_mae_basis: "5M_BAR_ENVELOPE" as const,
      replay_policy: result.requires_1m_replay ? "P6_SELECTIVE_1M_REPLAY_REQUIRED" as const : "NO_AUTOMATIC_1M_REPLAY" as const,
    };
  } catch (error) {
    if (error instanceof BacktestInputError) return failure(error.code, error.message, error.detail);
    return failure("BACKTEST_INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
  }
}

export function registerDeterministicBacktestTool(server: McpServer) {
  server.registerTool("run_deterministic_intraday_backtest_5m", {
    description: [
      "鑽石引擎 Research & Validation Lab 的純計算 5 分 K 回測器。",
      "不抓行情、不寫 OHLC、不讀現在時間；必須傳入 OHLC MCP read_ohlc(mode=research) 回傳的完整 frozen dataset + exact bars。",
      "預設正式基準：訊號後下一根 5m open 進場、Stop=1 ATR、Target=1.5 ATR、最多12根或EOD、round-trip成本0.04%、同根碰Stop/Target採STOP優先。",
      "同根雙碰會保留5m conservative STOP結果並標 requires_1m_replay=true；1m解析屬P6，不在本工具偷跑。",
    ].join(" "),
    inputSchema: {
      dataset: datasetSchema,
      bars: z.array(barSchema).min(1).max(2000),
      signal: signalSchema,
      parameters: parameterSchema,
    },
  }, async (payload) => {
    const result = await executeDeterministicBacktestTool(payload);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      ...(result.ok ? {} : { isError: true }),
    };
  });
}

export const DETERMINISTIC_BACKTEST_DEFAULTS = DEFAULT_INTRADAY_5M_PARAMETERS;
