export const DETERMINISTIC_BACKTEST_ENGINE_VERSION = "diamond-intraday-5m/v1.0.0";
export const DETERMINISTIC_BACKTEST_SCHEMA_VERSION = "diamond-backtest-result/v1";
export const OHLC_DATASET_SCHEMA_VERSION = "ohlc-dataset/v1";

export const DEFAULT_INTRADAY_5M_PARAMETERS = Object.freeze({
  parameter_schema_version: "intraday-5m-parameters/v1",
  entry_rule: "NEXT_BAR_OPEN" as const,
  stop_atr: 1,
  target_atr: 1.5,
  max_bars: 12,
  cost_rate_round_trip: 0.0004,
  tie_break: "STOP_FIRST" as const,
  end_of_day_exit: true,
});

const OHLC_5M_COLUMNS = [
  "symbol", "bar_time_tw", "ts_ms", "open", "high", "low", "close", "volume",
  "source", "updated_at_ms", "ema_5", "ema_10", "ema_20", "rsi_14", "macd",
  "macd_signal", "macd_hist", "updated_at", "day_volume_total", "vol_slope",
  "real_body_ratio", "upper_wick_ratio", "lower_wick_ratio", "k_9", "d_3",
] as const;

type Side = "LONG" | "SHORT";
type TieBreak = "STOP_FIRST";
type EntryRule = "NEXT_BAR_OPEN";

export type Intraday5mBar = {
  symbol: string;
  bar_time_tw: string;
  ts_ms: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
  [key: string]: unknown;
};

export type FrozenDatasetManifest = {
  schema_version: string;
  dataset_id: string;
  dataset_version: string;
  dataset_hash: string;
  hash_algorithm?: string;
  frozen_view: boolean;
  complete_view: boolean;
  truncated: boolean;
  formal_research_eligible: boolean;
  row_count: number;
  total_validated_rows: number;
  first?: string | null;
  last?: string | null;
  source: string;
  source_files?: Array<{
    path?: string;
    sha?: string;
    trade_date?: string | null;
    year?: number | null;
  }>;
  provenance: {
    market: string;
    symbol: string;
    timeframe: string;
    source?: string;
    [key: string]: unknown;
  };
};

export type BacktestSignal = {
  signal_id: string;
  signal_version: string;
  symbol: string;
  side: Side;
  signal_ts_ms: number;
  atr: number;
  strategy?: string;
  event?: string;
};

export type Intraday5mParameters = {
  parameter_schema_version?: string;
  entry_rule?: EntryRule;
  stop_atr?: number;
  target_atr?: number;
  max_bars?: number;
  cost_rate_round_trip?: number;
  tie_break?: TieBreak;
  end_of_day_exit?: boolean;
};

export type DeterministicBacktestInput = {
  dataset: FrozenDatasetManifest;
  bars: Intraday5mBar[];
  signal: BacktestSignal;
  parameters?: Intraday5mParameters;
};

export type DeterministicBacktestResult = {
  schema_version: string;
  engine_version: string;
  backtest_run_id: string;
  deterministic: true;
  status: "OK";
  dataset_id: string;
  dataset_version: string;
  dataset_hash: string;
  signal_id: string;
  signal_version: string;
  symbol: string;
  side: Side;
  strategy: string | null;
  event: string | null;
  signal_ts_ms: number;
  parameter_version: string;
  parameter_hash: string;
  parameters: Required<Intraday5mParameters>;
  atr: number;
  entry_ts_ms: number;
  entry_bar_time_tw: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  exit_ts_ms: number;
  exit_bar_time_tw: string;
  exit_price: number;
  exit_reason: "STOP" | "TARGET" | "MAX_BARS" | "EOD";
  bars_held: number;
  gross_return_pct: number;
  cost_pct: number;
  net_return_pct: number;
  mfe_pct: number;
  mae_pct: number;
  mfe_r: number;
  mae_r: number;
  ambiguous_intrabar: boolean;
  intrabar_status: "RESOLVED_5M" | "AMBIGUOUS_INTRABAR";
  conservative_resolution: "STOP_FIRST" | null;
  requires_1m_replay: boolean;
  provenance: {
    dataset_id: string;
    dataset_version: string;
    dataset_hash: string;
    signal_id: string;
    signal_version: string;
    parameter_version: string;
    engine_version: string;
  };
};

