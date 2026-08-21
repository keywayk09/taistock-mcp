export type MarketReadIndexState = {
  status: "PENDING" | "READY";
  completed_prefixes: string[];
  total_prefixes: number | null;
  updated_at?: string;
};

export type MarketReadManifestLayer = {
  kind: string;
  market: "listed" | "otc";
  status: string;
  snapshot_path?: string | null;
  dataset_version?: string | null;
  content_sha256?: string | null;
  row_count?: number | null;
};

export type MarketReadManifest = {
  schema_version?: string;
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  expected_layers?: number;
  ready_layers?: number;
  missing_layers?: string[];
  layers?: MarketReadManifestLayer[];
  index_state?: MarketReadIndexState;
};

export type MarketReadPublishedPointer = {
  schema_version: "diamond-market-data-published-pointer/v1";
  trade_date: string;
  generation: string;
  source_manifest_sha: string;
  prefix_count: number;
  published_at: string;
  previous_generation: string | null;
};

export type MarketReadEmbeddedShardReceiptV3 = {
  schema_version: "diamond-market-data-symbol-shard/v3";
  month: string;
  prefix: string;
  build_trade_date: string;
  generation: string;
  source_manifest_sha: string;
  audit_status: "PASS" | "FAIL";
  symbols: Record<string, unknown>;
  updated_at?: string;
};

export type MarketReadReferenceShardReceiptV4 = {
  schema_version: "diamond-market-data-symbol-shard-ref/v4";
  month: string;
  prefix: string;
  build_trade_date: string;
  generation: string;
  source_manifest_sha: string;
  audit_status: "PASS" | "FAIL";
  source_path: string;
  source_blob_sha: string;
  source_logical_sha256: string;
  updated_at?: string;
};

export type MarketReadShardReceipt = MarketReadEmbeddedShardReceiptV3 | MarketReadReferenceShardReceiptV4;

export type MarketReadPublishState = {
  schema_version: "diamond-market-data-publish-state/v1";
  trade_date: string;
  generation: string;
  source_manifest_sha: string;
  status: "PENDING" | "READY";
  completed_prefixes: string[];
  total_prefixes: number;
  updated_at: string;
};

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

export function buildMarketReadGeneration(tradeDate: string, manifestSha: string) {
  invariant(/^20\d{2}-\d{2}-\d{2}$/.test(tradeDate), "trade_date_invalid");
  invariant(/^[0-9a-f]{40,64}$/i.test(manifestSha), "manifest_sha_invalid");
  return `${tradeDate}:${manifestSha.toLowerCase()}`;
}

export function canonicalMarketReadManifestProjection(manifest: MarketReadManifest) {
  const layers = [...(manifest.layers ?? [])]
    .map((layer) => ({
      kind: layer.kind,
      market: layer.market,
      status: layer.status,
      snapshot_path: layer.snapshot_path ?? null,
      dataset_version: layer.dataset_version ?? null,
      content_sha256: layer.content_sha256 ?? null,
      row_count: layer.row_count ?? null,
    }))
    .sort((a, b) => `${a.kind}:${a.market}`.localeCompare(`${b.kind}:${b.market}`));
  return {
    schema_version: manifest.schema_version ?? null,
    trade_date: manifest.trade_date ?? null,
    day_status: manifest.day_status ?? null,
    terminal: manifest.terminal === true,
    expected_layers: manifest.expected_layers ?? null,
    ready_layers: manifest.ready_layers ?? null,
    missing_layers: [...(manifest.missing_layers ?? [])].sort(),
    layers,
  };
}

export function marketReadPublishedPointerPath() {
  return "data/market-data/published/latest.json";
}

export function marketReadPublishStatePath(tradeDate: string) {
  invariant(/^20\d{2}-\d{2}-\d{2}$/.test(tradeDate), "trade_date_invalid");
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/published/state/${year}/${month}/${day}.json`;
}

export function marketReadPublishedShardPath(tradeDate: string, generation: string, prefix: string) {
  invariant(/^20\d{2}-\d{2}-\d{2}$/.test(tradeDate), "trade_date_invalid");
  invariant(/^\d{2}$/.test(prefix), "prefix_invalid");
  const [generationDate, generationSha] = generation.split(":");
  invariant(generationDate === tradeDate, "generation_trade_date_mismatch");
  invariant(/^[0-9a-f]{40,64}$/i.test(generationSha ?? ""), "generation_sha_invalid");
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/published/generations/${year}/${month}/${day}/${generationSha.toLowerCase()}/${prefix}.json`;
}

