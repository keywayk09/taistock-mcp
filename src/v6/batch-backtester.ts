import {
  BacktestInputError,
  DETERMINISTIC_BACKTEST_ENGINE_VERSION,
  runDeterministicIntraday5mBacktest,
  type FrozenDatasetManifest,
  type Intraday5mBar,
  type Intraday5mParameters,
  type DeterministicBacktestResult,
} from "./deterministic-backtester.ts";

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

export type BatchBacktestResult = {
  schema_version: string;
  batch_run_id: string;
  deterministic: true;
  status: "OK";
  engine_version: string;
  parameter_version: string;
  dataset_versions: string[];
  case_count: number;
  win_count: number;
  loss_count: number;
  flat_count: number;
  win_rate: number;
  gross_profit_pct: number;
  gross_loss_pct: number;
  profit_factor: number | null;
  expectancy_pct: number;
  average_mfe_pct: number;
  average_mae_pct: number;
  ambiguous_count: number;
  ambiguous_rate: number;
  replay_queue: Array<{
    signal_id: string;
    signal_version: string;
    symbol: string;
    trade_date: string;
    backtest_run_id: string;
    dataset_version: string;
  }>;
  results: DeterministicBacktestResult[];
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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) output[key] = stableValue(source[key]);
    return output;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function finite(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new BatchBacktestError("INVALID_SIGNAL", `${field} must be finite`);
  return number;
}

function toBacktestSignal(signal: BatchSignalRecord) {
  const side = String(signal.side ?? "").toUpperCase();
  if (side !== "LONG" && side !== "SHORT") throw new BatchBacktestError("INVALID_SIGNAL", "P5 requires LONG/SHORT signals", { signal_id: signal.signal_id, side });
  const atr = finite(signal.atr, "signal.atr");
  if (atr <= 0) throw new BatchBacktestError("INVALID_SIGNAL", "signal.atr must be > 0", { signal_id: signal.signal_id });
  const signalTs = finite(signal.signal_ts_ms, "signal.signal_ts_ms");
  if (!Number.isSafeInteger(signalTs) || signalTs <= 0) throw new BatchBacktestError("INVALID_SIGNAL", "signal_ts_ms must be a positive safe integer");
  if (!signal.signal_id || !signal.signal_version) throw new BatchBacktestError("INVALID_SIGNAL", "signal_id and signal_version are required");
  if (!/^\d{4,6}$/.test(String(signal.symbol ?? ""))) throw new BatchBacktestError("INVALID_SIGNAL", "invalid Taiwan stock symbol");
  if (String(signal.timeframe ?? "").toLowerCase() !== "5m") throw new BatchBacktestError("INVALID_SIGNAL", "P5 batch baseline only accepts 5m signals", { signal_id: signal.signal_id, timeframe: signal.timeframe });
  return {
    signal_id: String(signal.signal_id),
    signal_version: String(signal.signal_version),
    symbol: String(signal.symbol),
    side,
    signal_ts_ms: signalTs,
    atr,
    strategy: String(signal.strategy || ""),
    event: Array.isArray(signal.event_refs) && signal.event_refs.length ? stableJson(signal.event_refs) : undefined,
  } as const;
}

