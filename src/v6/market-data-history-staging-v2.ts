import {
  atomicUpdateGitHubJsonFiles,
  estimateAtomicJsonTransactionSubrequests,
} from "./github-atomic-json.ts";
import {
  GitHubDataStoreError,
  readGitHubJson,
  stableJson,
} from "./github-data-store.ts";
import {
  HISTORY_V2_DAILY_STAGE_VERSION,
  HISTORY_V2_MONTH_CAPTURE_VERSION,
  HISTORY_V2_PREFIXES,
  historyV2DailyStagePath,
  historyV2MonthCapturePath,
  type HistoryV2Manifest,
} from "./market-data-history-builder-v2.ts";
import { EXPECTED_MARKET_DATA_LAYERS, type MarketManifestLayer } from "./market-data-incremental-controller.ts";
import type { TwMarketDataKind } from "./tw-market-data.ts";

export { historyV2DailyStagePath } from "./market-data-history-builder-v2.ts";

export const HISTORY_V2_DAILY_STAGE_PROGRESS_VERSION = "diamond-market-data-history-daily-stage-progress/v2";
export const HISTORY_V2_STAGE_MAX_PREFIXES_PER_WAKE = 3;
export const HISTORY_V2_STAGE_MIN_REMAINING_MS = 14_000;
export const HISTORY_V2_STAGE_ATOMIC_MIN_REMAINING_MS = 8_000;

const HISTORY_V2_STAGE_SNAPSHOT_READS = 8;
const HISTORY_V2_STAGE_METADATA_READS = 2; // month catalog + per-day progress
const HISTORY_V2_STAGE_CALLER_HEADROOM = 2; // backfill state + daily manifest reads

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

type HistoryV2DailyStageProgress = {
  schema_version: typeof HISTORY_V2_DAILY_STAGE_PROGRESS_VERSION;
  trade_date: string;
  month: string;
  status: "STAGING" | "READY";
  completed_prefixes: string[];
  updated_at: string;
};

function assertTradeDate(value: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid_history_v2_trade_date:${value}`);
}

function monthOf(tradeDate: string) {
  assertTradeDate(tradeDate);
  return tradeDate.slice(0, 7);
}

export function historyV2DailyStageProgressPath(tradeDate: string) {
  assertTradeDate(tradeDate);
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/history-v2/daily/${year}/${month}/${day}/stage.json`;
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

function normalizePrefixes(values: unknown) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(String))]
    .filter((prefix) => HISTORY_V2_PREFIXES.includes(prefix as any))
    .sort();
}

