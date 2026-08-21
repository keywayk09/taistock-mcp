import { readGitHubJson } from "./github-data-store.ts";
import {
  atomicUpdateGitHubJsonFiles,
  estimateAtomicJsonTransactionSubrequests,
} from "./github-atomic-json.ts";
import { EXPECTED_MARKET_DATA_LAYERS, type MarketManifestLayer } from "./market-data-incremental-controller.ts";
import type { TwMarketDataKind } from "./tw-market-data.ts";

export const HISTORY_INDEX_SNAPSHOT_READ_SUBREQUESTS = 8;
export const HISTORY_INDEX_DEADLINE_GUARD_MS = 2_500;
// One atomic transaction updates N prefix files plus the manifest. The fixed
// transaction cost is: branch ref + parent commit + manifest read/write + tree
// + commit + ref CAS. Each additional prefix costs one exact-ref read + blob.
export const HISTORY_INDEX_ATOMIC_FIXED_SUBREQUESTS = 15;
export const HISTORY_INDEX_PREFIX_ATOMIC_SUBREQUESTS = 2;

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

export function adaptiveHistoryIndexCapacity(input: {
  pendingPrefixes: number;
  subrequestBudget: number;
  nowMs: number;
  deadlineAtMs: number;
}) {
  if (input.pendingPrefixes <= 0) return 0;
  if (input.nowMs >= input.deadlineAtMs - HISTORY_INDEX_DEADLINE_GUARD_MS) return 0;
  const remaining = Math.max(0, Math.floor(input.subrequestBudget) - HISTORY_INDEX_ATOMIC_FIXED_SUBREQUESTS);
  return Math.max(
    0,
    Math.min(input.pendingPrefixes, Math.floor(remaining / HISTORY_INDEX_PREFIX_ATOMIC_SUBREQUESTS)),
  );
}

function buildPrefixUpdates(layers: MarketManifestLayer[], snapshotReads: Array<{ value: { rows?: any[] } | null }>) {
  const prefixUpdates = new Map<string, Array<{ kind: TwMarketDataKind; row: any }>>();
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const rows = Array.isArray(snapshotReads[i].value?.rows) ? snapshotReads[i].value!.rows! : [];
    for (const row of rows) {
      const symbol = String(row?.symbol ?? "");
      if (!/^\d{4,6}$/.test(symbol)) continue;
      const prefix = symbol.slice(0, 2);
      const list = prefixUpdates.get(prefix) ?? [];
      list.push({ kind: layer.kind as TwMarketDataKind, row });
      prefixUpdates.set(prefix, list);
    }
  }
  return prefixUpdates;
}

function mergePrefixShard(
  current: SymbolMonthShard,
  input: {
    tradeDate: string;
    prefix: string;
    updates: Array<{ kind: TwMarketDataKind; row: any }>;
    capturedAt: string;
  },
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
}) {
  const layers = (input.manifest.layers ?? []).filter((layer) => layer.status === "READY" && layer.snapshot_path);
  if (layers.length !== EXPECTED_MARKET_DATA_LAYERS.length) {
    return {
      trade_date: input.tradeDate,
      status: "INDEX_WAITING_FOR_COMPLETE_DAY" as const,
      indexed_prefixes: 0,
      estimated_subrequests: 0,
    };
  }

  if (Date.now() >= input.deadlineAtMs - HISTORY_INDEX_DEADLINE_GUARD_MS) {
    return {
      trade_date: input.tradeDate,
      status: "INDEX_YIELD" as const,
      indexed_prefixes: 0,
      estimated_subrequests: 0,
    };
  }

  const snapshotReads = await Promise.all(
    layers.map((layer) => readGitHubJson<{ rows?: any[] }>(env, String(layer.snapshot_path))),
  );
  const prefixUpdates = buildPrefixUpdates(layers, snapshotReads);
  const allPrefixes = [...prefixUpdates.keys()].sort();
  const completed = new Set(input.manifest.index_state?.completed_prefixes ?? []);
  const pending = allPrefixes.filter((prefix) => !completed.has(prefix));
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
      completed_prefixes: completed.size,
      total_prefixes: allPrefixes.length,
      remaining_prefixes: pending.length,
      estimated_subrequests: HISTORY_INDEX_SNAPSHOT_READ_SUBREQUESTS,
      adaptive_capacity: 0,
    };
  }

  const selected = pending.slice(0, capacity);
  for (const prefix of selected) completed.add(prefix);
  const remaining = allPrefixes.filter((prefix) => !completed.has(prefix));
  const indexStatus = remaining.length ? "PENDING" as const : "READY" as const;

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
    merge: (current: HistoryManifest) => ({
      ...current,
      index_state: {
        status: indexStatus,
        completed_prefixes: [...completed].sort(),
        total_prefixes: allPrefixes.length,
        updated_at: input.capturedAt,
      },
      updated_at: input.capturedAt,
    }),
  });

  const atomic = await atomicUpdateGitHubJsonFiles(env, {
    message: `data(market): history index slice ${input.tradeDate} ${selected.join(",") || "finalize"}`,
    updates,
    retries: 3,
  });

  const estimatedSubrequests = HISTORY_INDEX_SNAPSHOT_READ_SUBREQUESTS
    + estimateAtomicJsonTransactionSubrequests(updates.length);

  return {
    trade_date: input.tradeDate,
    status: indexStatus === "READY"
      ? "INDEX_COMPLETE" as const
      : selected.length > 0
        ? "INDEX_PROGRESS" as const
        : "INDEX_YIELD" as const,
    indexed_prefixes: selected.length,
    completed_prefixes: completed.size,
    total_prefixes: allPrefixes.length,
    remaining_prefixes: remaining.length,
    estimated_subrequests: estimatedSubrequests,
    adaptive_capacity: capacity,
    atomic_commit_sha: atomic.commit_sha,
    atomic_changed_paths: atomic.changed_paths.length,
  };
}
