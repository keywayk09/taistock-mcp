export const SWING_OUTCOME_ENGINE_VERSION = "diamond-swing-outcome/v1.0.0";
export const SWING_OUTCOME_SCHEMA_VERSION = "diamond-swing-outcome-result/v1";
export const OHLC_DATASET_SCHEMA_VERSION = "ohlc-dataset/v1";

const OHLC_1D_COLUMNS = [
  "date", "symbol", "open", "high", "low", "close", "volume", "source", "updated_at_ms",
  "ema_5", "ema_10", "ema_20", "ema_60", "ema_120", "ind_updated_at", "ingest_id",
  "bar_time_tw", "ema_240", "k_9", "d_3",
] as const;

type Side = "LONG" | "SHORT";

export type SwingDailyBar = {
  date: string;
  symbol: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
  [key: string]: unknown;
};

export type FrozenDailyDatasetManifest = {
  schema_version: string;
  dataset_id: string;
  dataset_version: string;
  dataset_hash: string;
  frozen_view: boolean;
  complete_view: boolean;
  truncated: boolean;
  formal_research_eligible: boolean;
  row_count: number;
  total_validated_rows: number;
  source: string;
  source_files?: Array<{ path?: string; sha?: string; trade_date?: string | null; year?: number | null }>;
  provenance: {
    market: string;
    symbol: string;
    timeframe: string;
    source?: string;
    [key: string]: unknown;
  };
};

export type SwingSignal = {
  signal_id: string;
  signal_version: string;
  symbol: string;
  side: Side;
  signal_ts_ms: number;
  trade_date: string;
  strategy?: string;
  event?: string;
};

export type SwingOutcomeParameters = {
  parameter_schema_version?: string;
  max_horizon_days?: number;
  reference_rule?: "NEXT_SESSION_OPEN";
};

export type SwingOutcomeInput = {
  dataset: FrozenDailyDatasetManifest;
  bars: SwingDailyBar[];
  signal: SwingSignal;
  parameters?: SwingOutcomeParameters;
};

export type SwingHorizonResult = {
  horizon_day: number;
  trade_date: string;
  close: number;
  directional_close_return_pct: number;
  mfe_pct: number;
  mae_pct: number;
};

export type SwingOutcomeResult = {
  schema_version: string;
  engine_version: string;
  swing_run_id: string;
  deterministic: true;
  status: "OK";
  outcome_only: true;
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
  trade_date: string;
  parameter_version: string;
  parameter_hash: string;
  reference_rule: "NEXT_SESSION_OPEN";
  reference_trade_date: string;
  reference_price: number;
  available_horizon_days: number;
  horizons: SwingHorizonResult[];
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

export class SwingOutcomeError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "SwingOutcomeError";
    this.code = code;
    this.detail = detail;
  }
}

const DEFAULT_PARAMETERS = Object.freeze({
  parameter_schema_version: "swing-outcome-parameters/v1",
  max_horizon_days: 5,
  reference_rule: "NEXT_SESSION_OPEN" as const,
});

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
  const result = Number(value);
  if (!Number.isFinite(result)) throw new SwingOutcomeError("INVALID_INPUT", `${field} must be finite`);
  return result;
}

function positive(value: unknown, field: string): number {
  const result = finite(value, field);
  if (result <= 0) throw new SwingOutcomeError("INVALID_INPUT", `${field} must be > 0`);
  return result;
}

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function canonicalSourceFiles(files: FrozenDailyDatasetManifest["source_files"]) {
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

function canonicalRows(bars: SwingDailyBar[]) {
  return bars.map((row) => OHLC_1D_COLUMNS.map((key) => {
    const value = row[key];
    if (value === undefined || value === null) return "";
    return typeof value === "number" ? (Number.isFinite(value) ? value : String(value)) : String(value);
  }));
}

async function recomputeDatasetHash(dataset: FrozenDailyDatasetManifest, bars: SwingDailyBar[]): Promise<string> {
  const provenance = dataset.provenance ?? ({} as FrozenDailyDatasetManifest["provenance"]);
  const firstBoundary = bars.at(0)?.date ?? null;
  const lastBoundary = bars.at(-1)?.date ?? null;
  const fingerprint = {
    schema_version: OHLC_DATASET_SCHEMA_VERSION,
    market: String(provenance.market ?? "tw-stock"),
    symbol: String(provenance.symbol ?? ""),
    timeframe: "1d",
    source: String(dataset.source ?? provenance.source ?? ""),
    columns: [...OHLC_1D_COLUMNS],
    source_files: canonicalSourceFiles(dataset.source_files),
    scope: { first: firstBoundary, last: lastBoundary, row_count: bars.length },
    rows: canonicalRows(bars),
  };
  return sha256Hex(stableJson(fingerprint));
}

function validateTradeDate(value: unknown, field: string): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SwingOutcomeError("INVALID_INPUT", `${field} must be YYYY-MM-DD`);
  return date;
}

