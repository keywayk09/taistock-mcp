import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HISTORY_INDEX_DEADLINE_GUARD_MS,
  adaptiveHistoryIndexCapacity,
} from "../src/v6/market-data-history-index.ts";

const farDeadline = 100_000;
const fast = adaptiveHistoryIndexCapacity({
  pendingPrefixes: 70,
  subrequestBudget: 35,
  nowMs: 0,
  deadlineAtMs: farDeadline,
});
assert.ok(fast > 3, `history index must not retain the old 1/3-prefix pace; got ${fast}`);

const smallerBudget = adaptiveHistoryIndexCapacity({
  pendingPrefixes: 70,
  subrequestBudget: 18,
  nowMs: 0,
  deadlineAtMs: farDeadline,
});
assert.ok(smallerBudget > 0 && smallerBudget < fast, "capacity must scale down with available subrequest headroom");

const enoughForAll = adaptiveHistoryIndexCapacity({
  pendingPrefixes: 4,
  subrequestBudget: 100,
  nowMs: 0,
  deadlineAtMs: farDeadline,
});
assert.equal(enoughForAll, 4, "small remaining work should finish in one slice when budget allows");

const nearDeadline = adaptiveHistoryIndexCapacity({
  pendingPrefixes: 70,
  subrequestBudget: 100,
  nowMs: farDeadline - HISTORY_INDEX_DEADLINE_GUARD_MS,
  deadlineAtMs: farDeadline,
});
assert.equal(nearDeadline, 0, "deadline guard must yield before starting more GitHub writes");

const historyIndex = fs.readFileSync("src/v6/market-data-history-index.ts", "utf8");
const backfill = fs.readFileSync("src/v6/market-data-360d-backfill.ts", "utf8");
const dispatcher = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
assert.doesNotMatch(historyIndex, /PREFIX_BATCH_SIZE\s*=\s*\d+/);
assert.match(historyIndex, /subrequestBudget/);
assert.match(historyIndex, /deadlineAtMs/);
assert.match(historyIndex, /Promise\.all\(\s*layers\.map/);
assert.match(backfill, /runAdaptiveHistoryIndexSlice/);
assert.match(dispatcher, /BACKFILL_COORDINATOR_HEADROOM/);
assert.match(dispatcher, /deadlineAtMs:\s*budget\.deadline_at_ms/);

console.log("market-data adaptive history index throughput contract passed");
