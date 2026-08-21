import {
  readGitHubJson,
  sha256Hex,
  stableJson,
  updateGitHubJson,
} from "./github-data-store.ts";
import { atomicUpdateGitHubJsonFiles } from "./github-atomic-json.ts";
import type { MarketDataBackfillState } from "./market-data-backfill-policy.ts";
import {
  MARKET_DATA_BACKFILL_STATE_PATH,
  shouldWaitForHistoryMonth,
} from "./market-data-publish-history-fence.ts";
import {
  buildMarketReadGeneration,
  canonicalMarketReadManifestProjection,
  marketReadPublishedPointerPath,
  marketReadPublishedShardPath,
  marketReadPublishStatePath,
  validateMarketReadPublishPrerequisites,
  type MarketReadManifest,
  type MarketReadPublishedPointer,
  type MarketReadPublishState,
  type MarketReadReferenceShardReceiptV4,
} from "./market-data-publish-fence.ts";
import type { TwMarketDataKind } from "./tw-market-data.ts";

export const MARKET_DATA_PUBLISHER_VERSION = "diamond-market-data-publisher/v2-reference";
// Kept only for compatibility with callers/tests that imported the old constant.
// The scheduler may call the publisher repeatedly within one budgeted wake.
export const MARKET_DATA_PUBLISH_PREFIX_BATCH_SIZE = 5;

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

function sameReceipt(current: unknown, receipt: MarketReadReferenceShardReceiptV4) {
  return stableJson(current) === stableJson(receipt);
}

