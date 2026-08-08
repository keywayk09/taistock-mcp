import {
  BacktestInputError,
  DETERMINISTIC_BACKTEST_ENGINE_VERSION,
  runDeterministicIntraday5mBacktest,
  type FrozenDatasetManifest,
  type Intraday5mBar,
  type Intraday5mParameters,
  type DeterministicBacktestResult,
} from "./deterministic-backtester";

export const BATCH_BACKTEST_SCHEMA_VERSION = "diamond-batch-backtest/v1";

export type BatchSignalRecord = {
  signal_id: string;
  signal_version: string;
  symbol: string;
  trade_date: string;
  timeframe: string;
  side: string;
  signal_ts_ms: number | string;
  atr: number | string | null;
  strategy: string;
  stage?: string;
  event_refs?: unknown[];
};

export type EvaluationDatasetBundle = {
  dataset: FrozenDatasetManifest;
  bars: Intraday5mBar[];
};

export type BatchBacktestCase = {
  signal: BatchSignalRecord;
  evaluation_dataset_version: string;
};

export type BatchBacktestInput = {
  datasets: EvaluationDatasetBundle[];
  cases: BatchBacktestCase[];
  parameters?: Intraday5mParameters;
};

export class BatchBacktestError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "BatchBacktestError";
    this.code = code;
    this.detail = detail;
  }
}

function finite(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new BatchBacktestError("INVALID_CASE", `${field} must be finite`);
  return number;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableValue(source[key]);
    return out;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stableValue(JSON.parse(value)))));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function tradeDateOf(barTime: unknown): string {
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

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function aggregate(results: DeterministicBacktestResult[]) {
  const net = results.map((result) => result.net_return_pct);
  const gains = net.filter((value) => value > 0);
  const losses = net.filter((value) => value < 0);
  const sumGain = gains.reduce((sum, value) => sum + value, 0);
  const sumLossAbs = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const total = results.length;
  const exitReasons: Record<string, number> = {};
  const strategies: Record<string, { total: number; net_sum_pct: number; wins: number; losses: number }> = {};
  for (const result of results) {
    exitReasons[result.exit_reason] = (exitReasons[result.exit_reason] ?? 0) + 1;
    const key = result.strategy ?? "UNSPECIFIED";
    const row = strategies[key] ?? { total: 0, net_sum_pct: 0, wins: 0, losses: 0 };
    row.total += 1;
    row.net_sum_pct += result.net_return_pct;
    if (result.net_return_pct > 0) row.wins += 1;
    if (result.net_return_pct < 0) row.losses += 1;
    strategies[key] = row;
  }
  const strategySummary = Object.fromEntries(Object.entries(strategies).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, {
    ...value,
    net_sum_pct: round(value.net_sum_pct),
    avg_net_return_pct: round(value.net_sum_pct / value.total),
    win_rate_pct: round((value.wins / value.total) * 100),
  }]));
  return {
    total,
    wins: gains.length,
    losses: losses.length,
    breakeven: total - gains.length - losses.length,
    win_rate_pct: total ? round((gains.length / total) * 100) : 0,
    expectancy_pct: total ? round(net.reduce((sum, value) => sum + value, 0) / total) : 0,
    median_net_return_pct: median(net) === null ? null : round(median(net)!),
    profit_factor: sumLossAbs > 0 ? round(sumGain / sumLossAbs) : null,
    profit_factor_status: sumLossAbs > 0 ? "FINITE" : (sumGain > 0 ? "NO_LOSSES" : "NO_GAINS_OR_LOSSES"),
    gross_profit_sum_pct: round(sumGain),
    gross_loss_sum_abs_pct: round(sumLossAbs),
    avg_mfe_pct: total ? round(results.reduce((sum, value) => sum + value.mfe_pct, 0) / total) : 0,
    avg_mae_pct: total ? round(results.reduce((sum, value) => sum + value.mae_pct, 0) / total) : 0,
    avg_mfe_r: total ? round(results.reduce((sum, value) => sum + value.mfe_r, 0) / total) : 0,
    avg_mae_r: total ? round(results.reduce((sum, value) => sum + value.mae_r, 0) / total) : 0,
    ambiguous_intrabar_count: results.filter((result) => result.ambiguous_intrabar).length,
    ambiguous_intrabar_rate_pct: total ? round((results.filter((result) => result.ambiguous_intrabar).length / total) * 100) : 0,
    requires_1m_replay_count: results.filter((result) => result.requires_1m_replay).length,
    exit_reasons: Object.fromEntries(Object.entries(exitReasons).sort(([a], [b]) => a.localeCompare(b))),
    strategies: strategySummary,
  };
}

