import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BacktestInputError,
  DEFAULT_INTRADAY_5M_PARAMETERS,
  DETERMINISTIC_BACKTEST_ENGINE_VERSION,
  runDeterministicIntraday5mBacktest,
  type FrozenDatasetManifest,
  type Intraday5mBar,
} from "../src/v6/deterministic-backtester.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });

const COLUMNS = [
  "symbol", "bar_time_tw", "ts_ms", "open", "high", "low", "close", "volume",
  "source", "updated_at_ms", "ema_5", "ema_10", "ema_20", "rsi_14", "macd",
  "macd_signal", "macd_hist", "updated_at", "day_volume_total", "vol_slope",
  "real_body_ratio", "upper_wick_ratio", "lower_wick_ratio", "k_9", "d_3",
] as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableValue(source[key]);
    return out;
  }
  if (value === undefined) return null;
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function canonicalSourceFiles(files: FrozenDatasetManifest["source_files"]) {
  return (files ?? []).map((file) => ({
    path: String(file.path ?? ""),
    sha: String(file.sha ?? ""),
    trade_date: file.trade_date ? String(file.trade_date) : null,
    year: Number.isFinite(Number(file.year)) ? Number(file.year) : null,
  })).filter((file) => file.path || file.sha)
    .sort((a, b) => `${a.path}|${a.sha}`.localeCompare(`${b.path}|${b.sha}`));
}

function canonicalRows(bars: Intraday5mBar[]) {
  return bars.map((row) => COLUMNS.map((key) => {
    const value = row[key];
    if (value === undefined || value === null) return "";
    return typeof value === "number" ? (Number.isFinite(value) ? value : String(value)) : String(value);
  }));
}

async function frozenDataset(bars: Intraday5mBar[]): Promise<FrozenDatasetManifest> {
  const sourceFiles = [{
    path: "data/OHLC/tw/5m/2026/07/14/2330.csv",
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    trade_date: "2026-07-14",
    year: null,
  }];
  const first = String(Number(bars[0].ts_ms));
  const last = String(Number(bars.at(-1)!.ts_ms));
  const fingerprint = {
    schema_version: "ohlc-dataset/v1",
    market: "tw-stock",
    symbol: "2330",
    timeframe: "5m",
    source: "github_historical",
    columns: [...COLUMNS],
    source_files: canonicalSourceFiles(sourceFiles),
    scope: { first, last, row_count: bars.length },
    rows: canonicalRows(bars),
  };
  const hash = await sha256Hex(JSON.stringify(stableValue(fingerprint)));
  return {
    schema_version: "ohlc-dataset/v1",
    dataset_id: `tw-stock:2330:5m:${first}:${last}:${bars.length}`,
    dataset_version: `sha256:${hash}`,
    dataset_hash: hash,
    hash_algorithm: "SHA-256",
    frozen_view: true,
    complete_view: true,
    truncated: false,
    formal_research_eligible: true,
    row_count: bars.length,
    total_validated_rows: bars.length,
    first,
    last,
    source: "github_historical",
    source_files: sourceFiles,
    provenance: {
      market: "tw-stock",
      symbol: "2330",
      timeframe: "5m",
      source: "github_historical",
      quality_gate: "PASS",
      quality_status_code: "OK",
    },
  };
}

const BASE_TS = 1783990800000;
function bar(index: number, values: { open?: number; high?: number; low?: number; close?: number; day?: string } = {}): Intraday5mBar {
  const day = values.day ?? "2026-07-14";
  const open = values.open ?? 100;
  const high = values.high ?? 100.4;
  const low = values.low ?? 99.6;
  const close = values.close ?? 100;
  const ts = BASE_TS + index * 300_000 + (day === "2026-07-15" ? 86_400_000 : 0);
  return {
    symbol: "2330",
    bar_time_tw: `${day} ${String(9 + Math.floor((index * 5) / 60)).padStart(2, "0")}:${String((index * 5) % 60).padStart(2, "0")}:00+08:00`,
    ts_ms: String(ts),
    open: String(open), high: String(high), low: String(low), close: String(close), volume: "1000",
    source: "fugle_intraday_5m", updated_at_ms: "1784017098832",
    ema_5: "100", ema_10: "100", ema_20: "100", rsi_14: "50", macd: "0",
    macd_signal: "0", macd_hist: "0", updated_at: "2026-07-14T08:00:00.000Z",
    day_volume_total: "1000", vol_slope: "0", real_body_ratio: "0.1",
    upper_wick_ratio: "0.1", lower_wick_ratio: "0.1", k_9: "50", d_3: "50",
  };
}

function signal(side: "LONG" | "SHORT" = "LONG") {
  return {
    signal_id: `sig-${side.toLowerCase()}-001`,
    signal_version: "V55-test",
    symbol: "2330",
    side,
    signal_ts_ms: BASE_TS + 60_000,
    atr: 1,
    strategy: "golden-test",
    event: "unit",
  } as const;
}

// Golden case A: next-bar-open entry, target on second held bar, round-trip cost 0.04%.
{
  const bars = [
    bar(0),
    bar(1, { open: 100, high: 101.0, low: 99.5, close: 100.5 }),
    bar(2, { open: 100.5, high: 101.6, low: 99.8, close: 101.2 }),
  ];
  const dataset = await frozenDataset(bars);
  const input = { dataset, bars, signal: signal("LONG") };
  const a = await runDeterministicIntraday5mBacktest(input);
  const b = await runDeterministicIntraday5mBacktest(input);
  assert.deepEqual(a, b, "same Signal + Dataset + Parameters + Engine must be byte-stable as an object");
  assert.equal(a.engine_version, DETERMINISTIC_BACKTEST_ENGINE_VERSION);
  assert.equal(a.entry_ts_ms, Number(bars[1].ts_ms));
  assert.equal(a.entry_price, 100);
  assert.equal(a.stop_price, 99);
  assert.equal(a.target_price, 101.5);
  assert.equal(a.exit_reason, "TARGET");
  assert.equal(a.exit_price, 101.5);
  assert.equal(a.bars_held, 2);
  assert.equal(a.gross_return_pct, 1.5);
  assert.equal(a.cost_pct, 0.04);
  assert.equal(a.net_return_pct, 1.46);
  assert.equal(a.ambiguous_intrabar, false);
  assert.equal(a.requires_1m_replay, false);
  assert.match(a.backtest_run_id, /^bt:[0-9a-f]{64}$/);
  assert.match(a.parameter_version, /^sha256:[0-9a-f]{64}$/);
}

