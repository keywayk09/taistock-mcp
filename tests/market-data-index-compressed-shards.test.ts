import assert from "node:assert/strict";
import {
  readGitHubJson,
  stableJson,
  type MemoryGitHubDataStore,
} from "../src/v6/github-data-store.ts";
import { GITHUB_COMPRESSED_JSON_VERSION } from "../src/v6/github-compressed-json.ts";
import { runAdaptiveHistoryIndexSlice } from "../src/v6/market-data-history-index-v2.ts";

const memory: MemoryGitHubDataStore = new Map();
const env = { __GITHUB_DATA_MEMORY: memory } as unknown as Env;
const tradeDate = "2026-08-14";
const month = "2026-08";
const manifestPath = "data/market-data/daily/2026/08/14/manifest.json";
const shardPath = "data/market-data/index/2026/08/1.json";

function seed(path: string, value: unknown, suffix: string) {
  memory.set(path, { sha: `seed-${suffix}`, text: stableJson(value) });
}

// Reproduce the real failure shape: a compact monthly shard is already large
// because every newly captured day extends the whole month-level symbol history.
// Existing production compact shards were still plain JSON, so the next day had
// to read and rewrite the entire growing object.
const largeSymbols: Record<string, any> = {};
for (let id = 1000; id < 1700; id++) {
  const symbol = String(id);
  largeSymbols[symbol] = {
    institutional: Array.from({ length: 8 }, (_, day) => ({
      trade_date: `2026-08-${String(day + 1).padStart(2, "0")}`,
      symbol,
      market: "listed",
      foreign_net_shares: 1_000_000 + id + day,
      trust_net_shares: 20_000 + day,
      dealer_net_shares: -15_000 - day,
      total_net_shares: 1_005_000 + id,
      source: "TWSE_T86",
    })),
    margin: Array.from({ length: 8 }, (_, day) => ({
      trade_date: `2026-08-${String(day + 1).padStart(2, "0")}`,
      symbol,
      market: "listed",
      margin_balance_lots: 10_000 + id + day,
      short_balance_lots: 500 + day,
      source: "TWSE_MI_MARGN",
    })),
  };
}
const legacyPlainShard = {
  schema_version: "diamond-market-data-symbol-shard/v2",
  month,
  prefix: "1",
  symbols: largeSymbols,
  updated_at: "2026-08-13T22:00:00.000Z",
};
seed(shardPath, legacyPlainShard, "plain-index");
const plainBytesBefore = new TextEncoder().encode(memory.get(shardPath)!.text).byteLength;
assert.ok(plainBytesBefore > 500_000, `fixture must model a large shard: ${plainBytesBefore}`);

const layerSpecs = [
  ["institutional", "listed"],
  ["institutional", "otc"],
  ["margin", "listed"],
  ["margin", "otc"],
  ["securities_lending", "listed"],
  ["securities_lending", "otc"],
  ["sbl_short_sale", "listed"],
  ["sbl_short_sale", "otc"],
] as const;

const layers = layerSpecs.map(([kind, market], index) => {
  const snapshotPath = `data/market-data/daily/2026/08/14/snapshots/${kind}-${market}/fixture-${index}.json`;
  seed(snapshotPath, {
    rows: [{
      trade_date: tradeDate,
      symbol: "1101",
      market,
      source: `fixture-${kind}-${market}`,
      total_net_shares: index + 1,
      margin_balance_lots: 10_000 + index,
      short_balance_lots: 500 + index,
      lending_balance_lots: 100 + index,
      sbl_volume_lots: 10 + index,
    }],
  }, `snapshot-${index}`);
  return {
    kind,
    market,
    status: "READY",
    snapshot_path: snapshotPath,
    dataset_version: `sha256:${String(index).padStart(64, "0")}`,
    content_sha256: String(index).padStart(64, "0"),
    row_count: 1,
  };
});

const manifest = {
  schema_version: "diamond-market-data-manifest/v2",
  trade_date: tradeDate,
  day_status: "COMPLETE",
  terminal: true,
  expected_layers: 8,
  ready_layers: 8,
  missing_layers: [],
  layers,
  index_state: {
    status: "PENDING" as const,
    completed_prefixes: [],
    total_prefixes: null,
    updated_at: "2026-08-14T22:00:00.000Z",
  },
};
seed(manifestPath, manifest, "manifest");

const result = await runAdaptiveHistoryIndexSlice(env, {
  tradeDate,
  manifest,
  capturedAt: "2026-08-22T03:00:00.000Z",
  deadlineAtMs: Date.now() + 60_000,
  subrequestBudget: 42,
  prefixLength: 1,
});
assert.equal(result.status, "INDEX_COMPLETE");
assert.equal(result.prefix_length, 1);

// Physical Git storage must now be the transparent compressed envelope.
const storedShard = JSON.parse(memory.get(shardPath)!.text);
assert.equal(storedShard.schema_version, GITHUB_COMPRESSED_JSON_VERSION);
assert.equal(storedShard.codec, "gzip+base64");
assert.ok(storedShard.compressed_bytes < storedShard.uncompressed_bytes * 0.35,
  `${storedShard.compressed_bytes}/${storedShard.uncompressed_bytes}`);
assert.equal("symbols" in storedShard, false, "exploded month symbols must not remain in the Git blob");

// Readers and publisher-facing logical state must remain unchanged by storage compression.
const transparent = await readGitHubJson<any>(env, shardPath);
assert.equal(transparent.value?.schema_version, "diamond-market-data-symbol-shard/v2");
assert.equal(transparent.value?.symbols?.["1101"]?.institutional?.at(-1)?.trade_date, tradeDate);
assert.ok(Object.keys(transparent.value?.symbols ?? {}).length >= 700);

// Control-plane manifest remains small human-readable JSON, not a compressed envelope.
const storedManifest = JSON.parse(memory.get(manifestPath)!.text);
assert.equal(storedManifest.schema_version, "diamond-market-data-manifest/v2");
assert.notEqual(storedManifest.schema_version, GITHUB_COMPRESSED_JSON_VERSION);
assert.equal(storedManifest.index_state.status, "READY");
assert.deepEqual(storedManifest.index_state.completed_prefixes, ["1"]);

console.log("PASS compact monthly index migrates plain -> transparent compressed storage");
