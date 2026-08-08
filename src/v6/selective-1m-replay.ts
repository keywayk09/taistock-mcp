import type { DeterministicBacktestResult, FrozenDatasetManifest, Intraday5mBar } from "./deterministic-backtester";

export const SELECTIVE_1M_REPLAY_ENGINE_VERSION = "diamond-selective-1m-replay/v1.0.0";
export const SELECTIVE_1M_REPLAY_SCHEMA_VERSION = "diamond-1m-replay-result/v1";

const OHLC_1M_COLUMNS = [
  "symbol", "bar_time_tw", "ts_ms", "open", "high", "low", "close", "volume",
  "source", "updated_at_ms", "trade_date", "updated_at", "ingest_id", "export_batch", "export_status",
] as const;

export type Intraday1mBar = Intraday5mBar & {
  trade_date?: string;
  ingest_id?: string;
  export_batch?: string;
  export_status?: string;
};

export type SelectiveReplayInput = {
  original_5m_result: DeterministicBacktestResult;
  dataset_1m: FrozenDatasetManifest;
  bars_1m: Intraday1mBar[];
};

export class SelectiveReplayError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "SelectiveReplayError";
    this.code = code;
    this.detail = detail;
  }
}

function finite(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new SelectiveReplayError("INVALID_INPUT", `${field} must be finite`);
  return n;
}

