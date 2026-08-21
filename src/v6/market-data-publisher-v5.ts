import {
  readGitHubJson,
  sha256Hex,
  stableJson,
  updateGitHubJson,
} from "./github-data-store.ts";
import {
  atomicUpdateGitHubJsonFiles,
  estimateAtomicJsonTransactionSubrequests,
} from "./github-atomic-json.ts";
import type { MarketDataBackfillState } from "./market-data-backfill-policy.ts";
import {
  MARKET_DATA_BACKFILL_STATE_PATH,
  shouldWaitForHistoryMonth,
} from "./market-data-publish-history-fence.ts";
import {
  buildMarketReadGeneration,
  canonicalMarketReadManifestProjection,
  marketReadPublishedGenerationManifestPath,
  marketReadPublishedPointerPath,
  marketReadPublishStatePath,
  validateMarketReadPublishPrerequisites,
  type MarketReadGenerationManifestV5,
  type MarketReadManifest,
  type MarketReadPrefixReference,
  type MarketReadPublishedPointer,
  type MarketReadPublishState,
} from "./market-data-publish-fence.ts";
import type { TwMarketDataKind } from "./tw-market-data.ts";

export const MARKET_DATA_PUBLISHER_VERSION = "diamond-market-data-publisher/v3-generation-manifest";
export const MARKET_DATA_PUBLISH_DEADLINE_GUARD_MS = 2_500;
// Worst-case fixed cost reserves exact canonical reads, eight snapshot reads,
// one atomic state+generation-manifest transaction, and final pointer CAS.
export const MARKET_DATA_PUBLISH_FIXED_SUBREQUESTS = 22;
export const MARKET_DATA_PUBLISH_PER_PREFIX_SUBREQUESTS = 1;

const MARKET_DATA_KINDS: TwMarketDataKind[] = [
  "institutional",
  "margin",
  "securities_lending",
  "sbl_short_sale",
];

type SymbolMonthShardV2 = {
  schema_version: "diamond-market-data-symbol-shard/v2";
  month: string;
  prefix: string;
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at: string;
};

type Snapshot = { rows?: any[] };
type ExpectedEntry = { kind: TwMarketDataKind; row: any };