function validateBundle(bundle: EvaluationDatasetBundle) {
  const version = String(bundle?.dataset?.dataset_version ?? "");
  if (!/^sha256:[0-9a-f]{64}$/.test(version)) throw new BatchBacktestError("INVALID_DATASET_VERSION", "dataset version must be P2 SHA-256");
  if (!bundle.dataset.complete_view || bundle.dataset.truncated || !bundle.dataset.frozen_view || !bundle.dataset.formal_research_eligible) {
    throw new BatchBacktestError("DATASET_NOT_ELIGIBLE", "P5 requires complete frozen research dataset", { dataset_version: version });
  }
  if (String(bundle.dataset.provenance?.timeframe ?? "") !== "5m") throw new BatchBacktestError("INVALID_DATASET", "P5 dataset timeframe must be 5m");
  if (String(bundle.dataset.provenance?.market ?? "") !== "tw-stock") throw new BatchBacktestError("INVALID_DATASET", "P5 dataset market must be tw-stock");
  return version;
}

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export async function runDeterministicBatchBacktest5m(input: BatchBacktestInput): Promise<BatchBacktestResult> {
  if (!Array.isArray(input?.datasets) || !input.datasets.length) throw new BatchBacktestError("DATASET_REQUIRED", "datasets are required");
  if (!Array.isArray(input?.cases) || !input.cases.length) throw new BatchBacktestError("CASES_REQUIRED", "cases are required");

  const datasetMap = new Map<string, EvaluationDatasetBundle>();
  for (const bundle of input.datasets) {
    const version = validateBundle(bundle);
    if (datasetMap.has(version)) throw new BatchBacktestError("DUPLICATE_DATASET_VERSION", "dataset version supplied more than once", { dataset_version: version });
    datasetMap.set(version, bundle);
  }

  const seenCases = new Set<string>();
  const results: DeterministicBacktestResult[] = [];
  const caseDescriptors: Array<{ signal_id: string; signal_version: string; evaluation_dataset_version: string }> = [];

  for (const item of input.cases) {
    const signal = item?.signal;
    if (!signal) throw new BatchBacktestError("SIGNAL_REQUIRED", "every case requires a Signal Ledger record");
    const caseKey = `${signal.signal_id}\u0000${signal.signal_version}`;
    if (seenCases.has(caseKey)) throw new BatchBacktestError("DUPLICATE_CASE", "same Signal Ledger version appears twice in a batch", { signal_id: signal.signal_id, signal_version: signal.signal_version });
    seenCases.add(caseKey);

    const version = String(item.evaluation_dataset_version ?? "");
    const bundle = datasetMap.get(version);
    if (!bundle) throw new BatchBacktestError("EVALUATION_DATASET_MISSING", "case references a dataset version not included in the request", { signal_id: signal.signal_id, evaluation_dataset_version: version });
    if (String(bundle.dataset.provenance?.symbol ?? "") !== String(signal.symbol ?? "")) {
      throw new BatchBacktestError("SYMBOL_MISMATCH", "case dataset symbol differs from immutable Signal Ledger symbol", { signal_id: signal.signal_id });
    }

    try {
      const result = await runDeterministicIntraday5mBacktest({
        dataset: bundle.dataset,
        bars: bundle.bars,
        signal: toBacktestSignal(signal),
        parameters: input.parameters,
      });
      results.push(result);
      caseDescriptors.push({ signal_id: signal.signal_id, signal_version: signal.signal_version, evaluation_dataset_version: version });
    } catch (error) {
      if (error instanceof BacktestInputError) {
        throw new BatchBacktestError(error.code, error.message, { signal_id: signal.signal_id, signal_version: signal.signal_version, ...(error.detail ?? {}) });
      }
      throw error;
    }
  }

  const net = results.map((result) => result.net_return_pct);
  const wins = net.filter((value) => value > 0);
  const losses = net.filter((value) => value < 0);
  const flat = net.length - wins.length - losses.length;
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? null : 0);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const ambiguous = results.filter((result) => result.requires_1m_replay);
  const parameterVersion = results[0]?.parameter_version ?? "";
  const datasetVersions = Array.from(new Set(caseDescriptors.map((item) => item.evaluation_dataset_version))).sort();
  const batchFingerprint = {
    schema_version: BATCH_BACKTEST_SCHEMA_VERSION,
    engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    parameter_version: parameterVersion,
    cases: caseDescriptors,
  };
  const batchHash = await sha256Hex(stableJson(batchFingerprint));

  return {
    schema_version: BATCH_BACKTEST_SCHEMA_VERSION,
    batch_run_id: `batch:${batchHash}`,
    deterministic: true,
    status: "OK",
    engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    parameter_version: parameterVersion,
    dataset_versions: datasetVersions,
    case_count: results.length,
    win_count: wins.length,
    loss_count: losses.length,
    flat_count: flat,
    win_rate: round(results.length ? wins.length / results.length : 0),
    gross_profit_pct: round(grossProfit),
    gross_loss_pct: round(grossLossAbs),
    profit_factor: profitFactor === null ? null : round(profitFactor),
    expectancy_pct: round(average(net)),
    average_mfe_pct: round(average(results.map((result) => result.mfe_pct))),
    average_mae_pct: round(average(results.map((result) => result.mae_pct))),
    ambiguous_count: ambiguous.length,
    ambiguous_rate: round(results.length ? ambiguous.length / results.length : 0),
    replay_queue: ambiguous.map((result) => ({
      signal_id: result.signal_id,
      signal_version: result.signal_version,
      symbol: result.symbol,
      trade_date: String(input.cases.find((item) => item.signal.signal_id === result.signal_id && item.signal.signal_version === result.signal_version)?.signal.trade_date ?? ""),
      backtest_run_id: result.backtest_run_id,
      dataset_version: result.dataset_version,
    })),
    results,
  };
}