export class BacktestInputError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "BacktestInputError";
    this.code = code;
    this.detail = detail;
  }
}

function finite(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new BacktestInputError("INVALID_INPUT", `${field} must be finite`);
  return result;
}

function positive(value: unknown, field: string): number {
  const result = finite(value, field);
  if (result <= 0) throw new BacktestInputError("INVALID_INPUT", `${field} must be > 0`);
  return result;
}

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
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
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function canonicalSourceFiles(files: FrozenDatasetManifest["source_files"]) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      path: String(file?.path ?? ""),
      sha: String(file?.sha ?? ""),
      trade_date: file?.trade_date ? String(file.trade_date) : null,
      year: Number.isFinite(Number(file?.year)) ? Number(file?.year) : null,
    }))
    .filter((file) => file.path || file.sha)
    .sort((a, b) => `${a.path}|${a.sha}`.localeCompare(`${b.path}|${b.sha}`));
}

function canonicalRows(bars: Intraday5mBar[]) {
  return bars.map((row) => OHLC_5M_COLUMNS.map((key) => {
    const value = row[key];
    if (value === undefined || value === null) return "";
    return typeof value === "number" ? (Number.isFinite(value) ? value : String(value)) : String(value);
  }));
}

async function recomputeDatasetHash(dataset: FrozenDatasetManifest, bars: Intraday5mBar[]): Promise<string> {
  const provenance = dataset.provenance ?? ({} as FrozenDatasetManifest["provenance"]);
  const first = bars.at(0);
  const last = bars.at(-1);
  const firstBoundary = first ? String(finite(first.ts_ms, "bars[0].ts_ms")) : null;
  const lastBoundary = last ? String(finite(last.ts_ms, "bars[last].ts_ms")) : null;
  const fingerprint = {
    schema_version: OHLC_DATASET_SCHEMA_VERSION,
    market: String(provenance.market ?? "tw-stock"),
    symbol: String(provenance.symbol ?? ""),
    timeframe: "5m",
    source: String(dataset.source ?? provenance.source ?? ""),
    columns: [...OHLC_5M_COLUMNS],
    source_files: canonicalSourceFiles(dataset.source_files),
    scope: { first: firstBoundary, last: lastBoundary, row_count: bars.length },
    rows: canonicalRows(bars),
  };
  return sha256Hex(stableJson(fingerprint));
}

function normalizeParameters(parameters?: Intraday5mParameters): Required<Intraday5mParameters> {
  const p = { ...DEFAULT_INTRADAY_5M_PARAMETERS, ...(parameters ?? {}) };
  if (p.entry_rule !== "NEXT_BAR_OPEN") throw new BacktestInputError("INVALID_PARAMETERS", "entry_rule must be NEXT_BAR_OPEN");
  if (p.tie_break !== "STOP_FIRST") throw new BacktestInputError("INVALID_PARAMETERS", "tie_break must be STOP_FIRST");
  if (p.end_of_day_exit !== true) throw new BacktestInputError("INVALID_PARAMETERS", "end_of_day_exit must be true");
  const stopAtr = positive(p.stop_atr, "stop_atr");
  const targetAtr = positive(p.target_atr, "target_atr");
  const maxBars = finite(p.max_bars, "max_bars");
  if (!Number.isInteger(maxBars) || maxBars < 1 || maxBars > 200) throw new BacktestInputError("INVALID_PARAMETERS", "max_bars must be integer 1..200");
  const costRate = finite(p.cost_rate_round_trip, "cost_rate_round_trip");
  if (costRate < 0 || costRate > 0.1) throw new BacktestInputError("INVALID_PARAMETERS", "cost_rate_round_trip must be 0..0.1");
  return {
    parameter_schema_version: String(p.parameter_schema_version || DEFAULT_INTRADAY_5M_PARAMETERS.parameter_schema_version),
    entry_rule: "NEXT_BAR_OPEN",
    stop_atr: stopAtr,
    target_atr: targetAtr,
    max_bars: maxBars,
    cost_rate_round_trip: costRate,
    tie_break: "STOP_FIRST",
    end_of_day_exit: true,
  };
}

