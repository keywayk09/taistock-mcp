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

// Same logical immutable object remains idempotent after resetting capture policy.
setMarketDataCapturePolicy(null);
const replay = await putImmutableGitHubJson(env, {
  path: snapshotPath,
  value: snapshot,
  message: "test logical immutable replay",
});
assert.equal(replay.idempotent, true);
assert.equal(memory.get(snapshotPath)!.text, JSON.stringify(stored, null, 2) + "\n");

// Current-day heavy artifacts are compressed at first write too. Long-term
// storage safety must not depend on whether capture came from History or Daily.
const dailyPath = `data/market-data/daily/2026/08/21/snapshots/institutional-listed/${"b".repeat(64)}.json`;
const dailyValue = { trade_date: "2026-08-21", rows };
await putImmutableGitHubJson(env, { path: dailyPath, value: dailyValue, message: "test daily compressed json" });
const dailyStored = JSON.parse(memory.get(dailyPath)!.text);
assert.equal(dailyStored.schema_version, GITHUB_COMPRESSED_JSON_VERSION);
assert.equal("rows" in dailyStored, false, "daily heavy rows must not be persisted exploded");
assert.deepEqual((await readGitHubJson<typeof dailyValue>(env, dailyPath)).value, dailyValue);

// Raw official evidence follows the same heavy-at-rest policy.
const rawPath = `data/market-data/raw/2026/08/18/twse_mi_margn-${"c".repeat(64)}.json`;
const rawValue = { schema_version: "diamond-official-raw-capture/v1", trade_date: "2026-08-18", source: "TWSE_MI_MARGN", body: { data: rows } };
await putImmutableGitHubJson(env, { path: rawPath, value: rawValue, message: "test compressed history raw" });
const rawStored = JSON.parse(memory.get(rawPath)!.text);
assert.equal(rawStored.schema_version, GITHUB_COMPRESSED_JSON_VERSION);
assert.deepEqual((await readGitHubJson<typeof rawValue>(env, rawPath)).value, rawValue);

// Small control-plane JSON stays human-readable. Compression is path-scoped,
// not a blanket wrapper over every canonical object.
const receiptPath = "data/market-data/published/test-control-receipt.json";
const receipt = { status: "PASS", sha: "d".repeat(64) };
await putImmutableGitHubJson(env, { path: receiptPath, value: receipt, message: "test readable control json" });
assert.deepEqual(JSON.parse(memory.get(receiptPath)!.text), receipt);

setMarketDataCapturePolicy(null);
console.log("market-data transparent compressed heavy storage passed");
