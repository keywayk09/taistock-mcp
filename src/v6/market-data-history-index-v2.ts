import { GitHubDataStoreError, readGitHubJson } from "./github-data-store.ts";
import {
  atomicUpdateGitHubJsonFiles,
  estimateAtomicJsonTransactionSubrequests,
} from "./github-atomic-json.ts";
import { EXPECTED_MARKET_DATA_LAYERS, type MarketManifestLayer } from "./market-data-incremental-controller.ts";
import type { TwMarketDataKind } from "./tw-market-data.ts";

export const HISTORY_INDEX_SNAPSHOT_READ_SUBREQUESTS = 8;
export const HISTORY_INDEX_DEADLINE_GUARD_MS = 2_500;
// Universal compact index contract: both Daily and History use one-digit
// symbol shards. Legacy two-digit shards remain read-only compatibility data.
export const MARKET_DATA_DAILY_INDEX_PREFIX_LENGTH = 1;
export const MARKET_DATA_CLOSED_HISTORY_PREFIX_LENGTH = 1;

// History runs in a shared GitHub branch with other canonical writers. A branch
// head can legitimately move between our read and ref-CAS even when our files
// do not overlap. Keep each wake small enough to survive ONE full CAS retry;
// if the second attempt also collides, yield and resume from the last durable
// manifest checkpoint on the next five-minute wake instead of burning through
// the Cloudflare request budget.
export const HISTORY_INDEX_CAS_ATTEMPTS = 2;
export const HISTORY_INDEX_COORDINATOR_HEADROOM = 5;

type IndexState = {
  status: "PENDING" | "READY";
  completed_prefixes: string[];
  total_prefixes: number | null;
  updated_at: string;
};

type HistoryManifest = {
  layers?: MarketManifestLayer[];
  day_status?: string;
  terminal?: boolean;
  index_state?: IndexState;
  [key: string]: unknown;
};

type SymbolMonthShard = {
  schema_version: "diamond-market-data-symbol-shard/v2";
  month: string;
  prefix: string;
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at: string;
};

function manifestPath(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

function shardPath(tradeDate: string, prefix: string) {
  const [year, month] = tradeDate.split("-");
  return `data/market-data/index/${year}/${month}/${prefix}.json`;
}

/**
 * Worst-case request cost for one History index slice.
 *
 * Each attempt of the atomic transaction needs:
 *   branch ref + parent commit + N exact-ref reads + N blob creates
 *   + tree + commit + ref CAS = 2*N + 5 requests.
 * N includes selected prefix shards PLUS the manifest checkpoint.
 *
 * Snapshot reads happen once before the atomic transaction. We deliberately
 * reserve two atomic attempts so one unrelated branch-head movement cannot
 * turn a normal wake into an unbounded retry storm.
 */
export function estimateHistoryIndexSliceWorstCaseSubrequests(prefixCount: number) {
  const prefixes = Math.max(0, Math.floor(prefixCount));
  const atomicFiles = prefixes + 1; // prefix shards + manifest checkpoint
  return HISTORY_INDEX_SNAPSHOT_READ_SUBREQUESTS
    + HISTORY_INDEX_CAS_ATTEMPTS * estimateAtomicJsonTransactionSubrequests(atomicFiles);
}

export function adaptiveHistoryIndexCapacity(input: {
  pendingPrefixes: number;
  subrequestBudget: number;
  nowMs: number;
  deadlineAtMs: number;
}) {
  if (input.pendingPrefixes <= 0) return 0;
  if (input.nowMs >= input.deadlineAtMs - HISTORY_INDEX_DEADLINE_GUARD_MS) return 0;

  // Do not size from the happy-path transaction. Select the largest number of
  // prefixes whose TWO-attempt worst-case still fits the budget already handed
  // to this index slice by the coordinator.
  const budget = Math.max(0, Math.floor(input.subrequestBudget));
  let capacity = 0;
  for (let prefixes = 1; prefixes <= input.pendingPrefixes; prefixes++) {
    if (estimateHistoryIndexSliceWorstCaseSubrequests(prefixes) > budget) break;
    capacity = prefixes;
  }
  return capacity;
}

function buildPrefixUpdates(
  layers: MarketManifestLayer[],
  snapshotReads: Array<{ value: { rows?: any[] } | null }>,
  prefixLength: number,
) {
  const prefixUpdates = new Map<string, Array<{ kind: TwMarketDataKind; row: any }>>();
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const rows = Array.isArray(snapshotReads[i].value?.rows) ? snapshotReads[i].value!.rows! : [];
    for (const row of rows) {
      const symbol = String(row?.symbol ?? "");
      if (!/^\d{4,6}$/.test(symbol)) continue;
      const prefix = symbol.slice(0, prefixLength);
      const list = prefixUpdates.get(prefix) ?? [];
      list.push({ kind: layer.kind as TwMarketDataKind, row });
      prefixUpdates.set(prefix, list);
    }
  }
  return prefixUpdates;
}