function normalizeParameters(parameters?: SwingOutcomeParameters) {
  const merged = { ...DEFAULT_PARAMETERS, ...(parameters ?? {}) };
  if (merged.reference_rule !== "NEXT_SESSION_OPEN") throw new SwingOutcomeError("INVALID_PARAMETERS", "reference_rule must be NEXT_SESSION_OPEN");
  const maxHorizonDays = Number(merged.max_horizon_days);
  if (!Number.isInteger(maxHorizonDays) || maxHorizonDays < 1 || maxHorizonDays > 20) {
    throw new SwingOutcomeError("INVALID_PARAMETERS", "max_horizon_days must be integer 1..20");
  }
  return {
    parameter_schema_version: String(merged.parameter_schema_version || DEFAULT_PARAMETERS.parameter_schema_version),
    max_horizon_days: maxHorizonDays,
    reference_rule: "NEXT_SESSION_OPEN" as const,
  };
}

async function validateDataset(dataset: FrozenDailyDatasetManifest, bars: SwingDailyBar[], signal: SwingSignal) {
  if (!dataset || typeof dataset !== "object") throw new SwingOutcomeError("INVALID_DATASET", "dataset is required");
  if (dataset.schema_version !== OHLC_DATASET_SCHEMA_VERSION) throw new SwingOutcomeError("INVALID_DATASET", "unsupported dataset schema_version");
  if (!dataset.frozen_view) throw new SwingOutcomeError("DATASET_NOT_FROZEN", "dataset.frozen_view must be true");
  if (!dataset.complete_view || dataset.truncated) throw new SwingOutcomeError("DATASET_INCOMPLETE_VIEW", "swing outcome requires complete, non-truncated dataset view");
  if (!dataset.formal_research_eligible) throw new SwingOutcomeError("DATASET_NOT_ELIGIBLE", "dataset is not formal_research_eligible");
  if (!/^sha256:[0-9a-f]{64}$/.test(String(dataset.dataset_version ?? ""))) throw new SwingOutcomeError("INVALID_DATASET_VERSION", "dataset_version must be sha256:<64 hex>");
  if (!/^[0-9a-f]{64}$/.test(String(dataset.dataset_hash ?? ""))) throw new SwingOutcomeError("INVALID_DATASET_HASH", "dataset_hash must be 64 hex");
  if (dataset.dataset_version !== `sha256:${dataset.dataset_hash}`) throw new SwingOutcomeError("INVALID_DATASET_VERSION", "dataset_version/hash mismatch");
  if (String(dataset.provenance?.market ?? "") !== "tw-stock") throw new SwingOutcomeError("INVALID_DATASET", "current swing engine requires tw-stock market");
  if (String(dataset.provenance?.timeframe ?? "") !== "1d") throw new SwingOutcomeError("INVALID_DATASET", "swing engine requires 1d dataset");
  if (String(dataset.provenance?.symbol ?? "") !== signal.symbol) throw new SwingOutcomeError("SYMBOL_MISMATCH", "signal symbol differs from dataset symbol");
  if (Number(dataset.row_count) !== bars.length || Number(dataset.total_validated_rows) !== bars.length) {
    throw new SwingOutcomeError("DATASET_ROW_COUNT_MISMATCH", "bars must be the exact complete frozen dataset view");
  }
  if (!bars.length) throw new SwingOutcomeError("DATASET_EMPTY", "bars are empty");

  let previous = "";
  const seen = new Set<string>();
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const date = validateTradeDate(bar.date, `bars[${index}].date`);
    if (seen.has(date)) throw new SwingOutcomeError("DUPLICATE_BAR", `duplicate date ${date}`);
    if (previous && date <= previous) throw new SwingOutcomeError("UNSORTED_BARS", "bars must be strictly chronological");
    seen.add(date);
    previous = date;
    if (String(bar.symbol) !== signal.symbol) throw new SwingOutcomeError("SYMBOL_MISMATCH", `bars[${index}] symbol mismatch`);
    const open = positive(bar.open, `bars[${index}].open`);
    const high = positive(bar.high, `bars[${index}].high`);
    const low = positive(bar.low, `bars[${index}].low`);
    const close = positive(bar.close, `bars[${index}].close`);
    const volume = finite(bar.volume, `bars[${index}].volume`);
    if (volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new SwingOutcomeError("INVALID_OHLC", `bars[${index}] has invalid OHLCV`);
    }
  }

  const recomputed = await recomputeDatasetHash(dataset, bars);
  if (recomputed !== dataset.dataset_hash) {
    throw new SwingOutcomeError("DATASET_HASH_MISMATCH", "returned bars do not match dataset_hash", {
      expected: dataset.dataset_hash,
      actual: recomputed,
    });
  }
}

