import {
  atomicUpdateGitHubJsonFiles,
  estimateAtomicJsonTransactionSubrequests,
} from "./github-atomic-json.ts";
import {
  GitHubDataStoreError,
  readGitHubJson,
  stableJson,
} from "./github-data-store.ts";
import { EXPECTED_MARKET_DATA_LAYERS, type MarketManifestLayer } from "./market-data-incremental-controller.ts";
import type { MarketDataBackfillState } from "./market-data-backfill-policy.ts";
import type { TwMarketDataKind } from "./tw-market-data.ts";

export const HISTORY_BUILDER_V2_VERSION = "diamond-market-data-history-builder/v2";
export const HISTORY_V2_DAILY_STAGE_VERSION = "diamond-market-data-history-daily-prefix/v2";
export const HISTORY_V2_MONTH_CAPTURE_VERSION = "diamond-market-data-history-month-capture/v2";
export const HISTORY_V2_MONTH_BUILD_VERSION = "diamond-market-data-history-month-build/v2";
export const HISTORY_V2_PREFIXES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const HISTORY_V2_MANIFEST_FINALIZE_BATCH = 4;

const HISTORY_V2_STAGE_SNAPSHOT_READS = 8;
const HISTORY_V2_STAGE_ATOMIC_FILES = 11;

export type HistoryV2Manifest = {
  layers?: MarketManifestLayer[];
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  index_state?: {
    status?: string;
    completed_prefixes?: string[];
    total_prefixes?: number | null;
    updated_at?: string;
  };
  [key: string]: unknown;
};

type HistoryV2DailyPrefix = {
  schema_version: typeof HISTORY_V2_DAILY_STAGE_VERSION;
  trade_date: string;
  month: string;
  prefix: string;
  source_dataset_versions: string[];
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
};

type HistoryV2MonthCapture = {
  schema_version: typeof HISTORY_V2_MONTH_CAPTURE_VERSION;
  month: string;
  staged_trade_dates: string[];
  updated_at: string;
};

type HistoryV2MonthBuild = {
  schema_version: typeof HISTORY_V2_MONTH_BUILD_VERSION;
  month: string;
  status: "BUILDING" | "FINALIZING" | "READY";
  range_start: string;
  range_end: string;
  staged_trade_dates: string[];
  completed_prefixes: string[];
  finalized_trade_dates: string[];
  updated_at: string;
};

type SymbolMonthShard = {
  schema_version: "diamond-market-data-symbol-shard/v2";
  month: string;
  prefix: string;
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at: string;
};

function assertTradeDate(value: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid_history_v2_trade_date:${value}`);
}

function monthOf(tradeDate: string) {
  assertTradeDate(tradeDate);
  return tradeDate.slice(0, 7);
}

function manifestPath(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

function finalShardPath(month: string, prefix: string) {
  const [year, mm] = month.split("-");
  return `data/market-data/index/${year}/${mm}/${prefix}.json`;
}

export function historyV2DailyStagePath(tradeDate: string, prefix: string) {
  assertTradeDate(tradeDate);
  if (!HISTORY_V2_PREFIXES.includes(prefix as any)) throw new Error(`invalid_history_v2_prefix:${prefix}`);
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/history-v2/daily/${year}/${month}/${day}/${prefix}.json`;
}

export function historyV2MonthCapturePath(month: string) {
  return `data/market-data/history-v2/months/${month}/capture.json`;
}

export function historyV2MonthBuildPath(month: string) {
  return `data/market-data/history-v2/months/${month}/build.json`;
}

function readyLayers(manifest: HistoryV2Manifest) {
  const layers = (manifest.layers ?? []).filter((layer) => layer.status === "READY" && layer.snapshot_path);
  if (manifest.terminal !== true || manifest.day_status !== "COMPLETE" || layers.length !== EXPECTED_MARKET_DATA_LAYERS.length) {
    throw new GitHubDataStoreError(
      "HISTORY_V2_DAY_NOT_COMPLETE",
      "History Builder V2 staging requires a terminal COMPLETE 8-layer day",
      undefined,
      { trade_date: manifest.trade_date, ready_layers: layers.length, day_status: manifest.day_status, terminal: manifest.terminal },
    );
  }
  return layers;
}