function stageShards(
  tradeDate: string,
  layers: MarketManifestLayer[],
  snapshotReads: Array<{ value: { rows?: any[] } | null }>,
  selectedPrefixes: string[],
) {
  const month = monthOf(tradeDate);
  const selected = new Set(selectedPrefixes);
  const datasetVersions = layers
    .map((layer) => String(layer.dataset_version ?? ""))
    .filter(Boolean)
    .sort();
  const shards = new Map<string, HistoryV2DailyPrefix>();
  for (const prefix of selectedPrefixes) {
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
      if (!selected.has(prefix)) continue;
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

function atomicStageCost(prefixCount: number, completesDay: boolean) {
  // N prefix files + one progress checkpoint; final batch also atomically adds
  // the month capture catalog so readers never observe a catalogued partial day.
  const files = prefixCount + 1 + (completesDay ? 1 : 0);
  return estimateAtomicJsonTransactionSubrequests(files);
}

function estimatedStageCost(prefixCount: number, completesDay: boolean) {
  return HISTORY_V2_STAGE_METADATA_READS
    + HISTORY_V2_STAGE_SNAPSHOT_READS
    + atomicStageCost(prefixCount, completesDay);
}

function choosePrefixBatch(input: {
  missing: string[];
  maxPrefixesPerWake: number;
  subrequestBudget: number;
}) {
  const cap = Math.max(1, Math.min(HISTORY_V2_STAGE_MAX_PREFIXES_PER_WAKE, Math.floor(input.maxPrefixesPerWake)));
  for (let count = Math.min(cap, input.missing.length); count >= 1; count--) {
    const completesDay = count === input.missing.length;
    if (estimatedStageCost(count, completesDay) + HISTORY_V2_STAGE_CALLER_HEADROOM <= input.subrequestBudget) {
      return input.missing.slice(0, count);
    }
  }
  return [];
}

function remainingMs(deadlineAtMs?: number) {
  if (!Number.isFinite(Number(deadlineAtMs))) return Number.POSITIVE_INFINITY;
  return Number(deadlineAtMs) - Date.now();
}

function progressDefault(tradeDate: string, month: string): HistoryV2DailyStageProgress {
  return {
    schema_version: HISTORY_V2_DAILY_STAGE_PROGRESS_VERSION,
    trade_date: tradeDate,
    month,
    status: "STAGING",
    completed_prefixes: [],
    updated_at: "",
  };
}

function catalogDefault(month: string): HistoryV2MonthCapture {
  return {
    schema_version: HISTORY_V2_MONTH_CAPTURE_VERSION,
    month,
    staged_trade_dates: [],
    updated_at: "",
  };
}

async function finalizeCatalogOnly(env: Env, input: {
  tradeDate: string;
  month: string;
  capturedAt: string;
  progress: HistoryV2DailyStageProgress;
}) {
  const progressPath = historyV2DailyStageProgressPath(input.tradeDate);
  const capturePath = historyV2MonthCapturePath(input.month);
  const updates: any[] = [
    {
      path: progressPath,
      defaultValue: progressDefault(input.tradeDate, input.month),
      merge: (current: HistoryV2DailyStageProgress) => ({
        ...current,
        schema_version: HISTORY_V2_DAILY_STAGE_PROGRESS_VERSION,
        trade_date: input.tradeDate,
        month: input.month,
        status: "READY" as const,
        completed_prefixes: [...HISTORY_V2_PREFIXES],
        updated_at: input.capturedAt,
      }),
    },
    {
      path: capturePath,
      defaultValue: catalogDefault(input.month),
      merge: (current: HistoryV2MonthCapture) => ({
        ...current,
        schema_version: HISTORY_V2_MONTH_CAPTURE_VERSION,
        month: input.month,
        staged_trade_dates: [...new Set([...(current.staged_trade_dates ?? []), input.tradeDate])].sort(),
        updated_at: input.capturedAt,
      }),
    },
  ];
  const atomic = await atomicUpdateGitHubJsonFiles(env, {
    message: `data(market): History V2 stage finalize ${input.tradeDate}`,
    updates,
    retries: 1,
  });
  return {
    trade_date: input.tradeDate,
    status: "HISTORY_V2_DAY_STAGED" as const,
    completed_prefixes: [...HISTORY_V2_PREFIXES],
    staged_prefixes: [] as string[],
    atomic_commit_sha: atomic.commit_sha,
    estimated_subrequests: HISTORY_V2_STAGE_METADATA_READS + estimateAtomicJsonTransactionSubrequests(updates.length),
  };
}

export async function stageHistoryDayV2(env: Env, input: {
  tradeDate: string;
  manifest: HistoryV2Manifest;
  capturedAt: string;
  deadlineAtMs?: number;
  subrequestBudget?: number;
  maxPrefixesPerWake?: number;
}) {
  const month = monthOf(input.tradeDate);
  const capturePath = historyV2MonthCapturePath(month);
  const catalogRead = await readGitHubJson<HistoryV2MonthCapture>(env, capturePath);
  if (catalogRead.value?.staged_trade_dates?.includes(input.tradeDate)) {
    return {
      trade_date: input.tradeDate,
      status: "HISTORY_V2_DAY_ALREADY_STAGED" as const,
      completed_prefixes: [...HISTORY_V2_PREFIXES],
      staged_prefixes: [] as string[],
      estimated_subrequests: 1,
    };
  }

  const progressPath = historyV2DailyStageProgressPath(input.tradeDate);
  const progressRead = await readGitHubJson<HistoryV2DailyStageProgress>(env, progressPath);
  const completedBefore = normalizePrefixes(progressRead.value?.completed_prefixes);
  const progress = progressRead.value ?? progressDefault(input.tradeDate, month);

  if (completedBefore.length === HISTORY_V2_PREFIXES.length) {
    if (remainingMs(input.deadlineAtMs) < HISTORY_V2_STAGE_ATOMIC_MIN_REMAINING_MS) {
      return {
        trade_date: input.tradeDate,
        status: "HISTORY_V2_STAGE_YIELD" as const,
        completed_prefixes: completedBefore,
        staged_prefixes: [] as string[],
        yield_reason: "INSUFFICIENT_TIME" as const,
        estimated_subrequests: HISTORY_V2_STAGE_METADATA_READS,
      };
    }
    try {
      return await finalizeCatalogOnly(env, {
        tradeDate: input.tradeDate,
        month,
        capturedAt: input.capturedAt,
        progress,
      });
    } catch (error) {
      if (error instanceof GitHubDataStoreError && error.code === "GITHUB_ATOMIC_CAS_EXHAUSTED") {
        return {
          trade_date: input.tradeDate,
          status: "HISTORY_V2_STAGE_YIELD" as const,
          completed_prefixes: completedBefore,
          staged_prefixes: [] as string[],
          yield_reason: "CAS_CONFLICT" as const,
          estimated_subrequests: HISTORY_V2_STAGE_METADATA_READS + estimateAtomicJsonTransactionSubrequests(2),
        };
      }
      throw error;
    }
  }

  if (remainingMs(input.deadlineAtMs) < HISTORY_V2_STAGE_MIN_REMAINING_MS) {
    return {
      trade_date: input.tradeDate,
      status: "HISTORY_V2_STAGE_YIELD" as const,
      completed_prefixes: completedBefore,
      staged_prefixes: [] as string[],
      yield_reason: "INSUFFICIENT_TIME" as const,
      estimated_subrequests: HISTORY_V2_STAGE_METADATA_READS,
    };
  }

  const missing = HISTORY_V2_PREFIXES.filter((prefix) => !completedBefore.includes(prefix));
  const subrequestBudget = Number.isFinite(Number(input.subrequestBudget))
    ? Math.max(0, Number(input.subrequestBudget))
    : Number.POSITIVE_INFINITY;
  const selected = choosePrefixBatch({
    missing: [...missing],
    maxPrefixesPerWake: input.maxPrefixesPerWake ?? HISTORY_V2_STAGE_MAX_PREFIXES_PER_WAKE,
    subrequestBudget,
  });
  if (!selected.length) {
    return {
      trade_date: input.tradeDate,
      status: "HISTORY_V2_STAGE_YIELD" as const,
      completed_prefixes: completedBefore,
      staged_prefixes: [] as string[],
      yield_reason: "INSUFFICIENT_SUBREQUEST_BUDGET" as const,
      estimated_subrequests: HISTORY_V2_STAGE_METADATA_READS,
    };
  }

  const layers = readyLayers(input.manifest);
  const snapshotReads = await Promise.all(
    layers.map((layer) => readGitHubJson<{ rows?: any[] }>(env, String(layer.snapshot_path))),
  );

  if (remainingMs(input.deadlineAtMs) < HISTORY_V2_STAGE_ATOMIC_MIN_REMAINING_MS) {
    return {
      trade_date: input.tradeDate,
      status: "HISTORY_V2_STAGE_YIELD" as const,
      completed_prefixes: completedBefore,
      staged_prefixes: [] as string[],
      yield_reason: "INSUFFICIENT_TIME_AFTER_SNAPSHOT_READS" as const,
      estimated_subrequests: HISTORY_V2_STAGE_METADATA_READS + HISTORY_V2_STAGE_SNAPSHOT_READS,
    };
  }

  const shards = stageShards(input.tradeDate, layers, snapshotReads, selected);
  const completedAfter = normalizePrefixes([...completedBefore, ...selected]);
  const completesDay = completedAfter.length === HISTORY_V2_PREFIXES.length;
  const updates: any[] = [];
  for (const prefix of selected) {
    const path = historyV2DailyStagePath(input.tradeDate, prefix);
    const expected = shards.get(prefix)!;
    updates.push({
      path,
      defaultValue: null,
      merge: (current: unknown) => sameOrThrow(current, expected, path),
    });
  }
  updates.push({
    path: progressPath,
    defaultValue: progressDefault(input.tradeDate, month),
    merge: (current: HistoryV2DailyStageProgress) => {
      const merged = normalizePrefixes([...(current.completed_prefixes ?? []), ...selected]);
      return {
        ...current,
        schema_version: HISTORY_V2_DAILY_STAGE_PROGRESS_VERSION,
        trade_date: input.tradeDate,
        month,
        status: merged.length === HISTORY_V2_PREFIXES.length ? "READY" as const : "STAGING" as const,
        completed_prefixes: merged,
        updated_at: input.capturedAt,
      };
    },
  });
  if (completesDay) {
    updates.push({
      path: capturePath,
      defaultValue: catalogDefault(month),
      merge: (current: HistoryV2MonthCapture) => ({
        ...current,
        schema_version: HISTORY_V2_MONTH_CAPTURE_VERSION,
        month,
        staged_trade_dates: [...new Set([...(current.staged_trade_dates ?? []), input.tradeDate])].sort(),
        updated_at: input.capturedAt,
      }),
    });
  }

  try {
    const atomic = await atomicUpdateGitHubJsonFiles(env, {
      message: completesDay
        ? `data(market): History V2 stage ${input.tradeDate}`
        : `data(market): History V2 stage ${input.tradeDate} ${selected.join(",")}`,
      updates,
      retries: 1,
    });
    return {
      trade_date: input.tradeDate,
      status: completesDay ? "HISTORY_V2_DAY_STAGED" as const : "HISTORY_V2_STAGE_PROGRESS" as const,
      completed_prefixes: completedAfter,
      staged_prefixes: selected,
      atomic_commit_sha: atomic.commit_sha,
      estimated_subrequests: estimatedStageCost(selected.length, completesDay),
    };
  } catch (error) {
    if (error instanceof GitHubDataStoreError && error.code === "GITHUB_ATOMIC_CAS_EXHAUSTED") {
      return {
        trade_date: input.tradeDate,
        status: "HISTORY_V2_STAGE_YIELD" as const,
        completed_prefixes: completedBefore,
        staged_prefixes: [] as string[],
        yield_reason: "CAS_CONFLICT" as const,
        estimated_subrequests: estimatedStageCost(selected.length, completesDay),
      };
    }
    throw error;
  }
}
