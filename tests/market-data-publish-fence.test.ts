import assert from "node:assert/strict";
import {
  assertPublishedGenerationManifest,
  assertPublishedShard,
  buildMarketReadGeneration,
  buildPublishedPointer,
  marketReadCacheKey,
  type MarketReadEmbeddedShardReceiptV3,
  type MarketReadGenerationManifestV5,
  type MarketReadManifest,
  type MarketReadPublishedPointer,
  type MarketReadReferenceShardReceiptV4,
} from "../src/v6/market-data-publish-fence.ts";

const tradeDate = "2026-08-20";
const manifestSha = "a".repeat(40);
const generation = buildMarketReadGeneration(tradeDate, manifestSha);
const prefixes = ["30", "31", "32"];
const layers = [
  ["institutional", "listed"],
  ["institutional", "otc"],
  ["margin", "listed"],
  ["margin", "otc"],
  ["securities_lending", "listed"],
  ["securities_lending", "otc"],
  ["sbl_short_sale", "listed"],
  ["sbl_short_sale", "otc"],
].map(([kind, market]) => ({
  kind,
  market: market as "listed" | "otc",
  status: "READY",
  snapshot_path: `snap/${kind}-${market}.json`,
}));

const manifest: MarketReadManifest = {
  schema_version: "diamond-market-data-manifest/v2",
  trade_date: tradeDate,
  day_status: "COMPLETE",
  terminal: true,
  expected_layers: 8,
  ready_layers: 8,
  missing_layers: [],
  layers,
  index_state: {
    status: "READY",
    completed_prefixes: prefixes,
    total_prefixes: prefixes.length,
  },
};

function shard(prefix: string, overrides: Partial<MarketReadEmbeddedShardReceiptV3> = {}): MarketReadEmbeddedShardReceiptV3 {
  return {
    schema_version: "diamond-market-data-symbol-shard/v3",
    month: "2026-08",
    prefix,
    build_trade_date: tradeDate,
    generation,
    source_manifest_sha: manifestSha,
    audit_status: "PASS",
    symbols: prefix === "30" ? { "3003": { institutional: [] } } : {},
    ...overrides,
  };
}

function reference(prefix: string, overrides: Partial<MarketReadReferenceShardReceiptV4> = {}): MarketReadReferenceShardReceiptV4 {
  return {
    schema_version: "diamond-market-data-symbol-shard-ref/v4",
    month: "2026-08",
    prefix,
    build_trade_date: tradeDate,
    generation,
    source_manifest_sha: manifestSha,
    audit_status: "PASS",
    source_path: `data/market-data/index/2026/08/${prefix}.json`,
    source_blob_sha: "b".repeat(40),
    source_logical_sha256: "c".repeat(64),
    ...overrides,
  };
}

const partial: MarketReadManifest = {
  ...manifest,
  index_state: { status: "PENDING", completed_prefixes: ["30"], total_prefixes: 3 },
};
assert.throws(
  () => buildPublishedPointer({
    current: null,
    manifest: partial,
    manifest_sha: manifestSha,
    shards: [shard("30")],
    published_at: "2026-08-21T00:00:00Z",
  }),
  /index_not_ready/,
);

const pointer = buildPublishedPointer({
  current: null,
  manifest,
  manifest_sha: manifestSha,
  shards: prefixes.map((prefix) => shard(prefix)),
  published_at: "2026-08-21T00:00:00Z",
});
assert.equal(pointer.trade_date, tradeDate);
assert.equal(pointer.prefix_count, 3);
assert.equal(pointer.previous_generation, null);