function stageShards(
  tradeDate: string,
  layers: MarketManifestLayer[],
  snapshotReads: Array<{ value: { rows?: any[] } | null }>,
) {
  const month = monthOf(tradeDate);
  const datasetVersions = layers
    .map((layer) => String(layer.dataset_version ?? ""))
    .filter(Boolean)
    .sort();
  const shards = new Map<string, HistoryV2DailyPrefix>();
  for (const prefix of HISTORY_V2_PREFIXES) {
    shards.set(prefix, {
      schema_version: HISTORY_V2_DAILY_STAGE_VERSION,
      trade_date: tradeDate,
      month,
      prefix,
      source_dataset_versions: datasetVersions,
      symbols: {},
    });
  }

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const rows = Array.isArray(snapshotReads[i].value?.rows) ? snapshotReads[i].value!.rows! : [];
    for (const row of rows) {
      const symbol = String(row?.symbol ?? "");
      if (!/^\d{4,6}$/.test(symbol)) continue;
      const prefix = symbol[0];
      const shard = shards.get(prefix);
      if (!shard) continue;
      const symbolState = { ...(shard.symbols[symbol] ?? {}) };
      const kind = layer.kind as TwMarketDataKind;
      const kindRows = Array.isArray(symbolState[kind]) ? [...symbolState[kind]!] : [];
      kindRows.push(row);
      kindRows.sort((a: any, b: any) => {
        const marketCompare = String(a?.market ?? "").localeCompare(String(b?.market ?? ""));
        return marketCompare || stableJson(a).localeCompare(stableJson(b));
      });
      symbolState[kind] = kindRows;
      shard.symbols[symbol] = symbolState;
    }
  }
  return shards;
}

function sameOrThrow(current: unknown, expected: unknown, path: string) {
  if (current === null) return expected;
  if (stableJson(current) === stableJson(expected)) return current;
  throw new GitHubDataStoreError(
    "HISTORY_V2_STAGE_CONFLICT",
    "immutable History Builder V2 daily staging content differs from canonical source",
    409,
    { path },
  );
}

export async function stageHistoryDayV2(env: Env, input: {
  tradeDate: string;
  manifest: HistoryV2Manifest;
  capturedAt: string;
}) {
  const month = monthOf(input.tradeDate);
  const capturePath = historyV2MonthCapturePath(month);
  const catalogRead = await readGitHubJson<HistoryV2MonthCapture>(env, capturePath);
  if (catalogRead.value?.staged_trade_dates?.includes(input.tradeDate)) {
    return {
      trade_date: input.tradeDate,
      status: "HISTORY_V2_DAY_ALREADY_STAGED" as const,
      prefixes: HISTORY_V2_PREFIXES.length,
      estimated_subrequests: 1,
    };
  }

  const layers = readyLayers(input.manifest);
  const snapshotReads = await Promise.all(
    layers.map((layer) => readGitHubJson<{ rows?: any[] }>(env, String(layer.snapshot_path))),
  );
  const shards = stageShards(input.tradeDate, layers, snapshotReads);
  const updates: any[] = [];
  for (const prefix of HISTORY_V2_PREFIXES) {
    const path = historyV2DailyStagePath(input.tradeDate, prefix);
    const expected = shards.get(prefix)!;
    updates.push({
      path,
      defaultValue: null,
      merge: (current: unknown) => sameOrThrow(current, expected, path),
    });
  }
  updates.push({
    path: capturePath,
    defaultValue: {
      schema_version: HISTORY_V2_MONTH_CAPTURE_VERSION,
      month,
      staged_trade_dates: [],
      updated_at: "",
    } satisfies HistoryV2MonthCapture,
    merge: (current: HistoryV2MonthCapture) => {
      if (current.staged_trade_dates?.includes(input.tradeDate)) return current;
      const staged = [...new Set([...(current.staged_trade_dates ?? []), input.tradeDate])].sort();
      return {
        schema_version: HISTORY_V2_MONTH_CAPTURE_VERSION,
        month,
        staged_trade_dates: staged,
        updated_at: input.capturedAt,
      };
    },
  });

  try {
    const atomic = await atomicUpdateGitHubJsonFiles(env, {
      message: `data(market): History V2 stage ${input.tradeDate}`,
      updates,
      retries: 1,
    });
    return {
      trade_date: input.tradeDate,
      status: atomic.idempotent ? "HISTORY_V2_DAY_ALREADY_STAGED" as const : "HISTORY_V2_DAY_STAGED" as const,
      prefixes: HISTORY_V2_PREFIXES.length,
      atomic_commit_sha: atomic.commit_sha,
      estimated_subrequests: 1 + HISTORY_V2_STAGE_SNAPSHOT_READS + estimateAtomicJsonTransactionSubrequests(HISTORY_V2_STAGE_ATOMIC_FILES),
    };
  } catch (error) {
    if (error instanceof GitHubDataStoreError && error.code === "GITHUB_ATOMIC_CAS_EXHAUSTED") {
      return {
        trade_date: input.tradeDate,
        status: "HISTORY_V2_STAGE_YIELD" as const,
        prefixes: 0,
        yield_reason: "CAS_CONFLICT" as const,
        estimated_subrequests: 1 + HISTORY_V2_STAGE_SNAPSHOT_READS + estimateAtomicJsonTransactionSubrequests(HISTORY_V2_STAGE_ATOMIC_FILES),
      };
    }
    throw error;
  }
}