function validateDataset(dataset: FrozenDatasetManifest, bars: Intraday5mBar[], signal: BacktestSignal) {
  if (!dataset || typeof dataset !== "object") throw new BacktestInputError("INVALID_DATASET", "dataset is required");
  if (dataset.schema_version !== OHLC_DATASET_SCHEMA_VERSION) throw new BacktestInputError("INVALID_DATASET", "unsupported dataset schema_version");
  if (!dataset.frozen_view) throw new BacktestInputError("DATASET_NOT_FROZEN", "dataset.frozen_view must be true");
  if (!dataset.complete_view || dataset.truncated) throw new BacktestInputError("DATASET_INCOMPLETE_VIEW", "formal backtest requires complete, non-truncated dataset view");
  if (!dataset.formal_research_eligible) throw new BacktestInputError("DATASET_NOT_ELIGIBLE", "dataset is not formal_research_eligible");
  if (!/^sha256:[0-9a-f]{64}$/.test(String(dataset.dataset_version ?? ""))) throw new BacktestInputError("INVALID_DATASET_VERSION", "dataset_version must be sha256:<64 hex>");
  if (!/^[0-9a-f]{64}$/.test(String(dataset.dataset_hash ?? ""))) throw new BacktestInputError("INVALID_DATASET_HASH", "dataset_hash must be 64 hex");
  if (`sha256:${dataset.dataset_hash}` !== dataset.dataset_version) throw new BacktestInputError("INVALID_DATASET_VERSION", "dataset_version/hash mismatch");
  if (dataset.provenance?.timeframe !== "5m") throw new BacktestInputError("INVALID_DATASET", "deterministic intraday engine requires 5m dataset");
  if (String(dataset.provenance?.market ?? "") !== "tw-stock") throw new BacktestInputError("INVALID_DATASET", "current engine requires tw-stock market");
  if (String(dataset.provenance?.symbol ?? "") !== signal.symbol) throw new BacktestInputError("SYMBOL_MISMATCH", "signal symbol differs from dataset symbol");
  if (Number(dataset.row_count) !== bars.length || Number(dataset.total_validated_rows) !== bars.length) {
    throw new BacktestInputError("DATASET_ROW_COUNT_MISMATCH", "bars must be the exact complete frozen dataset view", { dataset_row_count: dataset.row_count, bars: bars.length });
  }
  if (!bars.length) throw new BacktestInputError("DATASET_EMPTY", "bars are empty");

  let previous = -Infinity;
  const seen = new Set<number>();
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (String(bar.symbol) !== signal.symbol) throw new BacktestInputError("SYMBOL_MISMATCH", `bars[${index}] symbol mismatch`);
    const ts = finite(bar.ts_ms, `bars[${index}].ts_ms`);
    if (seen.has(ts)) throw new BacktestInputError("DUPLICATE_BAR", `duplicate ts_ms ${ts}`);
    if (ts <= previous) throw new BacktestInputError("UNSORTED_BARS", "bars must be strictly chronological");
    seen.add(ts);
    previous = ts;
    const open = positive(bar.open, `bars[${index}].open`);
    const high = positive(bar.high, `bars[${index}].high`);
    const low = positive(bar.low, `bars[${index}].low`);
    const close = positive(bar.close, `bars[${index}].close`);
    const volume = finite(bar.volume, `bars[${index}].volume`);
    if (volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new BacktestInputError("INVALID_OHLC", `bars[${index}] has invalid OHLCV`);
    }
  }
}