function mergePrefixShard(
  current: SymbolMonthShard,
  input: { tradeDate: string; prefix: string; updates: Array<{ kind: TwMarketDataKind; row: any }>; capturedAt: string },
) {
  const next: SymbolMonthShard = {
    schema_version: "diamond-market-data-symbol-shard/v2",
    month: input.tradeDate.slice(0, 7),
    prefix: input.prefix,
    symbols: { ...(current.symbols ?? {}) },
    updated_at: input.capturedAt,
  };
  for (const { kind, row } of input.updates) {
    const symbol = String(row.symbol);
    const symbolState = { ...(next.symbols[symbol] ?? {}) };
    const previousRows = Array.isArray(symbolState[kind]) ? [...symbolState[kind]!] : [];
    symbolState[kind] = [...previousRows.filter((item: any) => item.trade_date !== input.tradeDate), row]
      .sort((a: any, b: any) => String(a.trade_date).localeCompare(String(b.trade_date)));
    next.symbols[symbol] = symbolState;
  }
  return next;
}

export async function runAdaptiveHistoryIndexSlice(env: Env, input: {
  tradeDate: string;
  manifest: HistoryManifest;
  capturedAt: string;
  deadlineAtMs: number;
  subrequestBudget: number;
  prefixLength?: 1 | 2;
}) {
  const prefixLength = input.prefixLength ?? MARKET_DATA_DAILY_INDEX_PREFIX_LENGTH;
  const layers = (input.manifest.layers ?? []).filter((layer) => layer.status === "READY" && layer.snapshot_path);
  if (layers.length !== EXPECTED_MARKET_DATA_LAYERS.length) {
    return { trade_date: input.tradeDate, status: "INDEX_WAITING_FOR_COMPLETE_DAY" as const, indexed_prefixes: 0, estimated_subrequests: 0 };
  }
  if (Date.now() >= input.deadlineAtMs - HISTORY_INDEX_DEADLINE_GUARD_MS) {
    return { trade_date: input.tradeDate, status: "INDEX_YIELD" as const, indexed_prefixes: 0, estimated_subrequests: 0 };
  }

  const snapshotReads = await Promise.all(layers.map((layer) => readGitHubJson<{ rows?: any[] }>(env, String(layer.snapshot_path))));
  const prefixUpdates = buildPrefixUpdates(layers, snapshotReads, prefixLength);
  const allPrefixes = [...prefixUpdates.keys()].sort();
  const validPrefixes = new Set(allPrefixes);
  // This also performs an in-place migration for manifests that previously
  // recorded two-digit prefixes: legacy entries are discarded from progress,
  // compact prefixes are rebuilt once, then future days stay compact.
  const durableCompleted = new Set(
    (input.manifest.index_state?.completed_prefixes ?? []).filter((prefix) => validPrefixes.has(prefix)),
  );
  const pending = allPrefixes.filter((prefix) => !durableCompleted.has(prefix));
  const capacity = adaptiveHistoryIndexCapacity({
    pendingPrefixes: pending.length,
    subrequestBudget: input.subrequestBudget,
    nowMs: Date.now(),
    deadlineAtMs: input.deadlineAtMs,
  });

  if (pending.length > 0 && capacity === 0) {
    return {
      trade_date: input.tradeDate,
      status: "INDEX_YIELD" as const,
      indexed_prefixes: 0,
      completed_prefixes: durableCompleted.size,
      total_prefixes: allPrefixes.length,
      remaining_prefixes: pending.length,
      estimated_subrequests: HISTORY_INDEX_SNAPSHOT_READ_SUBREQUESTS,
      adaptive_capacity: 0,
      prefix_length: prefixLength,
      yield_reason: "REQUEST_BUDGET" as const,
    };
  }

  const selected = pending.slice(0, capacity);
  const plannedCompleted = new Set(durableCompleted);
  for (const prefix of selected) plannedCompleted.add(prefix);
  const plannedRemaining = allPrefixes.filter((prefix) => !plannedCompleted.has(prefix));
  const plannedIndexStatus = plannedRemaining.length ? "PENDING" as const : "READY" as const;

  const updates: Array<{ path: string; defaultValue: any; merge: (current: any) => any }> = [];
  for (const prefix of selected) {
    const prefixRows = prefixUpdates.get(prefix) ?? [];
    updates.push({
      path: shardPath(input.tradeDate, prefix),
      defaultValue: {
        schema_version: "diamond-market-data-symbol-shard/v2",
        month: input.tradeDate.slice(0, 7),
        prefix,
        symbols: {},
        updated_at: "",
      } satisfies SymbolMonthShard,
      merge: (current: SymbolMonthShard) => mergePrefixShard(current, {
        tradeDate: input.tradeDate,
        prefix,
        updates: prefixRows,
        capturedAt: input.capturedAt,
      }),
    });
  }

  updates.push({
    path: manifestPath(input.tradeDate),
    defaultValue: input.manifest,
    // IMPORTANT: merge progress monotonically against the exact-ref manifest
    // re-read by atomicUpdateGitHubJsonFiles. On a CAS retry another wake may
    // already have completed different prefixes; union them instead of writing
    // the stale pre-attempt set and accidentally moving progress backwards.
    merge: (current: HistoryManifest) => {
      const mergedCompleted = new Set(
        (current.index_state?.completed_prefixes ?? []).filter((prefix) => validPrefixes.has(prefix)),
      );
      for (const prefix of selected) mergedCompleted.add(prefix);
      const remaining = allPrefixes.filter((prefix) => !mergedCompleted.has(prefix));
      return {
        ...current,
        index_state: {
          status: remaining.length ? "PENDING" as const : "READY" as const,
          completed_prefixes: [...mergedCompleted].sort(),
          total_prefixes: allPrefixes.length,
          updated_at: input.capturedAt,
        },
        updated_at: input.capturedAt,
      };
    },
  });

  let atomic;
  try {
    atomic = await atomicUpdateGitHubJsonFiles(env, {
      message: `data(market): compact index slice ${input.tradeDate} ${selected.join(",") || "finalize"}`,
      updates,
      retries: HISTORY_INDEX_CAS_ATTEMPTS,
    });
  } catch (error) {
    if (error instanceof GitHubDataStoreError && error.code === "GITHUB_ATOMIC_CAS_EXHAUSTED") {
      // No branch ref was advanced by the failed CAS attempts. Treat this as a
      // normal resumable yield; the next wake re-reads the durable manifest and
      // retries only the prefixes that are still missing.
      return {
        trade_date: input.tradeDate,
        status: "INDEX_YIELD" as const,
        indexed_prefixes: 0,
        completed_prefixes: durableCompleted.size,
        total_prefixes: allPrefixes.length,
        remaining_prefixes: pending.length,
        estimated_subrequests: estimateHistoryIndexSliceWorstCaseSubrequests(selected.length),
        adaptive_capacity: capacity,
        prefix_length: prefixLength,
        yield_reason: "CAS_CONFLICT" as const,
      };
    }
    throw error;
  }

  // Charge the controller for the number of attempts actually consumed. This
  // prevents a successful second CAS attempt from being followed by another
  // work unit that would unknowingly exceed the wake's remaining headroom.
  const estimatedSubrequests = HISTORY_INDEX_SNAPSHOT_READ_SUBREQUESTS
    + atomic.attempts * estimateAtomicJsonTransactionSubrequests(updates.length);

  return {
    trade_date: input.tradeDate,
    status: plannedIndexStatus === "READY"
      ? "INDEX_COMPLETE" as const
      : selected.length > 0
        ? "INDEX_PROGRESS" as const
        : "INDEX_YIELD" as const,
    indexed_prefixes: selected.length,
    completed_prefixes: plannedCompleted.size,
    total_prefixes: allPrefixes.length,
    remaining_prefixes: plannedRemaining.length,
    estimated_subrequests: estimatedSubrequests,
    adaptive_capacity: capacity,
    prefix_length: prefixLength,
    atomic_commit_sha: atomic.commit_sha,
    atomic_changed_paths: atomic.changed_paths.length,
    atomic_attempts: atomic.attempts,
  };
}
