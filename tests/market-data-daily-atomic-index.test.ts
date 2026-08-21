import assert from "node:assert/strict";
import fs from "node:fs";

const facade = fs.readFileSync("src/v6/market-data-daily-capture.ts", "utf8");
const dispatcher = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
const sharedIndexer = fs.readFileSync("src/v6/market-data-history-index-v2.ts", "utf8");

assert.match(facade, /runAdaptiveHistoryIndexSlice/);
assert.match(facade, /daily_index_mode:\s*"ADAPTIVE_ATOMIC"/);
assert.match(facade, /manifest\?\.terminal === true/);
assert.match(facade, /manifest\?\.day_status === "COMPLETE"/);
assert.match(dispatcher, /runAdaptiveDailyMarketDataCapture/);
assert.doesNotMatch(dispatcher, /runSubrequestSafeMarketDataCapture/);
assert.match(dispatcher, /deadlineAtMs:\s*budget\.deadline_at_ms/);
assert.match(dispatcher, /subrequestBudget:\s*remainingSubrequests/);
assert.match(sharedIndexer, /atomicUpdateGitHubJsonFiles/);
assert.match(sharedIndexer, /history index slice/);
assert.match(sharedIndexer, /adaptiveHistoryIndexCapacity/);

console.log("PASS daily lane shares adaptive atomic indexer with history");