export async function runDeterministicBatchBacktest5m(input: BatchBacktestInput) {
  if (!Array.isArray(input?.datasets) || !input.datasets.length) throw new BatchBacktestError("DATASETS_REQUIRED", "at least one evaluation dataset is required");
  if (!Array.isArray(input?.cases) || !input.cases.length) throw new BatchBacktestError("CASES_REQUIRED", "at least one signal case is required");

  const datasetMap = new Map<string, EvaluationDatasetBundle>();
  for (const bundle of input.datasets) {
    const version = String(bundle?.dataset?.dataset_version ?? "");
    if (!version) throw new BatchBacktestError("INVALID_DATASET", "evaluation dataset_version is required");
    const existing = datasetMap.get(version);
    if (existing) {
      if (existing.dataset.dataset_hash !== bundle.dataset.dataset_hash || existing.dataset.dataset_id !== bundle.dataset.dataset_id) {
        throw new BatchBacktestError("DUPLICATE_DATASET_VERSION_CONFLICT", "same dataset_version maps to conflicting dataset identity", { dataset_version: version });
      }
      continue;
    }
    datasetMap.set(version, bundle);
  }

  const sortedCases = [...input.cases].sort((a, b) => {
    const ak = `${a.signal.signal_ts_ms}|${a.signal.signal_id}|${a.signal.signal_version}|${a.evaluation_dataset_version}`;
    const bk = `${b.signal.signal_ts_ms}|${b.signal.signal_id}|${b.signal.signal_version}|${b.evaluation_dataset_version}`;
    return ak.localeCompare(bk);
  });
  const caseKeys = new Set<string>();
  const results: DeterministicBacktestResult[] = [];

  for (const item of sortedCases) {
    const signal = item.signal;
    const caseKey = `${signal.signal_id}\u0000${signal.signal_version}\u0000${item.evaluation_dataset_version}`;
    if (caseKeys.has(caseKey)) throw new BatchBacktestError("DUPLICATE_CASE", "duplicate signal/version/evaluation-dataset case", { signal_id: signal.signal_id, signal_version: signal.signal_version, evaluation_dataset_version: item.evaluation_dataset_version });
    caseKeys.add(caseKey);
    if (signal.timeframe !== "5m") throw new BatchBacktestError("UNSUPPORTED_SIGNAL_TIMEFRAME", "P5 baseline accepts only 5m Signal Ledger entries", { signal_id: signal.signal_id, timeframe: signal.timeframe });
    if (signal.side !== "LONG" && signal.side !== "SHORT") throw new BatchBacktestError("UNSUPPORTED_SIGNAL_SIDE", "P5 baseline requires LONG or SHORT signal", { signal_id: signal.signal_id, side: signal.side });
    const atr = finite(signal.atr, `signal ${signal.signal_id} atr`);
    if (atr <= 0) throw new BatchBacktestError("MISSING_SIGNAL_ATR", "P5 baseline requires positive ATR captured at signal time", { signal_id: signal.signal_id });
    const signalTs = finite(signal.signal_ts_ms, `signal ${signal.signal_id} signal_ts_ms`);
    const bundle = datasetMap.get(item.evaluation_dataset_version);
    if (!bundle) throw new BatchBacktestError("EVALUATION_DATASET_NOT_FOUND", "case references an evaluation dataset_version not supplied in this batch", { signal_id: signal.signal_id, evaluation_dataset_version: item.evaluation_dataset_version });
    if (bundle.dataset.provenance?.symbol !== signal.symbol) throw new BatchBacktestError("SYMBOL_MISMATCH", "evaluation dataset symbol differs from immutable signal", { signal_id: signal.signal_id, signal_symbol: signal.symbol, dataset_symbol: bundle.dataset.provenance?.symbol });
    const firstAfter = bundle.bars.find((bar) => Number(bar.ts_ms) > signalTs);
    if (!firstAfter) throw new BatchBacktestError("NO_NEXT_BAR", "evaluation dataset has no bar after signal", { signal_id: signal.signal_id });
    const entryDate = tradeDateOf(firstAfter.bar_time_tw);
    if (entryDate !== signal.trade_date) throw new BatchBacktestError("NO_NEXT_BAR_SAME_DAY", "Taiwan intraday case would cross the immutable signal trade_date", { signal_id: signal.signal_id, signal_trade_date: signal.trade_date, next_bar_trade_date: entryDate || null });
    try {
      const result = await runDeterministicIntraday5mBacktest({
        dataset: bundle.dataset,
        bars: bundle.bars,
        signal: {
          signal_id: signal.signal_id,
          signal_version: signal.signal_version,
          symbol: signal.symbol,
          side: signal.side,
          signal_ts_ms: signalTs,
          atr,
          strategy: signal.strategy,
          event: Array.isArray(signal.event_refs) && signal.event_refs.length ? "EVENT_LINKED" : undefined,
        },
        parameters: input.parameters,
      });
      results.push(result);
    } catch (error) {
      if (error instanceof BacktestInputError) {
        throw new BatchBacktestError("CASE_BACKTEST_FAILED", error.message, { signal_id: signal.signal_id, signal_version: signal.signal_version, engine_code: error.code, engine_detail: error.detail ?? null });
      }
      throw error;
    }
  }

  const summary = aggregate(results);
  const batchIdentity = {
    schema_version: BATCH_BACKTEST_SCHEMA_VERSION,
    engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    case_run_ids: results.map((result) => result.backtest_run_id).sort(),
  };
  const batchHash = await sha256Hex(JSON.stringify(batchIdentity));
  return {
    ok: true as const,
    deterministic: true as const,
    schema_version: BATCH_BACKTEST_SCHEMA_VERSION,
    engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    batch_run_id: `btbatch:${batchHash}`,
    case_count: results.length,
    summary,
    results,
    replay_queue: results.filter((result) => result.requires_1m_replay).map((result) => ({
      backtest_run_id: result.backtest_run_id,
      signal_id: result.signal_id,
      signal_version: result.signal_version,
      dataset_version: result.dataset_version,
      ambiguous_5m_ts_ms: result.exit_ts_ms,
      reason: "AMBIGUOUS_INTRABAR",
    })),
  };
}