assert.throws(
  () => buildPublishedPointer({
    current: null,
    manifest,
    manifest_sha: manifestSha,
    shards: [shard("30"), shard("31", { generation: `${generation}:old` }), shard("32")],
    published_at: "2026-08-21T00:00:00Z",
  }),
  /shard_generation_mismatch:31/,
);
assert.throws(
  () => buildPublishedPointer({
    current: null,
    manifest,
    manifest_sha: manifestSha,
    shards: [shard("30"), shard("31", { build_trade_date: "2026-08-19" }), shard("32")],
    published_at: "2026-08-21T00:00:00Z",
  }),
  /shard_trade_date_mismatch:31/,
);
assert.throws(
  () => buildPublishedPointer({
    current: null,
    manifest,
    manifest_sha: manifestSha,
    shards: [shard("30"), shard("31", { audit_status: "FAIL" }), shard("32")],
    published_at: "2026-08-21T00:00:00Z",
  }),
  /shard_audit_failed:31/,
);

const oldPointer: MarketReadPublishedPointer = {
  schema_version: "diamond-market-data-published-pointer/v1",
  trade_date: "2026-08-19",
  generation: `2026-08-19:${"b".repeat(40)}`,
  source_manifest_sha: "b".repeat(40),
  prefix_count: 3,
  published_at: "2026-08-20T00:00:00Z",
  previous_generation: null,
};
const promoted = buildPublishedPointer({
  current: oldPointer,
  manifest,
  manifest_sha: manifestSha,
  shards: prefixes.map((prefix) => reference(prefix)),
  published_at: "2026-08-21T00:00:00Z",
});
assert.equal(promoted.previous_generation, oldPointer.generation);
assertPublishedShard(promoted, reference("30"));
assertPublishedShard(promoted, shard("30"));
assert.throws(
  () => assertPublishedShard(
    promoted,
    shard("30", {
      generation: oldPointer.generation,
      build_trade_date: "2026-08-19",
      source_manifest_sha: oldPointer.source_manifest_sha,
    }),
  ),
  /published_generation_mismatch/,
);
assert.notEqual(marketReadCacheKey("3003", oldPointer), marketReadCacheKey("3003", promoted));

assert.throws(
  () => buildPublishedPointer({
    current: null,
    manifest,
    manifest_sha: manifestSha,
    shards: [reference("30"), reference("31", { source_blob_sha: "bad" }), reference("32")],
    published_at: "2026-08-21T00:00:00Z",
  }),
  /generation_source_blob_sha_invalid:31|shard_source_blob_sha_invalid:31/,
);

const v5Pointer: MarketReadPublishedPointer = {
  schema_version: "diamond-market-data-published-pointer/v1",
  trade_date: tradeDate,
  generation,
  source_manifest_sha: manifestSha,
  prefix_count: prefixes.length,
  published_at: "2026-08-21T00:00:00Z",
  previous_generation: null,
};
const v5Manifest: MarketReadGenerationManifestV5 = {
  schema_version: "diamond-market-data-generation-ref/v5",
  month: "2026-08",
  trade_date: tradeDate,
  generation,
  source_manifest_sha: manifestSha,
  audit_status: "PASS",
  prefix_count: prefixes.length,
  prefixes: Object.fromEntries(prefixes.map((prefix, index) => [prefix, {
    source_path: `data/market-data/index/2026/08/${prefix}.json`,
    source_blob_sha: (index + 1).toString(16).padStart(40, "0"),
    source_logical_sha256: (index + 1).toString(16).padStart(64, "0"),
  }])),
  created_at: "2026-08-21T00:00:00Z",
};
assert.doesNotThrow(() => assertPublishedGenerationManifest(v5Pointer, v5Manifest));
assert.throws(
  () => assertPublishedGenerationManifest(v5Pointer, {
    ...v5Manifest,
    prefix_count: 2,
  }),
  /published_generation_declared_prefix_count_mismatch/,
);
assert.throws(
  () => assertPublishedGenerationManifest(v5Pointer, {
    ...v5Manifest,
    prefixes: {
      ...v5Manifest.prefixes,
      "31": { ...v5Manifest.prefixes["31"], source_blob_sha: "bad" },
    },
  }),
  /generation_source_blob_sha_invalid:31/,
);

console.log("PASS market-data publish fence legacy compatibility + compact v5 generation manifest");