function tradeDateOf(bar: Intraday5mBar): string {
  const match = String(bar.bar_time_tw ?? "").match(/\b([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/);
  if (match) {
    const months: Record<string, string> = { Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12" };
    return `${match[4]}-${months[match[2]] ?? "00"}-${String(match[3]).padStart(2,"0")}`;
  }
  const iso = String(bar.bar_time_tw ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

function direction(side: Side): 1 | -1 {
  return side === "LONG" ? 1 : -1;
}

export async function runDeterministicIntraday5mBacktest(input: DeterministicBacktestInput): Promise<DeterministicBacktestResult> {
  const signal = input?.signal;
  if (!signal || typeof signal !== "object") throw new BacktestInputError("INVALID_SIGNAL", "signal is required");
  const symbol = String(signal.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new BacktestInputError("INVALID_SIGNAL", "signal.symbol must be 4-6 digits");
  if (!String(signal.signal_id ?? "").trim()) throw new BacktestInputError("INVALID_SIGNAL", "signal_id is required");
  if (!String(signal.signal_version ?? "").trim()) throw new BacktestInputError("INVALID_SIGNAL", "signal_version is required");
  if (signal.side !== "LONG" && signal.side !== "SHORT") throw new BacktestInputError("INVALID_SIGNAL", "side must be LONG or SHORT");
  const signalTs = positive(signal.signal_ts_ms, "signal_ts_ms");
  const atr = positive(signal.atr, "atr");
  const bars = Array.isArray(input?.bars) ? input.bars : [];
  validateDataset(input.dataset, bars, { ...signal, symbol, signal_ts_ms: signalTs, atr });

  const recomputedHash = await recomputeDatasetHash(input.dataset, bars);
  if (recomputedHash !== input.dataset.dataset_hash) {
    throw new BacktestInputError("DATASET_VERSION_MISMATCH", "supplied bars/source provenance do not reproduce dataset_hash", {
      expected: input.dataset.dataset_hash,
      recomputed: recomputedHash,
    });
  }

  const parameters = normalizeParameters(input.parameters);
  const parameterHash = await sha256Hex(stableJson(parameters));
  const parameterVersion = `sha256:${parameterHash}`;

  const entryIndex = bars.findIndex((bar) => finite(bar.ts_ms, "bar.ts_ms") > signalTs);
  if (entryIndex < 0) throw new BacktestInputError("NO_NEXT_BAR", "no 5m bar exists after the signal timestamp");
  const entryBar = bars[entryIndex];
  const entryDate = tradeDateOf(entryBar);
  if (!entryDate) throw new BacktestInputError("INVALID_BAR_TIME", "entry bar trade date cannot be resolved deterministically");
  const entryPrice = positive(entryBar.open, "entry.open");
  const dir = direction(signal.side);
  const stopPrice = round(entryPrice - dir * atr * parameters.stop_atr);
  const targetPrice = round(entryPrice + dir * atr * parameters.target_atr);

  let exitBar = entryBar;
  let exitPrice = entryPrice;
  let exitReason: DeterministicBacktestResult["exit_reason"] = "EOD";
  let barsHeld = 0;
  let ambiguous = false;
  let mfePct = 0;
  let maePct = 0;
  let mfeR = 0;
  let maeR = 0;

  for (let index = entryIndex; index < bars.length && barsHeld < parameters.max_bars; index += 1) {
    const bar = bars[index];
    if (tradeDateOf(bar) !== entryDate) break;
    barsHeld += 1;
    exitBar = bar;
    const high = positive(bar.high, `bars[${index}].high`);
    const low = positive(bar.low, `bars[${index}].low`);
    const close = positive(bar.close, `bars[${index}].close`);

    const favorablePrice = signal.side === "LONG" ? high - entryPrice : entryPrice - low;
    const adversePrice = signal.side === "LONG" ? low - entryPrice : entryPrice - high;
    mfePct = Math.max(mfePct, (favorablePrice / entryPrice) * 100);
    maePct = Math.min(maePct, (adversePrice / entryPrice) * 100);
    mfeR = Math.max(mfeR, favorablePrice / atr);
    maeR = Math.min(maeR, adversePrice / atr);

    const stopTouched = signal.side === "LONG" ? low <= stopPrice : high >= stopPrice;
    const targetTouched = signal.side === "LONG" ? high >= targetPrice : low <= targetPrice;
    if (stopTouched && targetTouched) {
      ambiguous = true;
      exitPrice = stopPrice;
      exitReason = "STOP";
      break;
    }
    if (stopTouched) {
      exitPrice = stopPrice;
      exitReason = "STOP";
      break;
    }
    if (targetTouched) {
      exitPrice = targetPrice;
      exitReason = "TARGET";
      break;
    }

    exitPrice = close;
    const next = bars[index + 1];
    const nextIsSameDay = Boolean(next && tradeDateOf(next) === entryDate);
    if (!nextIsSameDay) {
      exitReason = "EOD";
      break;
    }
    if (barsHeld >= parameters.max_bars) {
      exitReason = "MAX_BARS";
      break;
    }
  }

  if (barsHeld < 1) throw new BacktestInputError("NO_ENTRY_BAR", "entry bar was not eligible for simulation");
  const grossReturnPct = ((exitPrice - entryPrice) / entryPrice) * dir * 100;
  const costPct = parameters.cost_rate_round_trip * 100;
  const netReturnPct = grossReturnPct - costPct;
  const identity = {
    schema_version: DETERMINISTIC_BACKTEST_SCHEMA_VERSION,
    engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    dataset_id: input.dataset.dataset_id,
    dataset_version: input.dataset.dataset_version,
    signal_id: signal.signal_id,
    signal_version: signal.signal_version,
    symbol,
    side: signal.side,
    signal_ts_ms: signalTs,
    atr,
    parameter_version: parameterVersion,
  };
  const runHash = await sha256Hex(stableJson(identity));

  return {
    schema_version: DETERMINISTIC_BACKTEST_SCHEMA_VERSION,
    engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    backtest_run_id: `bt:${runHash}`,
    deterministic: true,
    status: "OK",
    dataset_id: input.dataset.dataset_id,
    dataset_version: input.dataset.dataset_version,
    dataset_hash: input.dataset.dataset_hash,
    signal_id: signal.signal_id,
    signal_version: signal.signal_version,
    symbol,
    side: signal.side,
    strategy: signal.strategy ? String(signal.strategy) : null,
    event: signal.event ? String(signal.event) : null,
    signal_ts_ms: signalTs,
    parameter_version: parameterVersion,
    parameter_hash: parameterHash,
    parameters,
    atr: round(atr),
    entry_ts_ms: finite(entryBar.ts_ms, "entry.ts_ms"),
    entry_bar_time_tw: String(entryBar.bar_time_tw ?? ""),
    entry_price: round(entryPrice),
    stop_price: stopPrice,
    target_price: targetPrice,
    exit_ts_ms: finite(exitBar.ts_ms, "exit.ts_ms"),
    exit_bar_time_tw: String(exitBar.bar_time_tw ?? ""),
    exit_price: round(exitPrice),
    exit_reason: exitReason,
    bars_held: barsHeld,
    gross_return_pct: round(grossReturnPct, 8),
    cost_pct: round(costPct, 8),
    net_return_pct: round(netReturnPct, 8),
    mfe_pct: round(mfePct, 8),
    mae_pct: round(maePct, 8),
    mfe_r: round(mfeR, 8),
    mae_r: round(maeR, 8),
    ambiguous_intrabar: ambiguous,
    intrabar_status: ambiguous ? "AMBIGUOUS_INTRABAR" : "RESOLVED_5M",
    conservative_resolution: ambiguous ? "STOP_FIRST" : null,
    requires_1m_replay: ambiguous,
    provenance: {
      dataset_id: input.dataset.dataset_id,
      dataset_version: input.dataset.dataset_version,
      dataset_hash: input.dataset.dataset_hash,
      signal_id: signal.signal_id,
      signal_version: signal.signal_version,
      parameter_version: parameterVersion,
      engine_version: DETERMINISTIC_BACKTEST_ENGINE_VERSION,
    },
  };
}
