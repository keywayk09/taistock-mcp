import assert from "node:assert/strict";
import { setMarketDataCapturePolicy } from "../src/v6/market-data-capture-context.ts";
import {
  putImmutableGitHubJson,
  readGitHubJson,
  type MemoryGitHubDataStore,
} from "../src/v6/github-data-store.ts";
import { GITHUB_COMPRESSED_JSON_VERSION } from "../src/v6/github-compressed-json.ts";

const memory: MemoryGitHubDataStore = new Map();
const env = { __GITHUB_DATA_MEMORY: memory } as unknown as Env;

const rows = Array.from({ length: 600 }, (_, index) => ({
  trade_date: "2026-08-18",
  symbol: String(1101 + index),
  market: "listed",
  margin_balance_lots: 10000 + index,
  short_balance_lots: 500 + index,
  source: "TWSE_MI_MARGN",
}));

const snapshot = {
  schema_version: "diamond-tw-market-data/v2.3.1-cloudflare-one-layer-resumable",
  trade_date: "2026-08-18",
  market: "listed",
  kind: "margin",
  source: "TWSE_MI_MARGN",
  source_date_verified: true,
  rows,
  content_sha256: "a".repeat(64),
  dataset_version: `sha256:${"a".repeat(64)}`,
};
const snapshotPath = `data/market-data/daily/2026/08/18/snapshots/margin-listed/${"a".repeat(64)}.json`;

setMarketDataCapturePolicy({ storageMode: "HISTORY_COMPRESSED" });
const first = await putImmutableGitHubJson(env, {
  path: snapshotPath,
  value: snapshot,
  message: "test compressed history snapshot",
});
assert.equal(first.idempotent, false);

const stored = JSON.parse(memory.get(snapshotPath)!.text);
assert.equal(stored.schema_version, GITHUB_COMPRESSED_JSON_VERSION);
assert.equal(stored.codec, "gzip+base64");
assert.ok(stored.compressed_bytes < stored.uncompressed_bytes * 0.5, `${stored.compressed_bytes}/${stored.uncompressed_bytes}`);
assert.equal("rows" in stored, false, "exploded rows must not be persisted in the Git blob");

const transparent = await readGitHubJson<typeof snapshot>(env, snapshotPath);
assert.deepEqual(transparent.value, snapshot, "canonical readers must receive the original JSON after transparent decompression");

// The same immutable logical object remains idempotent even after leaving History mode.
setMarketDataCapturePolicy(null);
const replay = await putImmutableGitHubJson(env, {
  path: snapshotPath,
  value: snapshot,
  message: "test logical immutable replay",
});
assert.equal(replay.idempotent, true);
assert.equal(memory.get(snapshotPath)!.text, JSON.stringify(stored, null, 2) + "\n");

// Daily/current-day paths are not compressed when History mode is disabled.
const dailyPath = `data/market-data/daily/2026/08/21/snapshots/institutional-listed/${"b".repeat(64)}.json`;
const dailyValue = { trade_date: "2026-08-21", rows: rows.slice(0, 3) };
await putImmutableGitHubJson(env, { path: dailyPath, value: dailyValue, message: "test daily json" });
const dailyStored = JSON.parse(memory.get(dailyPath)!.text);
assert.deepEqual(dailyStored, dailyValue);

// Raw official evidence follows the same History-only compressed policy.
setMarketDataCapturePolicy({ storageMode: "HISTORY_COMPRESSED" });
const rawPath = `data/market-data/raw/2026/08/18/twse_mi_margn-${"c".repeat(64)}.json`;
const rawValue = { schema_version: "diamond-official-raw-capture/v1", trade_date: "2026-08-18", source: "TWSE_MI_MARGN", body: { data: rows } };
await putImmutableGitHubJson(env, { path: rawPath, value: rawValue, message: "test compressed history raw" });
const rawStored = JSON.parse(memory.get(rawPath)!.text);
assert.equal(rawStored.schema_version, GITHUB_COMPRESSED_JSON_VERSION);
assert.deepEqual((await readGitHubJson<typeof rawValue>(env, rawPath)).value, rawValue);

setMarketDataCapturePolicy(null);
console.log("market-data transparent compressed history storage passed");