export async function runMarketDataPublisher(
  env: Env,
  input: { tradeDate: string; now?: Date },
) {
  const tradeDate = input.tradeDate;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error(`invalid trade date: ${tradeDate}`);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();
  const manifestRead = await readGitHubJson<MarketReadManifest>(env, manifestPath(tradeDate));
  const manifest = manifestRead.value;
  if (!manifest) return { trade_date: tradeDate, status: "PUBLISH_WAITING_MANIFEST" as const };
  if (manifest.day_status === "NO_TRADING_DAY" && manifest.terminal === true) {
    return { trade_date: tradeDate, status: "PUBLISH_NO_TRADING_DAY" as const };
  }
  if (manifest.day_status !== "COMPLETE" || manifest.terminal !== true || manifest.ready_layers !== 8) {
    return {
      trade_date: tradeDate,
      status: "PUBLISH_WAITING_CANONICAL" as const,
      day_status: manifest.day_status ?? null,
      ready_layers: manifest.ready_layers ?? null,
    };
  }
  if (manifest.index_state?.status !== "READY") {
    return {
      trade_date: tradeDate,
      status: "PUBLISH_WAITING_INDEX" as const,
      index_status: manifest.index_state?.status ?? null,
      completed_prefixes: manifest.index_state?.completed_prefixes?.length ?? 0,
      total_prefixes: manifest.index_state?.total_prefixes ?? null,
    };
  }

  const backfillRead = await readGitHubJson<MarketDataBackfillState>(env, MARKET_DATA_BACKFILL_STATE_PATH);
  if (shouldWaitForHistoryMonth(backfillRead.value, tradeDate)) {
    return {
      trade_date: tradeDate,
      status: "PUBLISH_WAITING_HISTORY_MONTH" as const,
      history_cursor_date: backfillRead.value?.cursor_date ?? null,
      history_status: backfillRead.value?.status ?? null,
    };
  }

  const context = await canonicalContext(manifest);
  if (context.tradeDate !== tradeDate) throw new Error("publisher_manifest_trade_date_mismatch");
  const statePath = marketReadPublishStatePath(tradeDate);
  const stateRead = await readGitHubJson<MarketReadPublishState>(env, statePath);
  const sameGeneration = stateRead.value?.generation === context.generation;
  const completed = new Set(sameGeneration ? stateRead.value?.completed_prefixes ?? [] : []);
  const pending = context.prefixes.filter((prefix) => !completed.has(prefix));
  const batch = pending.slice(0, MARKET_DATA_PUBLISH_PREFIX_BATCH_SIZE);

  const receipts = new Map<string, MarketReadReferenceShardReceiptV4>();
  if (batch.length) {
    const expectedByPrefix = await expectedRowsForPrefixes(env, manifest, tradeDate, batch);
    for (const prefix of batch) {
      const sourceRead = await readGitHubJson<SymbolMonthShardV2>(env, sourceShardPath(tradeDate, prefix));
      if (!sourceRead.value) throw new Error(`publisher_source_shard_missing:${prefix}`);
      if (!sourceRead.sha || !/^[0-9a-f]{40}$/i.test(sourceRead.sha)) throw new Error(`publisher_source_blob_sha_invalid:${prefix}`);
      const expected = expectedByPrefix.get(prefix) ?? new Map<string, ExpectedEntry>();
      auditMaterializedPrefix({ source: sourceRead.value, prefix, tradeDate, expected });

      receipts.set(prefix, {
        schema_version: "diamond-market-data-symbol-shard-ref/v4",
        month: tradeDate.slice(0, 7),
        prefix,
        build_trade_date: tradeDate,
        generation: context.generation,
        source_manifest_sha: context.sourceManifestSha,
        audit_status: "PASS",
        source_path: sourceRead.path,
        source_blob_sha: sourceRead.sha,
        source_logical_sha256: await sha256Hex(stableJson(sourceRead.value)),
      });
    }
  }

  const plannedCompleted = new Set(completed);
  for (const prefix of batch) plannedCompleted.add(prefix);
  const filteredPlanned = context.prefixes.filter((prefix) => plannedCompleted.has(prefix));
  const stateStatus = filteredPlanned.length === context.prefixes.length ? "READY" as const : "PENDING" as const;

  const atomicUpdates: Array<{
    path: string;
    defaultValue: any;
    merge: (current: any) => any;
  }> = [];

  for (const prefix of batch) {
    const receipt = receipts.get(prefix)!;
    atomicUpdates.push({
      path: marketReadPublishedShardPath(tradeDate, context.generation, prefix),
      defaultValue: null,
      merge: (current) => {
        if (current === null) return receipt;
        if (!sameReceipt(current, receipt)) throw new Error(`published_reference_immutable_conflict:${prefix}`);
        return current;
      },
    });
  }

  atomicUpdates.push({
    path: statePath,
    defaultValue: {
      schema_version: "diamond-market-data-publish-state/v1",
      trade_date: tradeDate,
      generation: context.generation,
      source_manifest_sha: context.sourceManifestSha,
      status: "PENDING",
      completed_prefixes: [],
      total_prefixes: context.prefixes.length,
      updated_at: updatedAt,
    },
    merge: (current: MarketReadPublishState) => {
      const baseCompleted = current?.generation === context.generation ? current.completed_prefixes ?? [] : [];
      const merged = new Set(baseCompleted);
      for (const prefix of batch) merged.add(prefix);
      const filtered = context.prefixes.filter((prefix) => merged.has(prefix));
      return {
        schema_version: "diamond-market-data-publish-state/v1",
        trade_date: tradeDate,
        generation: context.generation,
        source_manifest_sha: context.sourceManifestSha,
        status: filtered.length === context.prefixes.length ? "READY" : "PENDING",
        completed_prefixes: filtered,
        total_prefixes: context.prefixes.length,
        updated_at: updatedAt,
      } satisfies MarketReadPublishState;
    },
  });

  await atomicUpdateGitHubJsonFiles(env, {
    message: `data(market): publish references ${tradeDate} ${batch.join(",") || "state"}`,
    updates: atomicUpdates,
    retries: 3,
  });

  if (stateStatus === "READY") {
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
      published_prefixes: filteredPlanned.length,
      total_prefixes: context.prefixes.length,
      pointer_sha: pointerWrite.sha,
      storage: "REFERENCE_RECEIPT_V4" as const,
    };
  }

  return {
    trade_date: tradeDate,
    status: "PUBLISH_PROGRESS" as const,
    generation: context.generation,
    source_manifest_sha: context.sourceManifestSha,
    published_prefixes: filteredPlanned.length,
    total_prefixes: context.prefixes.length,
    published_this_run: batch.length,
    remaining_prefixes: context.prefixes.length - filteredPlanned.length,
    storage: "REFERENCE_RECEIPT_V4" as const,
  };
}