function manifestPath(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

function sourceShardPath(tradeDate: string, prefix: string) {
  const [year, month] = tradeDate.split("-");
  return `data/market-data/index/${year}/${month}/${prefix}.json`;
}

function rowKey(symbol: string, kind: TwMarketDataKind) {
  return `${symbol}:${kind}`;
}

function exactRowEqual(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

function auditMaterializedPrefix(input: {
  source: SymbolMonthShardV2;
  prefix: string;
  tradeDate: string;
  expected: Map<string, ExpectedEntry>;
}) {
  const { source, prefix, tradeDate, expected } = input;
  if (source.schema_version !== "diamond-market-data-symbol-shard/v2") throw new Error(`source_shard_schema:${prefix}`);
  if (source.prefix !== prefix) throw new Error(`source_shard_prefix:${prefix}`);
  if (source.month !== tradeDate.slice(0, 7)) throw new Error(`source_shard_month:${prefix}`);
  if (!expected.size) throw new Error(`canonical_prefix_empty:${prefix}`);

  const actual = new Map<string, { kind: TwMarketDataKind; row: any }>();
  for (const [symbol, state] of Object.entries(source.symbols ?? {})) {
    if (!symbol.startsWith(prefix)) throw new Error(`source_shard_symbol_prefix:${prefix}:${symbol}`);
    for (const kind of MARKET_DATA_KINDS) {
      const rows = Array.isArray(state?.[kind]) ? state[kind]! : [];
      const currentRows = rows.filter((row: any) => String(row?.trade_date ?? "") === tradeDate);
      if (currentRows.length > 1) throw new Error(`source_shard_duplicate_trade_date:${prefix}:${symbol}:${kind}`);
      if (!currentRows.length) continue;
      const key = rowKey(symbol, kind);
      if (actual.has(key)) throw new Error(`source_shard_duplicate_key:${prefix}:${key}`);
      actual.set(key, { kind, row: currentRows[0] });
    }
  }

  if (actual.size !== expected.size) {
    throw new Error(`source_shard_row_count:${prefix}:expected_${expected.size}:actual_${actual.size}`);
  }
  for (const [key, expectedEntry] of expected) {
    const actualEntry = actual.get(key);
    if (!actualEntry) throw new Error(`source_shard_missing_row:${prefix}:${key}`);
    if (actualEntry.kind !== expectedEntry.kind || !exactRowEqual(actualEntry.row, expectedEntry.row)) {
      throw new Error(`source_shard_row_mismatch:${prefix}:${key}`);
    }
  }
}

async function canonicalContext(manifest: MarketReadManifest) {
  const { trade_date, prefixes } = validateMarketReadPublishPrerequisites(manifest);
  const projection = canonicalMarketReadManifestProjection(manifest);
  const sourceManifestSha = await sha256Hex(stableJson(projection));
  const generation = buildMarketReadGeneration(trade_date, sourceManifestSha);
  return { tradeDate: trade_date, prefixes, sourceManifestSha, generation };
}

async function expectedRowsForPrefixes(
  env: Env,
  manifest: MarketReadManifest,
  tradeDate: string,
  prefixes: string[],
) {
  const selected = new Set(prefixes);
  const layers = manifest.layers ?? [];
  const reads = await Promise.all(layers.map((layer) => readGitHubJson<Snapshot>(env, String(layer.snapshot_path))));
  const out = new Map<string, Map<string, ExpectedEntry>>();
  for (const prefix of prefixes) out.set(prefix, new Map());

  for (let i = 0; i < layers.length; i++) {
    const kind = layers[i].kind as TwMarketDataKind;
    if (!MARKET_DATA_KINDS.includes(kind)) throw new Error(`publisher_unknown_kind:${kind}`);
    const rows = Array.isArray(reads[i].value?.rows) ? reads[i].value!.rows! : [];
    for (const row of rows) {
      const symbol = String(row?.symbol ?? "");
      if (!/^\d{4,6}$/.test(symbol) || String(row?.trade_date ?? "") !== tradeDate) continue;
      const prefix = symbol.slice(0, 2);
      if (!selected.has(prefix)) continue;
      const bucket = out.get(prefix)!;
      const key = rowKey(symbol, kind);
      if (bucket.has(key)) throw new Error(`canonical_duplicate_row:${prefix}:${key}`);
      bucket.set(key, { kind, row });
    }
  }
  return out;
}

async function ensurePublishedPointer(
  env: Env,
  input: {
    tradeDate: string;
    generation: string;
    sourceManifestSha: string;
    prefixCount: number;
    publishedAt: string;
  },
) {
  return await updateGitHubJson<MarketReadPublishedPointer | null>(env, {
    path: marketReadPublishedPointerPath(),
    defaultValue: null,
    message: `data(market): publish ${input.tradeDate}`,
    retries: 3,
    merge: (current) => {
      if (current?.generation === input.generation) return current;
      return {
        schema_version: "diamond-market-data-published-pointer/v1",
        trade_date: input.tradeDate,
        generation: input.generation,
        source_manifest_sha: input.sourceManifestSha,
        prefix_count: input.prefixCount,
        published_at: input.publishedAt,
        previous_generation: current?.generation ?? null,
      };
    },
  });
}

export function adaptiveMarketDataPublishCapacity(input: {
  pendingPrefixes: number;
  subrequestBudget: number;
  nowMs: number;
  deadlineAtMs: number;
}) {
  if (input.pendingPrefixes <= 0) return 0;
  if (input.nowMs >= input.deadlineAtMs - MARKET_DATA_PUBLISH_DEADLINE_GUARD_MS) return 0;
  const remaining = Math.max(0, Math.floor(input.subrequestBudget) - MARKET_DATA_PUBLISH_FIXED_SUBREQUESTS);
  return Math.max(
    0,
    Math.min(input.pendingPrefixes, Math.floor(remaining / MARKET_DATA_PUBLISH_PER_PREFIX_SUBREQUESTS)),
  );
}

function cleanReferences(
  references: Record<string, MarketReadPrefixReference> | undefined,
  allowedPrefixes: string[],
) {
  const allowed = new Set(allowedPrefixes);
  return Object.fromEntries(
    Object.entries(references ?? {})
      .filter(([prefix]) => allowed.has(prefix))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function buildGenerationManifest(input: {
  tradeDate: string;
  generation: string;
  sourceManifestSha: string;
  prefixes: string[];
  references: Record<string, MarketReadPrefixReference>;
  createdAt: string;
}): MarketReadGenerationManifestV5 {
  const refs = Object.fromEntries(input.prefixes.map((prefix) => {
    const reference = input.references[prefix];
    if (!reference) throw new Error(`publisher_reference_missing:${prefix}`);
    return [prefix, reference];
  }));
  return {
    schema_version: "diamond-market-data-generation-ref/v5",
    month: input.tradeDate.slice(0, 7),
    trade_date: input.tradeDate,
    generation: input.generation,
    source_manifest_sha: input.sourceManifestSha,
    audit_status: "PASS",
    prefix_count: input.prefixes.length,
    prefixes: refs,
    created_at: input.createdAt,
  };
}

export async function runMarketDataPublisher(
  env: Env,
  input: {
    tradeDate: string;
    now?: Date;
    deadlineAtMs?: number;
    subrequestBudget?: number;
  },
) {
  const tradeDate = input.tradeDate;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error(`invalid trade date: ${tradeDate}`);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();
  const deadlineAtMs = input.deadlineAtMs ?? (Date.now() + 30_000);
  const subrequestBudget = Math.max(0, Math.floor(input.subrequestBudget ?? 42));

  const manifestRead = await readGitHubJson<MarketReadManifest>(env, manifestPath(tradeDate));
  const manifest = manifestRead.value;
  if (!manifest) return { trade_date: tradeDate, status: "PUBLISH_WAITING_MANIFEST" as const, estimated_subrequests: 1 };
  if (manifest.day_status === "NO_TRADING_DAY" && manifest.terminal === true) {
    return { trade_date: tradeDate, status: "PUBLISH_NO_TRADING_DAY" as const, estimated_subrequests: 1 };
  }
  if (manifest.day_status !== "COMPLETE" || manifest.terminal !== true || manifest.ready_layers !== 8) {
    return {
      trade_date: tradeDate,
      status: "PUBLISH_WAITING_CANONICAL" as const,
      day_status: manifest.day_status ?? null,
      ready_layers: manifest.ready_layers ?? null,
      estimated_subrequests: 1,
    };
  }
  if (manifest.index_state?.status !== "READY") {
    return {
      trade_date: tradeDate,
      status: "PUBLISH_WAITING_INDEX" as const,
      index_status: manifest.index_state?.status ?? null,
      completed_prefixes: manifest.index_state?.completed_prefixes?.length ?? 0,
      total_prefixes: manifest.index_state?.total_prefixes ?? null,
      estimated_subrequests: 1,
    };
  }

  const backfillRead = await readGitHubJson<MarketDataBackfillState>(env, MARKET_DATA_BACKFILL_STATE_PATH);
  if (shouldWaitForHistoryMonth(backfillRead.value, tradeDate)) {
    return {
      trade_date: tradeDate,
      status: "PUBLISH_WAITING_HISTORY_MONTH" as const,
      history_cursor_date: backfillRead.value?.cursor_date ?? null,
      history_status: backfillRead.value?.status ?? null,
      estimated_subrequests: 2,
    };
  }

  const context = await canonicalContext(manifest);
  if (context.tradeDate !== tradeDate) throw new Error("publisher_manifest_trade_date_mismatch");
  const statePath = marketReadPublishStatePath(tradeDate);
  const stateRead = await readGitHubJson<MarketReadPublishState>(env, statePath);
  const reusableState = stateRead.value?.schema_version === "diamond-market-data-publish-state/v2-reference"
    && stateRead.value.generation === context.generation;
  const existingReferences = reusableState
    ? cleanReferences(stateRead.value?.references, context.prefixes)
    : {};
  const completed = new Set(Object.keys(existingReferences));
  const pending = context.prefixes.filter((prefix) => !completed.has(prefix));
  const capacity = adaptiveMarketDataPublishCapacity({
    pendingPrefixes: pending.length,
    subrequestBudget,
    nowMs: Date.now(),
    deadlineAtMs,
  });

  if (pending.length > 0 && capacity === 0) {
    return {
      trade_date: tradeDate,
      status: "PUBLISH_YIELD" as const,
      generation: context.generation,
      published_prefixes: completed.size,
      total_prefixes: context.prefixes.length,
      remaining_prefixes: pending.length,
      estimated_subrequests: 3,
      adaptive_capacity: 0,
      storage: "GENERATION_MANIFEST_V5" as const,
    };
  }

  const selected = pending.slice(0, capacity);
  const newReferences: Record<string, MarketReadPrefixReference> = {};
  if (selected.length) {
    const expectedByPrefix = await expectedRowsForPrefixes(env, manifest, tradeDate, selected);
    for (const prefix of selected) {
      const sourceRead = await readGitHubJson<SymbolMonthShardV2>(env, sourceShardPath(tradeDate, prefix));
      if (!sourceRead.value) throw new Error(`publisher_source_shard_missing:${prefix}`);
      if (!sourceRead.sha || !/^[0-9a-f]{40}$/i.test(sourceRead.sha)) throw new Error(`publisher_source_blob_sha_invalid:${prefix}`);
      const expected = expectedByPrefix.get(prefix) ?? new Map<string, ExpectedEntry>();
      auditMaterializedPrefix({ source: sourceRead.value, prefix, tradeDate, expected });
      newReferences[prefix] = {
        source_path: sourceRead.path,
        source_blob_sha: sourceRead.sha,
        source_logical_sha256: await sha256Hex(stableJson(sourceRead.value)),
      };
    }
  }

  const plannedReferences = { ...existingReferences, ...newReferences };
  const plannedCompleted = context.prefixes.filter((prefix) => Boolean(plannedReferences[prefix]));
  const plannedReady = plannedCompleted.length === context.prefixes.length;
  const generationManifestPath = marketReadPublishedGenerationManifestPath(tradeDate, context.generation);
  const plannedManifest = plannedReady
    ? buildGenerationManifest({
        tradeDate,
        generation: context.generation,
        sourceManifestSha: context.sourceManifestSha,
        prefixes: context.prefixes,
        references: plannedReferences,
        createdAt: updatedAt,
      })
    : null;

  const atomicUpdates: Array<{ path: string; defaultValue: any; merge: (current: any) => any }> = [
    {
      path: statePath,
      defaultValue: {
        schema_version: "diamond-market-data-publish-state/v2-reference",
        trade_date: tradeDate,
        generation: context.generation,
        source_manifest_sha: context.sourceManifestSha,
        status: "PENDING",
        completed_prefixes: [],
        total_prefixes: context.prefixes.length,
        references: {},
        updated_at: updatedAt,
      } satisfies MarketReadPublishState,
      merge: (current: MarketReadPublishState) => {
        const same = current?.schema_version === "diamond-market-data-publish-state/v2-reference"
          && current.generation === context.generation;
        const baseReferences = same ? cleanReferences(current.references, context.prefixes) : {};
        for (const [prefix, reference] of Object.entries(newReferences)) {
          const existing = baseReferences[prefix];
          if (existing && stableJson(existing) !== stableJson(reference)) {
            throw new Error(`publisher_reference_conflict:${prefix}`);
          }
          baseReferences[prefix] = reference;
        }
        const completedPrefixes = context.prefixes.filter((prefix) => Boolean(baseReferences[prefix]));
        return {
          schema_version: "diamond-market-data-publish-state/v2-reference",
          trade_date: tradeDate,
          generation: context.generation,
          source_manifest_sha: context.sourceManifestSha,
          status: completedPrefixes.length === context.prefixes.length ? "READY" : "PENDING",
          completed_prefixes: completedPrefixes,
          total_prefixes: context.prefixes.length,
          references: baseReferences,
          updated_at: updatedAt,
        } satisfies MarketReadPublishState;
      },
    },
  ];

  if (plannedManifest) {
    atomicUpdates.push({
      path: generationManifestPath,
      defaultValue: null,
      merge: (current) => {
        if (current === null) return plannedManifest;
        if (stableJson(current) !== stableJson(plannedManifest)) {
          throw new Error("published_generation_manifest_immutable_conflict");
        }
        return current;
      },
    });
  }

  const atomic = await atomicUpdateGitHubJsonFiles(env, {
    message: `data(market): publish generation refs ${tradeDate} ${selected.join(",") || "finalize"}`,
    updates: atomicUpdates,
    retries: 3,
  });

  const estimatedSubrequests = 3
    + (selected.length ? 8 + selected.length : 0)
    + estimateAtomicJsonTransactionSubrequests(atomicUpdates.length)
    + (plannedReady ? 2 : 0);

  if (plannedReady) {
    const pointerWrite = await ensurePublishedPointer(env, {
      tradeDate,
      generation: context.generation,
      sourceManifestSha: context.sourceManifestSha,
      prefixCount: context.prefixes.length,
      publishedAt: updatedAt,
    });
    return {
      trade_date: tradeDate,
      status: "PUBLISHED" as const,
      generation: context.generation,
      source_manifest_sha: context.sourceManifestSha,
      published_prefixes: plannedCompleted.length,
      total_prefixes: context.prefixes.length,
      pointer_sha: pointerWrite.sha,
      generation_manifest_path: generationManifestPath,
      atomic_commit_sha: atomic.commit_sha,
      estimated_subrequests: estimatedSubrequests,
      adaptive_capacity: capacity,
      storage: "GENERATION_MANIFEST_V5" as const,
    };
  }

  return {
    trade_date: tradeDate,
    status: "PUBLISH_PROGRESS" as const,
    generation: context.generation,
    source_manifest_sha: context.sourceManifestSha,
    published_prefixes: plannedCompleted.length,
    total_prefixes: context.prefixes.length,
    published_this_run: selected.length,
    remaining_prefixes: context.prefixes.length - plannedCompleted.length,
    atomic_commit_sha: atomic.commit_sha,
    estimated_subrequests: estimatedSubrequests,
    adaptive_capacity: capacity,
    storage: "GENERATION_MANIFEST_V5" as const,
  };
}