export function validateMarketReadPublishPrerequisites(manifest: MarketReadManifest) {
  invariant(manifest.schema_version === "diamond-market-data-manifest/v2", "manifest_schema_invalid");
  invariant(manifest.day_status === "COMPLETE", "canonical_day_not_complete");
  invariant(manifest.terminal === true, "canonical_day_not_terminal");
  invariant(manifest.expected_layers === 8, "canonical_expected_layers_not_8");
  invariant(manifest.ready_layers === 8, "canonical_ready_layers_not_8");
  invariant(Array.isArray(manifest.missing_layers) && manifest.missing_layers.length === 0, "canonical_missing_layers");
  invariant(Array.isArray(manifest.layers) && manifest.layers.length === 8, "canonical_layer_count_invalid");
  invariant(manifest.layers.every((layer) => layer.status === "READY" && Boolean(layer.snapshot_path)), "canonical_layer_not_ready");
  const index = manifest.index_state;
  invariant(Boolean(index), "index_state_missing");
  invariant(index!.status === "READY", "index_not_ready");
  invariant(Number.isInteger(index!.total_prefixes) && Number(index!.total_prefixes) > 0, "index_prefix_total_invalid");
  invariant(Array.isArray(index!.completed_prefixes), "index_completed_prefixes_missing");
  const unique = new Set(index!.completed_prefixes);
  invariant(unique.size === index!.completed_prefixes.length, "index_completed_prefixes_duplicate");
  invariant(unique.size === index!.total_prefixes, "index_prefixes_incomplete");
  invariant(/^20\d{2}-\d{2}-\d{2}$/.test(String(manifest.trade_date ?? "")), "trade_date_invalid");
  return { trade_date: manifest.trade_date!, prefixes: [...unique].sort() };
}

export function auditPublishedShard(
  shard: MarketReadShardReceipt,
  expected: { prefix: string; trade_date: string; generation: string; manifest_sha: string },
) {
  invariant(
    shard.schema_version === "diamond-market-data-symbol-shard/v3"
      || shard.schema_version === "diamond-market-data-symbol-shard-ref/v4",
    `shard_schema_invalid:${expected.prefix}`,
  );
  invariant(shard.prefix === expected.prefix, `shard_prefix_mismatch:${expected.prefix}`);
  invariant(shard.build_trade_date === expected.trade_date, `shard_trade_date_mismatch:${expected.prefix}`);
  invariant(shard.generation === expected.generation, `shard_generation_mismatch:${expected.prefix}`);
  invariant(shard.source_manifest_sha === expected.manifest_sha, `shard_manifest_sha_mismatch:${expected.prefix}`);
  invariant(shard.audit_status === "PASS", `shard_audit_failed:${expected.prefix}`);
  if (shard.schema_version === "diamond-market-data-symbol-shard/v3") {
    invariant(Boolean(shard.symbols) && typeof shard.symbols === "object" && !Array.isArray(shard.symbols), `shard_symbols_invalid:${expected.prefix}`);
  } else {
    invariant(/^data\/market-data\/index\/20\d{2}\/\d{2}\/\d{2}\.json$/.test(shard.source_path), `shard_source_path_invalid:${expected.prefix}`);
    invariant(/^[0-9a-f]{40}$/i.test(shard.source_blob_sha), `shard_source_blob_sha_invalid:${expected.prefix}`);
    invariant(/^[0-9a-f]{64}$/i.test(shard.source_logical_sha256), `shard_source_logical_sha_invalid:${expected.prefix}`);
  }
}

export function buildPublishedPointer(input: {
  current: MarketReadPublishedPointer | null;
  manifest: MarketReadManifest;
  manifest_sha: string;
  shards: MarketReadShardReceipt[];
  published_at: string;
}): MarketReadPublishedPointer {
  const { trade_date, prefixes } = validateMarketReadPublishPrerequisites(input.manifest);
  const generation = buildMarketReadGeneration(trade_date, input.manifest_sha);
  invariant(input.shards.length === prefixes.length, "shard_count_mismatch");
  const byPrefix = new Map(input.shards.map((shard) => [shard.prefix, shard]));
  invariant(byPrefix.size === input.shards.length, "duplicate_shard_prefix");
  for (const prefix of prefixes) {
    const shard = byPrefix.get(prefix);
    invariant(Boolean(shard), `shard_missing:${prefix}`);
    auditPublishedShard(shard!, { prefix, trade_date, generation, manifest_sha: input.manifest_sha });
  }
  return {
    schema_version: "diamond-market-data-published-pointer/v1",
    trade_date,
    generation,
    source_manifest_sha: input.manifest_sha,
    prefix_count: prefixes.length,
    published_at: input.published_at,
    previous_generation: input.current?.generation ?? null,
  };
}

export function assertPublishedShard(pointer: MarketReadPublishedPointer, shard: MarketReadShardReceipt) {
  invariant(shard.generation === pointer.generation, "published_generation_mismatch");
  invariant(shard.build_trade_date === pointer.trade_date, "published_trade_date_mismatch");
  invariant(shard.source_manifest_sha === pointer.source_manifest_sha, "published_manifest_sha_mismatch");
  invariant(shard.audit_status === "PASS", "published_shard_audit_failed");
}

export function marketReadCacheKey(symbol: string, pointer: MarketReadPublishedPointer) {
  invariant(/^\d{4,6}$/.test(symbol), "symbol_invalid");
  return `market:${symbol}:${pointer.trade_date}:${pointer.generation}`;
}