function isoDate(value: string) {
  assertTradeDate(value);
  return new Date(`${value}T00:00:00Z`);
}

function monthBounds(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const mm = Number(monthText);
  const start = new Date(Date.UTC(year, mm - 1, 1));
  const end = new Date(Date.UTC(year, mm, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function requiredMonths(state: MarketDataBackfillState) {
  const target = isoDate(state.target_start_date);
  const anchor = isoDate(state.anchor_trade_date);
  const cursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const first = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1));
  const out: string[] = [];
  while (cursor >= first) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return out;
}

function buildRange(state: MarketDataBackfillState, month: string) {
  const bounds = monthBounds(month);
  return {
    start: bounds.start < state.target_start_date ? state.target_start_date : bounds.start,
    end: bounds.end > state.anchor_trade_date ? state.anchor_trade_date : bounds.end,
  };
}

function defaultBuild(month: string, state: MarketDataBackfillState, stagedDates: string[], capturedAt: string): HistoryV2MonthBuild {
  const range = buildRange(state, month);
  return {
    schema_version: HISTORY_V2_MONTH_BUILD_VERSION,
    month,
    status: "BUILDING",
    range_start: range.start,
    range_end: range.end,
    staged_trade_dates: [...stagedDates].sort(),
    completed_prefixes: [],
    finalized_trade_dates: [],
    updated_at: capturedAt,
  };
}

function removeStagedDates(current: SymbolMonthShard, stagedDates: Set<string>, capturedAt: string) {
  const symbols: SymbolMonthShard["symbols"] = {};
  for (const [symbol, kinds] of Object.entries(current.symbols ?? {})) {
    const nextKinds: Partial<Record<TwMarketDataKind, any[]>> = {};
    for (const [kind, rows] of Object.entries(kinds ?? {})) {
      if (!Array.isArray(rows)) continue;
      const kept = rows.filter((row: any) => !stagedDates.has(String(row?.trade_date ?? "")));
      if (kept.length) (nextKinds as any)[kind] = kept;
    }
    if (Object.keys(nextKinds).length) symbols[symbol] = nextKinds;
  }
  return {
    ...current,
    symbols,
    updated_at: capturedAt,
  } satisfies SymbolMonthShard;
}

function mergeDailyPrefixIntoMonth(
  current: SymbolMonthShard,
  month: string,
  prefix: string,
  stages: HistoryV2DailyPrefix[],
  capturedAt: string,
) {
  const stagedDates = new Set(stages.map((stage) => stage.trade_date));
  const base = removeStagedDates(current, stagedDates, capturedAt);
  const symbols = { ...(base.symbols ?? {}) };
  for (const stage of stages) {
    if (stage.schema_version !== HISTORY_V2_DAILY_STAGE_VERSION || stage.month !== month || stage.prefix !== prefix) {
      throw new GitHubDataStoreError("HISTORY_V2_STAGE_IDENTITY_INVALID", "History V2 stage identity mismatch", undefined, {
        month,
        prefix,
        stage_month: stage.month,
        stage_prefix: stage.prefix,
        trade_date: stage.trade_date,
      });
    }
    for (const [symbol, kinds] of Object.entries(stage.symbols ?? {})) {
      const symbolState = { ...(symbols[symbol] ?? {}) };
      for (const [kind, rows] of Object.entries(kinds ?? {})) {
        if (!Array.isArray(rows)) continue;
        const previous = Array.isArray((symbolState as any)[kind]) ? [...(symbolState as any)[kind]] : [];
        (symbolState as any)[kind] = [...previous, ...rows]
          .sort((a: any, b: any) => String(a?.trade_date ?? "").localeCompare(String(b?.trade_date ?? "")) || String(a?.market ?? "").localeCompare(String(b?.market ?? "")));
      }
      symbols[symbol] = symbolState;
    }
  }
  return {
    schema_version: "diamond-market-data-symbol-shard/v2",
    month,
    prefix,
    symbols,
    updated_at: capturedAt,
  } satisfies SymbolMonthShard;
}

function filteredStagedDates(capture: HistoryV2MonthCapture, state: MarketDataBackfillState, month: string) {
  const range = buildRange(state, month);
  return [...new Set(capture.staged_trade_dates ?? [])]
    .filter((date) => date >= range.start && date <= range.end)
    .sort();
}

async function buildOnePrefix(env: Env, input: {
  state: MarketDataBackfillState;
  month: string;
  capture: HistoryV2MonthCapture;
  build: HistoryV2MonthBuild | null;
  prefix: string;
  capturedAt: string;
}) {
  const stagedDates = filteredStagedDates(input.capture, input.state, input.month);
  const stageReads = await Promise.all(stagedDates.map(async (date) => {
    const path = historyV2DailyStagePath(date, input.prefix);
    const read = await readGitHubJson<HistoryV2DailyPrefix>(env, path);
    if (!read.value) {
      throw new GitHubDataStoreError("HISTORY_V2_STAGE_MISSING", "History V2 month build is missing a catalogued daily prefix", 404, {
        month: input.month,
        prefix: input.prefix,
        trade_date: date,
        path,
      });
    }
    return read.value;
  }));

  const buildPath = historyV2MonthBuildPath(input.month);
  try {
    const atomic = await atomicUpdateGitHubJsonFiles(env, {
      message: `data(market): History V2 month ${input.month} prefix ${input.prefix}`,
      retries: 1,
      updates: [
        {
          path: finalShardPath(input.month, input.prefix),
          defaultValue: {
            schema_version: "diamond-market-data-symbol-shard/v2",
            month: input.month,
            prefix: input.prefix,
            symbols: {},
            updated_at: "",
          } satisfies SymbolMonthShard,
          merge: (current: any) => mergeDailyPrefixIntoMonth(current as SymbolMonthShard, input.month, input.prefix, stageReads, input.capturedAt),
        },
        {
          path: buildPath,
          defaultValue: defaultBuild(input.month, input.state, stagedDates, input.capturedAt),
          merge: (current: any) => {
            const typed = current as HistoryV2MonthBuild;
            const completed = [...new Set([...(typed.completed_prefixes ?? []), input.prefix])]
              .filter((prefix) => HISTORY_V2_PREFIXES.includes(prefix as any))
              .sort();
            return {
              ...typed,
              schema_version: HISTORY_V2_MONTH_BUILD_VERSION,
              month: input.month,
              staged_trade_dates: stagedDates,
              completed_prefixes: completed,
              status: completed.length === HISTORY_V2_PREFIXES.length ? "FINALIZING" : "BUILDING",
              updated_at: input.capturedAt,
            } satisfies HistoryV2MonthBuild;
          },
        },
      ],
    });
    return {
      status: "HISTORY_V2_MONTH_PREFIX_BUILT" as const,
      month: input.month,
      prefix: input.prefix,
      staged_trade_dates: stagedDates.length,
      atomic_commit_sha: atomic.commit_sha,
      estimated_subrequests: stagedDates.length + estimateAtomicJsonTransactionSubrequests(2),
    };
  } catch (error) {
    if (error instanceof GitHubDataStoreError && error.code === "GITHUB_ATOMIC_CAS_EXHAUSTED") {
      return {
        status: "HISTORY_V2_BUILD_YIELD" as const,
        month: input.month,
        prefix: input.prefix,
        yield_reason: "CAS_CONFLICT" as const,
        estimated_subrequests: stagedDates.length + estimateAtomicJsonTransactionSubrequests(2),
      };
    }
    throw error;
  }
}

async function finalizeManifestBatch(env: Env, input: {
  state: MarketDataBackfillState;
  month: string;
  capture: HistoryV2MonthCapture;
  build: HistoryV2MonthBuild;
  capturedAt: string;
}) {
  const stagedDates = filteredStagedDates(input.capture, input.state, input.month);
  const finalized = new Set(input.build.finalized_trade_dates ?? []);
  const batch = stagedDates.filter((date) => !finalized.has(date)).slice(0, HISTORY_V2_MANIFEST_FINALIZE_BATCH);
  const buildPath = historyV2MonthBuildPath(input.month);

  if (!batch.length) {
    const atomic = await atomicUpdateGitHubJsonFiles(env, {
      message: `data(market): History V2 month ready ${input.month}`,
      retries: 1,
      updates: [{
        path: buildPath,
        defaultValue: input.build,
        merge: (current: any) => ({ ...(current as HistoryV2MonthBuild), status: "READY" as const, updated_at: input.capturedAt }),
      }],
    });
    return {
      status: "HISTORY_V2_MONTH_READY" as const,
      month: input.month,
      finalized_trade_dates: finalized.size,
      atomic_commit_sha: atomic.commit_sha,
      estimated_subrequests: estimateAtomicJsonTransactionSubrequests(1),
    };
  }

  const updates: any[] = batch.map((tradeDate) => ({
    path: manifestPath(tradeDate),
    defaultValue: null,
    merge: (current: HistoryV2Manifest | null) => {
      if (!current || current.terminal !== true || current.day_status !== "COMPLETE") {
        throw new GitHubDataStoreError("HISTORY_V2_MANIFEST_FINALIZE_INVALID", "History V2 cannot finalize a non-terminal day", undefined, { trade_date: tradeDate });
      }
      return {
        ...current,
        index_state: {
          status: "READY",
          completed_prefixes: [...HISTORY_V2_PREFIXES],
          total_prefixes: HISTORY_V2_PREFIXES.length,
          updated_at: input.capturedAt,
        },
        updated_at: input.capturedAt,
      };
    },
  }));
  updates.push({
    path: buildPath,
    defaultValue: input.build,
    merge: (current: HistoryV2MonthBuild) => {
      const merged = [...new Set([...(current.finalized_trade_dates ?? []), ...batch])].sort();
      const done = stagedDates.every((date) => merged.includes(date));
      return {
        ...current,
        finalized_trade_dates: merged,
        status: done ? "READY" as const : "FINALIZING" as const,
        updated_at: input.capturedAt,
      };
    },
  });

  try {
    const atomic = await atomicUpdateGitHubJsonFiles(env, {
      message: `data(market): History V2 finalize ${input.month} ${batch.join(",")}`,
      retries: 1,
      updates,
    });
    const done = stagedDates.every((date) => finalized.has(date) || batch.includes(date));
    return {
      status: done ? "HISTORY_V2_MONTH_READY" as const : "HISTORY_V2_MANIFEST_PROGRESS" as const,
      month: input.month,
      finalized_trade_dates: finalized.size + batch.length,
      total_trade_dates: stagedDates.length,
      atomic_commit_sha: atomic.commit_sha,
      estimated_subrequests: estimateAtomicJsonTransactionSubrequests(updates.length),
    };
  } catch (error) {
    if (error instanceof GitHubDataStoreError && error.code === "GITHUB_ATOMIC_CAS_EXHAUSTED") {
      return {
        status: "HISTORY_V2_BUILD_YIELD" as const,
        month: input.month,
        yield_reason: "CAS_CONFLICT" as const,
        estimated_subrequests: estimateAtomicJsonTransactionSubrequests(updates.length),
      };
    }
    throw error;
  }
}

export async function runHistoryMonthBuildV2(env: Env, input: {
  state: MarketDataBackfillState;
  capturedAt: string;
}) {
  if (input.state.phase !== "BUILD") {
    return { status: "HISTORY_V2_BUILD_WAITING_CAPTURE" as const, estimated_subrequests: 0 };
  }

  let reads = 0;
  for (const month of requiredMonths(input.state)) {
    const captureRead = await readGitHubJson<HistoryV2MonthCapture>(env, historyV2MonthCapturePath(month));
    reads += 1;
    const capture = captureRead.value;
    if (!capture || capture.schema_version !== HISTORY_V2_MONTH_CAPTURE_VERSION || !capture.staged_trade_dates?.length) {
      return {
        status: "HISTORY_V2_BUILD_WAITING_MONTH_CAPTURE" as const,
        month,
        estimated_subrequests: reads,
      };
    }

    const buildRead = await readGitHubJson<HistoryV2MonthBuild>(env, historyV2MonthBuildPath(month));
    reads += 1;
    const stagedDates = filteredStagedDates(capture, input.state, month);
    const build = buildRead.value;
    if (build?.status === "READY") continue;

    const completed = new Set(build?.completed_prefixes ?? []);
    const prefix = HISTORY_V2_PREFIXES.find((candidate) => !completed.has(candidate));
    if (prefix) {
      const result = await buildOnePrefix(env, {
        state: input.state,
        month,
        capture,
        build,
        prefix,
        capturedAt: input.capturedAt,
      });
      return { ...result, estimated_subrequests: reads + result.estimated_subrequests };
    }

    const effectiveBuild = build ?? defaultBuild(month, input.state, stagedDates, input.capturedAt);
    const result = await finalizeManifestBatch(env, {
      state: input.state,
      month,
      capture,
      build: effectiveBuild,
      capturedAt: input.capturedAt,
    });
    return { ...result, estimated_subrequests: reads + result.estimated_subrequests };
  }

  return {
    status: "HISTORY_V2_ALL_MONTHS_READY" as const,
    builder: HISTORY_BUILDER_V2_VERSION,
    estimated_subrequests: reads,
  };
}