// Golden case B: same 5m bar touches stop and target => conservative STOP + selective 1m replay marker.
{
  const bars = [bar(0), bar(1, { open: 100, high: 102, low: 98, close: 101 })];
  const dataset = await frozenDataset(bars);
  const result = await runDeterministicIntraday5mBacktest({ dataset, bars, signal: signal("LONG") });
  assert.equal(result.exit_reason, "STOP");
  assert.equal(result.exit_price, 99);
  assert.equal(result.ambiguous_intrabar, true);
  assert.equal(result.intrabar_status, "AMBIGUOUS_INTRABAR");
  assert.equal(result.conservative_resolution, "STOP_FIRST");
  assert.equal(result.requires_1m_replay, true);
}

// Golden case C: short direction has mirrored stop/target logic.
{
  const bars = [bar(0), bar(1, { open: 100, high: 100.4, low: 98.4, close: 98.8 })];
  const dataset = await frozenDataset(bars);
  const result = await runDeterministicIntraday5mBacktest({ dataset, bars, signal: signal("SHORT") });
  assert.equal(result.stop_price, 101);
  assert.equal(result.target_price, 98.5);
  assert.equal(result.exit_reason, "TARGET");
  assert.equal(result.gross_return_pct, 1.5);
  assert.equal(result.net_return_pct, 1.46);
}

// Golden case D: exactly 12 bars cap; no hidden continuation.
{
  const bars = Array.from({ length: 14 }, (_, i) => bar(i, { close: 100.1 }));
  const dataset = await frozenDataset(bars);
  const result = await runDeterministicIntraday5mBacktest({ dataset, bars, signal: signal("LONG") });
  assert.equal(result.bars_held, 12);
  assert.equal(result.exit_reason, "MAX_BARS");
  assert.equal(result.exit_ts_ms, Number(bars[12].ts_ms));
}

// Golden case E: EOD beats carrying a Taiwan intraday trade into the next date.
{
  const bars = [bar(0), bar(1, { close: 100.2 }), bar(2, { close: 100.3 }), bar(3, { day: "2026-07-15", close: 100.4 })];
  const dataset = await frozenDataset(bars);
  const result = await runDeterministicIntraday5mBacktest({ dataset, bars, signal: signal("LONG") });
  assert.equal(result.exit_reason, "EOD");
  assert.equal(result.bars_held, 2);
  assert.equal(result.exit_ts_ms, Number(bars[2].ts_ms));
}

// Fail closed: changed bar content cannot be paired with an old dataset version.
{
  const bars = [bar(0), bar(1)];
  const dataset = await frozenDataset(bars);
  const tampered = bars.map((x) => ({ ...x }));
  tampered[1].close = "100.2";
  await assert.rejects(
    runDeterministicIntraday5mBacktest({ dataset, bars: tampered, signal: signal("LONG") }),
    (error: unknown) => error instanceof BacktestInputError && error.code === "DATASET_VERSION_MISMATCH",
  );
}

// Fail closed: truncated/non-formal research views are never accepted.
{
  const bars = [bar(0), bar(1)];
  const dataset = await frozenDataset(bars);
  const invalid = { ...dataset, complete_view: false, truncated: true, formal_research_eligible: false };
  await assert.rejects(
    runDeterministicIntraday5mBacktest({ dataset: invalid, bars, signal: signal("LONG") }),
    (error: unknown) => error instanceof BacktestInputError && error.code === "DATASET_INCOMPLETE_VIEW",
  );
}

// Static contract gates for the official Diamond MCP boundary.
{
  const toolSource = await readFile(new URL("../src/v6/deterministic-backtest-tool.ts", import.meta.url), "utf8");
  const engineSource = await readFile(new URL("../src/v6/deterministic-backtester.ts", import.meta.url), "utf8");
  assert.match(toolSource, /NO_NEXT_BAR_SAME_DAY/);
  assert.match(toolSource, /signal\.trade_date/);
  assert.match(toolSource, /run_deterministic_intraday_backtest_5m/);
  assert.match(toolSource, /P6_SELECTIVE_1M_REPLAY_REQUIRED/);
  assert.doesNotMatch(engineSource, /\bfetch\s*\(/, "pure backtester must never fetch market data");
  assert.doesNotMatch(engineSource, /Date\.now\s*\(/, "pure backtester must never read current time");
  assert.doesNotMatch(engineSource, /new Date\s*\(/, "pure backtester must not derive behavior from runtime clock/date parsing");
}

// Baseline parameters remain the adopted formal rules.
assert.deepEqual(DEFAULT_INTRADAY_5M_PARAMETERS, {
  parameter_schema_version: "intraday-5m-parameters/v1",
  entry_rule: "NEXT_BAR_OPEN",
  stop_atr: 1,
  target_atr: 1.5,
  max_bars: 12,
  cost_rate_round_trip: 0.0004,
  tie_break: "STOP_FIRST",
  end_of_day_exit: true,
});

console.log("Deterministic 5m backtester golden/regression tests passed.");
