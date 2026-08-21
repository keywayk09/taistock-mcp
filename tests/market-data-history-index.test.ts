import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HISTORY_INDEX_DEADLINE_GUARD_MS,
  MARKET_DATA_CLOSED_HISTORY_PREFIX_LENGTH,
  MARKET_DATA_DAILY_INDEX_PREFIX_LENGTH,
  adaptiveHistoryIndexCapacity,
} from "../src/v6/market-data-history-index.ts";
import { atomicUpdateGitHubJsonFiles } from "../src/v6/github-atomic-json.ts";
import { stableJson, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";

assert.equal(MARKET_DATA_DAILY_INDEX_PREFIX_LENGTH, 1, "future Daily must use compact one-digit shards");
assert.equal(MARKET_DATA_CLOSED_HISTORY_PREFIX_LENGTH, 1, "History must use the same compact shard contract");

const farDeadline = 100_000;
const fast = adaptiveHistoryIndexCapacity({ pendingPrefixes: 10, subrequestBudget: 35, nowMs: 0, deadlineAtMs: farDeadline });
assert.ok(fast > 3, `compact index must finish multiple shards per safe slice; got ${fast}`);

const smallerBudget = adaptiveHistoryIndexCapacity({ pendingPrefixes: 10, subrequestBudget: 18, nowMs: 0, deadlineAtMs: farDeadline });
assert.ok(smallerBudget > 0 && smallerBudget < fast, "capacity must scale down with available subrequest headroom");

const enoughForAll = adaptiveHistoryIndexCapacity({ pendingPrefixes: 4, subrequestBudget: 100, nowMs: 0, deadlineAtMs: farDeadline });
assert.equal(enoughForAll, 4, "small remaining work should finish in one slice when budget allows");

const nearDeadline = adaptiveHistoryIndexCapacity({ pendingPrefixes: 10, subrequestBudget: 100, nowMs: farDeadline - HISTORY_INDEX_DEADLINE_GUARD_MS, deadlineAtMs: farDeadline });
assert.equal(nearDeadline, 0, "deadline guard must yield before starting more GitHub writes");

const historyIndex = fs.readFileSync("src/v6/market-data-history-index-v2.ts", "utf8");
const backfill = fs.readFileSync("src/v6/market-data-360d-backfill.ts", "utf8");
const daily = fs.readFileSync("src/v6/market-data-daily-capture.ts", "utf8");
const dispatcher = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
const published = fs.readFileSync("src/v6/market-data-published-gateway-v2.ts", "utf8");
const fastGateway = fs.readFileSync("src/v6/market-data-fast-gateway.ts", "utf8");
assert.doesNotMatch(historyIndex, /PREFIX_BATCH_SIZE\s*=\s*\d+/);
assert.match(historyIndex, /MARKET_DATA_DAILY_INDEX_PREFIX_LENGTH = 1/);
assert.match(historyIndex, /symbol\.slice\(0, prefixLength\)/);
assert.match(historyIndex, /atomicUpdateGitHubJsonFiles/);
assert.doesNotMatch(backfill, /historyMonth < anchorMonth \? 1 : 2/);
assert.match(backfill, /const prefixLength: 1 = 1/);
assert.match(daily, /prefixLength:\s*1/);
assert.match(daily, /daily_index_mode:\s*"ADAPTIVE_ATOMIC"/);
assert.match(daily, /compact_prefix_length:\s*1/);
assert.match(published, /prefixCandidates/);
assert.match(published, /universal_compact_shard_write:\s*true/);
assert.match(published, /legacy_two_digit_shard_read_fallback:\s*true/);
assert.match(fastGateway, /PREFIX_MONTH_COMPACT/);
assert.match(fastGateway, /PREFIX_MONTH_LEGACY_FALLBACK/);
assert.match(dispatcher, /BACKFILL_COORDINATOR_HEADROOM/);
assert.match(dispatcher, /deadlineAtMs:\s*budget\.deadline_at_ms/);

const memory: MemoryGitHubDataStore = new Map([
  ["data/test/a.json", { sha: "a".repeat(40), text: stableJson({ value: 1 }) }],
  ["data/test/b.json", { sha: "b".repeat(40), text: stableJson({ value: 1 }) }],
]);
const env = { __GITHUB_DATA_MEMORY: memory } as unknown as Env;
const atomic = await atomicUpdateGitHubJsonFiles(env, {
  message: "test atomic multi-file checkpoint",
  updates: [
    { path: "data/test/a.json", defaultValue: { value: 0 }, merge: (current: any) => ({ value: current.value + 1 }) },
    { path: "data/test/b.json", defaultValue: { value: 0 }, merge: (current: any) => ({ value: current.value + 1 }) },
    { path: "data/test/manifest.json", defaultValue: { completed: [] as string[] }, merge: () => ({ completed: ["a", "b"] }) },
  ],
});
assert.equal(atomic.idempotent, false);
assert.equal(atomic.changed_paths.length, 3);
assert.match(String(atomic.commit_sha), /^memory-commit-/);
assert.equal(JSON.parse(memory.get("data/test/a.json")!.text).value, 2);
assert.equal(JSON.parse(memory.get("data/test/b.json")!.text).value, 2);
assert.deepEqual(JSON.parse(memory.get("data/test/manifest.json")!.text).completed, ["a", "b"]);

const beforeA = memory.get("data/test/a.json")!.text;
const beforeB = memory.get("data/test/b.json")!.text;
await assert.rejects(
  () => atomicUpdateGitHubJsonFiles(env, {
    message: "test atomic rollback on merge error",
    updates: [
      { path: "data/test/a.json", defaultValue: { value: 0 }, merge: () => ({ value: 999 }) },
      { path: "data/test/b.json", defaultValue: { value: 0 }, merge: () => { throw new Error("injected_merge_failure"); } },
    ],
  }),
  /injected_merge_failure/,
);
assert.equal(memory.get("data/test/a.json")!.text, beforeA);
assert.equal(memory.get("data/test/b.json")!.text, beforeB);

console.log("market-data universal compact adaptive atomic index contract passed");