export async function runSwingOutcomePath(input: SwingOutcomeInput): Promise<SwingOutcomeResult> {
  const signal = input?.signal;
  if (!signal || typeof signal !== "object") throw new SwingOutcomeError("INVALID_SIGNAL", "signal is required");
  const symbol = String(signal.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new SwingOutcomeError("INVALID_SIGNAL", "signal.symbol must be 4-6 digits");
  if (!String(signal.signal_id ?? "").trim() || !String(signal.signal_version ?? "").trim()) {
    throw new SwingOutcomeError("INVALID_SIGNAL", "signal_id and signal_version are required");
  }
  if (signal.side !== "LONG" && signal.side !== "SHORT") throw new SwingOutcomeError("INVALID_SIGNAL", "side must be LONG or SHORT");
  const signalTs = Number(signal.signal_ts_ms);
  if (!Number.isSafeInteger(signalTs) || signalTs <= 0) throw new SwingOutcomeError("INVALID_SIGNAL", "signal_ts_ms must be a positive safe integer");
  const signalTradeDate = validateTradeDate(signal.trade_date, "signal.trade_date");

  const parameters = normalizeParameters(input.parameters);
  await validateDataset(input.dataset, input.bars, signal);

  const future = input.bars.filter((bar) => bar.date > signalTradeDate);
  if (!future.length) throw new SwingOutcomeError("NO_FUTURE_SESSION", "no post-signal daily session exists in frozen dataset");
  const path = future.slice(0, parameters.max_horizon_days);
  const reference = path[0];
  const referencePrice = positive(reference.open, "reference.open");
  const direction = signal.side === "LONG" ? 1 : -1;
  let bestHigh = referencePrice;
  let bestLow = referencePrice;
  const horizons: SwingHorizonResult[] = [];

  for (let index = 0; index < path.length; index += 1) {
    const bar = path[index];
    const high = positive(bar.high, `path[${index}].high`);
    const low = positive(bar.low, `path[${index}].low`);
    const close = positive(bar.close, `path[${index}].close`);
    bestHigh = Math.max(bestHigh, high);
    bestLow = Math.min(bestLow, low);
    const longMfe = (bestHigh / referencePrice - 1) * 100;
    const longMae = (bestLow / referencePrice - 1) * 100;
    const mfePct = signal.side === "LONG" ? longMfe : -(longMae);
    const maePct = signal.side === "LONG" ? longMae : -(longMfe);
    horizons.push({
      horizon_day: index + 1,
      trade_date: bar.date,
      close,
      directional_close_return_pct: round(direction * (close / referencePrice - 1) * 100),
      mfe_pct: round(mfePct),
      mae_pct: round(maePct),
    });
  }

  const parameterHash = await sha256Hex(stableJson(parameters));
  const parameterVersion = `sha256:${parameterHash}`;
  const runHash = await sha256Hex(stableJson({
    engine_version: SWING_OUTCOME_ENGINE_VERSION,
    dataset_version: input.dataset.dataset_version,
    signal_id: signal.signal_id,
    signal_version: signal.signal_version,
    parameter_version: parameterVersion,
  }));

  return {
    schema_version: SWING_OUTCOME_SCHEMA_VERSION,
    engine_version: SWING_OUTCOME_ENGINE_VERSION,
    swing_run_id: `swing:${runHash}`,
    deterministic: true,
    status: "OK",
    outcome_only: true,
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
    trade_date: signalTradeDate,
    parameter_version: parameterVersion,
    parameter_hash: parameterHash,
    reference_rule: "NEXT_SESSION_OPEN",
    reference_trade_date: reference.date,
    reference_price: referencePrice,
    available_horizon_days: horizons.length,
    horizons,
    provenance: {
      dataset_id: input.dataset.dataset_id,
      dataset_version: input.dataset.dataset_version,
      dataset_hash: input.dataset.dataset_hash,
      signal_id: signal.signal_id,
      signal_version: signal.signal_version,
      parameter_version: parameterVersion,
      engine_version: SWING_OUTCOME_ENGINE_VERSION,
    },
  };
}
