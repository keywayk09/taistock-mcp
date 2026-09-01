import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DeterministicBacktestResult, FrozenDatasetManifest } from "../src/v6/deterministic-backtester.ts";
import { resolveAmbiguousBacktestWith1m as resolveLegacyReplay } from "../src/v6/selective-1m-replay.ts";
import {
  RESEARCH_VNEXT_REPLAY_IMPLEMENTATION_VERSION,
  resolveAmbiguousBacktestEvidenceWith1m,
} from "../src/v6/research-vnext/compute/selective-1m-replay.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });

const COLUMNS = ["symbol","bar_time_tw","ts_ms","open","high","low","close","volume","source","updated_at_ms","trade_date","updated_at","ingest_id","export_batch","export_status"] as const;
const BUCKET = 1783991100000;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = stable((value as Record<string, unknown>)[key]);
    return out;
  }
  return value === undefined ? null : value;
}

async function hash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable(value))));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function bar(i: number, high: number, low: number) {
  const ts = BUCKET + i * 60_000;
  return {
    symbol: "2330",
    bar_time_tw: `2026-07-14 09:${String(5 + i).padStart(2, "0")}:00+08:00`,
    ts_ms: String(ts),
    open: "100",
    high: String(high),
    low: String(low),
    close: "100",
    volume: "100",
    source: "fugle_intraday_1m",
    updated_at_ms: "1784017000000",
    trade_date: "2026-07-14",
    updated_at: "2026-07-14T08:00:00.000Z",
    ingest_id: `2330|${ts}`,
    export_batch: "b1",
    export_status: "verified",
  };
}

async function dataset(rows: ReturnType<typeof bar>[]): Promise<FrozenDatasetManifest> {
  const sourceFiles = [{ path: "data/OHLC/tw/1m/2026/07/14/2330.csv", sha: "a".repeat(40), trade_date: "2026-07-14" }];
  const canonicalFiles = sourceFiles.map((file) => ({ path: file.path, sha: file.sha, trade_date: file.trade_date, year: null }));
  const first = String(Number(rows[0].ts_ms));
  const last = String(Number(rows.at(-1)!.ts_ms));
  const rowsCanon = rows.map((row) => COLUMNS.map((key) => String(row[key])));
  const datasetHash = await hash({
    schema_version: "ohlc-dataset/v1",
    market: "tw-stock",
    symbol: "2330",
    timeframe: "1m",
    source: "github_historical",
    columns: [...COLUMNS],
    source_files: canonicalFiles,
    scope: { first, last, row_count: rows.length },
    rows: rowsCanon,
  });
  return {
    schema_version: "ohlc-dataset/v1",
    dataset_id: `tw-stock:2330:1m:${first}:${last}:${rows.length}`,
    dataset_version: `sha256:${datasetHash}`,
    dataset_hash: datasetHash,
    frozen_view: true,
    complete_view: true,
    truncated: false,
    formal_research_eligible: true,
    row_count: rows.length,
    total_validated_rows: rows.length,
    source: "github_historical",
    source_files: sourceFiles,
    provenance: { market: "tw-stock", symbol: "2330", timeframe: "1m", source: "github_historical" },
  };
}

function original(): DeterministicBacktestResult {
  return {
    schema_version: "diamond-backtest-result/v1",
    engine_version: "diamond-intraday-5m/v1.0.0",
    backtest_run_id: "bt:" + "b".repeat(64),
    deterministic: true,
    status: "OK",
    dataset_id: "d5",
    dataset_version: "sha256:" + "c".repeat(64),
    dataset_hash: "c".repeat(64),
    signal_id: "sig1",
    signal_version: "v1",
    symbol: "2330",
    side: "LONG",
    strategy: "golden",
    event: null,
    signal_ts_ms: BUCKET - 60_000,
    parameter_version: "sha256:" + "d".repeat(64),
    parameter_hash: "d".repeat(64),
    parameters: { parameter_schema_version: "intraday-5m-parameters/v1", entry_rule: "NEXT_BAR_OPEN", stop_atr: 1, target_atr: 1.5, max_bars: 12, cost_rate_round_trip: 0.0004, tie_break: "STOP_FIRST", end_of_day_exit: true },
    atr: 1,
    entry_ts_ms: BUCKET,
    entry_bar_time_tw: "2026-07-14 09:05:00+08:00",
    entry_price: 100,
    stop_price: 99,
    target_price: 101.5,
    exit_ts_ms: BUCKET,
    exit_bar_time_tw: "2026-07-14 09:05:00+08:00",
    exit_price: 99,
    exit_reason: "STOP",
    bars_held: 1,
    gross_return_pct: -1,
    cost_pct: 0.04,
    net_return_pct: -1.04,
    mfe_pct: 2,
    mae_pct: -2,
    mfe_r: 2,
    mae_r: -2,
    ambiguous_intrabar: true,
    intrabar_status: "AMBIGUOUS_INTRABAR",
    conservative_resolution: "STOP_FIRST",
    requires_1m_replay: true,
    provenance: { dataset_id: "d5", dataset_version: "sha256:" + "c".repeat(64), dataset_hash: "c".repeat(64), signal_id: "sig1", signal_version: "v1", parameter_version: "sha256:" + "d".repeat(64), engine_version: "diamond-intraday-5m/v1.0.0" },
  };
}