function positive(value: unknown, field: string): number {
  const n = finite(value, field);
  if (n <= 0) throw new SelectiveReplayError("INVALID_INPUT", `${field} must be > 0`);
  return n;
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

function canonicalRows(rows: Intraday1mBar[]) {
  return rows.map((row) => OHLC_1M_COLUMNS.map((key) => {
    const value = row[key];
    if (value === undefined || value === null) return "";
    return typeof value === "number" ? (Number.isFinite(value) ? value : String(value)) : String(value);
  }));
}

async function recomputeDatasetHash(dataset: FrozenDatasetManifest, rows: Intraday1mBar[]): Promise<string> {
  const first = rows.at(0);
  const last = rows.at(-1);
  const firstBoundary = first ? String(finite(first.ts_ms, "bars_1m[0].ts_ms")) : null;
  const lastBoundary = last ? String(finite(last.ts_ms, "bars_1m[last].ts_ms")) : null;
  const fingerprint = {
    schema_version: "ohlc-dataset/v1",
    market: String(dataset.provenance?.market ?? "tw-stock"),
    symbol: String(dataset.provenance?.symbol ?? ""),
    timeframe: "1m",
    source: String(dataset.source ?? dataset.provenance?.source ?? ""),
    columns: [...OHLC_1M_COLUMNS],
    source_files: canonicalSourceFiles(dataset.source_files),
    scope: { first: firstBoundary, last: lastBoundary, row_count: rows.length },
    rows: canonicalRows(rows),
  };
  return sha256Hex(stableJson(fingerprint));
}

function tradeDateOf(row: Intraday1mBar): string {
  const explicit = String(row.trade_date ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const raw = String(row.bar_time_tw ?? "");
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return "";
}

function resultTradeDate(original: DeterministicBacktestResult): string {
  const raw = String(original.exit_bar_time_tw ?? original.entry_bar_time_tw ?? "");
  const iso = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

function validateDataset(dataset: FrozenDatasetManifest, rows: Intraday1mBar[], original: DeterministicBacktestResult) {
  if (!dataset || dataset.schema_version !== "ohlc-dataset/v1") throw new SelectiveReplayError("INVALID_DATASET", "1m dataset must use ohlc-dataset/v1");
  if (!dataset.frozen_view || !dataset.complete_view || dataset.truncated || !dataset.formal_research_eligible) {
    throw new SelectiveReplayError("DATASET_NOT_ELIGIBLE", "1m replay requires complete formal frozen dataset");
  }
  if (dataset.provenance?.market !== "tw-stock" || dataset.provenance?.timeframe !== "1m") {
    throw new SelectiveReplayError("INVALID_DATASET", "selective replay requires tw-stock 1m dataset");
  }
  if (String(dataset.provenance?.symbol ?? "") !== original.symbol) throw new SelectiveReplayError("SYMBOL_MISMATCH", "1m dataset symbol differs from original 5m result");
  if (Number(dataset.row_count) !== rows.length || Number(dataset.total_validated_rows) !== rows.length) {
    throw new SelectiveReplayError("DATASET_ROW_COUNT_MISMATCH", "bars_1m must be the exact complete frozen dataset view");
  }
  if (`sha256:${dataset.dataset_hash}` !== dataset.dataset_version || !/^[0-9a-f]{64}$/.test(String(dataset.dataset_hash ?? ""))) {
    throw new SelectiveReplayError("INVALID_DATASET_VERSION", "1m dataset version/hash mismatch");
  }
  if (!rows.length) throw new SelectiveReplayError("DATASET_EMPTY", "1m bars are empty");
  let previous = -Infinity;
  const seen = new Set<number>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (String(row.symbol) !== original.symbol) throw new SelectiveReplayError("SYMBOL_MISMATCH", `bars_1m[${i}] symbol mismatch`);
    const ts = finite(row.ts_ms, `bars_1m[${i}].ts_ms`);
    if (seen.has(ts)) throw new SelectiveReplayError("DUPLICATE_BAR", `duplicate 1m ts ${ts}`);
    if (ts <= previous) throw new SelectiveReplayError("UNSORTED_BARS", "1m bars must be strictly chronological");
    seen.add(ts); previous = ts;
    const o = positive(row.open, `bars_1m[${i}].open`);
    const h = positive(row.high, `bars_1m[${i}].high`);
    const l = positive(row.low, `bars_1m[${i}].low`);
    const c = positive(row.close, `bars_1m[${i}].close`);
    const v = finite(row.volume, `bars_1m[${i}].volume`);
    if (v < 0 || h < Math.max(o, l, c) || l > Math.min(o, h, c)) throw new SelectiveReplayError("INVALID_OHLC", `bars_1m[${i}] invalid OHLCV`);
  }
}

export async function resolveAmbiguousBacktestWith1m(input: SelectiveReplayInput) {
  const original = input?.original_5m_result;
  if (!original || original.status !== "OK" || !original.deterministic) throw new SelectiveReplayError("INVALID_5M_RESULT", "original deterministic 5m result is required");
  if (!original.ambiguous_intrabar || !original.requires_1m_replay || original.intrabar_status !== "AMBIGUOUS_INTRABAR") {
    throw new SelectiveReplayError("REPLAY_NOT_REQUIRED", "P6 only accepts 5m results explicitly marked for selective 1m replay");
  }
  if (original.conservative_resolution !== "STOP_FIRST" || original.exit_reason !== "STOP") {
    throw new SelectiveReplayError("INVALID_5M_RESULT", "ambiguous 5m baseline must retain conservative STOP_FIRST result");
  }
  const rows = Array.isArray(input?.bars_1m) ? input.bars_1m : [];
  validateDataset(input.dataset_1m, rows, original);
  const recomputed = await recomputeDatasetHash(input.dataset_1m, rows);
  if (recomputed !== input.dataset_1m.dataset_hash) {
    throw new SelectiveReplayError("DATASET_VERSION_MISMATCH", "1m bars/source provenance do not reproduce dataset_hash", { expected: input.dataset_1m.dataset_hash, recomputed });
  }

  const bucketStart = finite(original.exit_ts_ms, "original_5m_result.exit_ts_ms");
  const bucketEnd = bucketStart + 5 * 60_000;
  const date = resultTradeDate(original);
  const bucket = rows.filter((row) => {
    const ts = Number(row.ts_ms);
    return ts >= bucketStart && ts < bucketEnd && (!date || tradeDateOf(row) === date);
  });
  if (!bucket.length) throw new SelectiveReplayError("REPLAY_BUCKET_NOT_FOUND", "1m dataset contains no bars in ambiguous 5m bucket", { bucket_start_ts_ms: bucketStart, bucket_end_exclusive_ts_ms: bucketEnd });

  const stop = positive(original.stop_price, "stop_price");
  const target = positive(original.target_price, "target_price");
  const isLong = original.side === "LONG";
  let resolution: "STOP" | "TARGET" | "AMBIGUOUS_1M" | null = null;
  let resolutionBar: Intraday1mBar | null = null;

  for (const row of bucket) {
    const high = positive(row.high, "1m.high");
    const low = positive(row.low, "1m.low");
    const stopTouched = isLong ? low <= stop : high >= stop;
    const targetTouched = isLong ? high >= target : low <= target;
    if (stopTouched && targetTouched) { resolution = "AMBIGUOUS_1M"; resolutionBar = row; break; }
    if (stopTouched) { resolution = "STOP"; resolutionBar = row; break; }
    if (targetTouched) { resolution = "TARGET"; resolutionBar = row; break; }
  }

  if (!resolution || !resolutionBar) {
    throw new SelectiveReplayError("REPLAY_INCONSISTENT_WITH_5M", "1m bars did not reproduce either stop or target touch inside a 5m bar that was marked ambiguous", { backtest_run_id: original.backtest_run_id, bucket_start_ts_ms: bucketStart });
  }

  const resolvedExitReason = resolution === "TARGET" ? "TARGET" : "STOP";
  const resolvedExitPrice = resolution === "TARGET" ? target : stop;
  const dir = original.side === "LONG" ? 1 : -1;
  const gross = ((resolvedExitPrice - original.entry_price) / original.entry_price) * dir * 100;
  const net = gross - original.cost_pct;
  const replayIdentity = {
    schema_version: SELECTIVE_1M_REPLAY_SCHEMA_VERSION,
    engine_version: SELECTIVE_1M_REPLAY_ENGINE_VERSION,
    original_backtest_run_id: original.backtest_run_id,
    original_dataset_version_5m: original.dataset_version,
    dataset_version_1m: input.dataset_1m.dataset_version,
    resolution,
    resolution_ts_ms: Number(resolutionBar.ts_ms),
    resolved_exit_price: resolvedExitPrice,
  };
  const replayHash = await sha256Hex(stableJson(replayIdentity));

  return {
    ok: true as const,
    deterministic: true as const,
    schema_version: SELECTIVE_1M_REPLAY_SCHEMA_VERSION,
    engine_version: SELECTIVE_1M_REPLAY_ENGINE_VERSION,
    replay_run_id: `replay1m:${replayHash}`,
    original_5m: {
      backtest_run_id: original.backtest_run_id,
      dataset_id: original.dataset_id,
      dataset_version: original.dataset_version,
      dataset_hash: original.dataset_hash,
      conservative_exit_reason: original.exit_reason,
      conservative_exit_price: original.exit_price,
      conservative_net_return_pct: original.net_return_pct,
      preserved: true,
    },
    dataset_1m: {
      dataset_id: input.dataset_1m.dataset_id,
      dataset_version: input.dataset_1m.dataset_version,
      dataset_hash: input.dataset_1m.dataset_hash,
    },
    symbol: original.symbol,
    side: original.side,
    ambiguous_5m_bucket_start_ts_ms: bucketStart,
    ambiguous_5m_bucket_end_exclusive_ts_ms: bucketEnd,
    resolution_1m: resolution,
    resolution_ts_ms: Number(resolutionBar.ts_ms),
    resolution_bar_time_tw: String(resolutionBar.bar_time_tw ?? ""),
    resolved_exit_reason: resolvedExitReason,
    resolved_exit_price: resolvedExitPrice,
    resolved_gross_return_pct: Math.round(gross * 1e8) / 1e8,
    cost_pct: original.cost_pct,
    resolved_net_return_pct: Math.round(net * 1e8) / 1e8,
    still_ambiguous_at_1m: resolution === "AMBIGUOUS_1M",
    conservative_if_still_ambiguous: resolution === "AMBIGUOUS_1M" ? "STOP_FIRST" : null,
    provenance: {
      original_backtest_run_id: original.backtest_run_id,
      signal_id: original.signal_id,
      signal_version: original.signal_version,
      dataset_version_5m: original.dataset_version,
      dataset_version_1m: input.dataset_1m.dataset_version,
      backtester_version: original.engine_version,
      replay_version: SELECTIVE_1M_REPLAY_ENGINE_VERSION,
      parameter_version: original.parameter_version,
    },
  };
}