async function assertSameSuccess(rows: ReturnType<typeof bar>[]) {
  const ds = await dataset(rows);
  const input = { original_5m_result: original(), dataset_1m: ds, bars_1m: rows };
  const legacy = await resolveLegacyReplay(input);
  const vnext = await resolveAmbiguousBacktestEvidenceWith1m(input);
  assert.deepEqual(vnext, legacy);
}

async function errorCode(run: () => Promise<unknown>) {
  try {
    await run();
    return "NO_ERROR";
  } catch (error) {
    return String((error as { code?: unknown })?.code ?? "UNKNOWN_ERROR");
  }
}

assert.equal(RESEARCH_VNEXT_REPLAY_IMPLEMENTATION_VERSION, "research-vnext-selective-1m-replay/v1.0.0");

await assertSameSuccess([bar(0, 101.6, 99.2), bar(1, 100.5, 98.8)]); // target first
await assertSameSuccess([bar(0, 101.0, 98.8), bar(1, 101.6, 99.5)]); // stop first
await assertSameSuccess([bar(0, 102, 98)]); // still ambiguous at 1m

{
  const rows = [bar(0, 101.0, 99.2), bar(1, 101.2, 99.1)];
  const ds = await dataset(rows);
  const input = { original_5m_result: original(), dataset_1m: ds, bars_1m: rows };
  assert.equal(await errorCode(() => resolveAmbiguousBacktestEvidenceWith1m(input)), await errorCode(() => resolveLegacyReplay(input)));
}

{
  const rows = [bar(0, 101.6, 99.2)];
  const ds = await dataset(rows);
  const tampered = rows.map((row) => ({ ...row, close: "100.1" }));
  const input = { original_5m_result: original(), dataset_1m: ds, bars_1m: tampered };
  assert.equal(await errorCode(() => resolveAmbiguousBacktestEvidenceWith1m(input)), await errorCode(() => resolveLegacyReplay(input)));
}

{
  const rows = [bar(0, 101.6, 99.2)];
  const ds = await dataset(rows);
  const noReplay = { ...original(), ambiguous_intrabar: false, requires_1m_replay: false, intrabar_status: "RESOLVED_5M" as const, conservative_resolution: null };
  const input = { original_5m_result: noReplay, dataset_1m: ds, bars_1m: rows };
  assert.equal(await errorCode(() => resolveAmbiguousBacktestEvidenceWith1m(input)), await errorCode(() => resolveLegacyReplay(input)));
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "src/v6/research-vnext/compute/selective-1m-replay.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const executableSource = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
assert.equal(/from\s+["'][^"']*selective-1m-replay[^"']*["']/.test(executableSource), false, "VNext replay must not delegate to legacy selective replay");
assert.doesNotMatch(executableSource, /\bfetch\s*\(/, "VNext replay must remain pure and provider-free");
assert.doesNotMatch(executableSource, /Date\.now\s*\(|new Date\s*\(/, "VNext replay must not depend on runtime clock");
assert.doesNotMatch(executableSource, /hypoth|observation|interpretation/i, "VNext replay executable code must not own GPT reasoning");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_REPLAY_SHADOW_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_REPLAY_IMPLEMENTATION_VERSION,
  success_cases: 3,
  error_parity_cases: 3,
  parity: "STRICT_DEEP_EQUAL_AND_ERROR_CODE_EQUAL",
  reasoning_owner: "GPT",
  production_registration: "UNCHANGED",
}, null, 2));
