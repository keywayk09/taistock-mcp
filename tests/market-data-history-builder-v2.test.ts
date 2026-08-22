import assert from "node:assert/strict";
import {
  historyV2DailyStagePath,
  historyV2DailyStageProgressPath,
  historyV2MonthBuildPath,
  historyV2MonthCapturePath,
  runHistoryMonthBuildV2,
  stageHistoryDayV2,
} from "../src/v6/market-data-history-builder-v2.ts";
import { stableJson, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";

const memory: MemoryGitHubDataStore = new Map();
const env = { __GITHUB_DATA_MEMORY: memory } as unknown as Env;

function put(path: string, value: unknown) {
  memory.set(path, { sha: `seed-${path.replace(/[^a-z0-9]/gi, "").slice(0, 32)}`, text: stableJson(value) });
}

const tradeDate = "2026-08-11";
const identities = [
  ["institutional", "listed"],
  ["institutional", "otc"],
  ["margin", "listed"],
  ["margin", "otc"],
  ["securities_lending", "listed"],
  ["securities_lending", "otc"],
  ["sbl_short_sale", "listed"],
  ["sbl_short_sale", "otc"],
] as const;

const layers = identities.map(([kind, market], index) => {
  const snapshotPath = `data/market-data/daily/2026/08/11/snapshots/${kind}-${market}/seed-${index}.json`;
  put(snapshotPath, {
    rows: [
      { symbol: "2317", trade_date: tradeDate, market, value: `${kind}-${market}-new` },
      { symbol: "0050", trade_date: tradeDate, market, value: `${kind}-${market}-etf` },
    ],
  });
  return {
    kind,
    market,
    status: "READY",
    snapshot_path: snapshotPath,
    dataset_version: `sha256:${index}`,
  };
});

const manifestPath = "data/market-data/daily/2026/08/11/manifest.json";
put(manifestPath, {
  schema_version: "diamond-market-data-manifest/v2",
  trade_date: tradeDate,
  day_status: "COMPLETE",
  terminal: true,
  ready_layers: 8,
  missing_layers: [],
  layers,
  index_state: { status: "PENDING", completed_prefixes: [], total_prefixes: null, updated_at: "" },
});

const manifest = JSON.parse(memory.get(manifestPath)!.text);

// Production staging must be resumable. One wake may stage only a bounded prefix
// batch and must durably checkpoint progress without publishing the month catalog
// early. This is the regression for the 2026-07-28 8/8 COMPLETE staging stall.
const stageTimes = [
  "2026-08-22T07:10:00.000Z",
  "2026-08-22T07:15:00.000Z",
  "2026-08-22T07:20:00.000Z",
  "2026-08-22T07:25:00.000Z",
];

for (let wake = 0; wake < 3; wake++) {
  const partial = await stageHistoryDayV2(env, {
    tradeDate,
    manifest,
    capturedAt: stageTimes[wake],
    maxPrefixesPerWake: 3,
  });
  assert.equal(partial.status, "HISTORY_V2_STAGE_PROGRESS");
  assert.equal(partial.completed_prefixes.length, (wake + 1) * 3);
  const progress = JSON.parse(memory.get(historyV2DailyStageProgressPath(tradeDate))!.text);
  assert.equal(progress.status, "STAGING");
  assert.equal(progress.completed_prefixes.length, (wake + 1) * 3);
  assert.ok(!memory.has(historyV2MonthCapturePath("2026-08")), "month catalog must not publish before all 10 prefixes exist");
}

const staged = await stageHistoryDayV2(env, {
  tradeDate,
  manifest,
  capturedAt: stageTimes[3],
  maxPrefixesPerWake: 3,
});
assert.equal(staged.status, "HISTORY_V2_DAY_STAGED");
assert.deepEqual(staged.completed_prefixes, ["0","1","2","3","4","5","6","7","8","9"]);
assert.ok(memory.has(historyV2DailyStagePath(tradeDate, "0")));
assert.ok(memory.has(historyV2DailyStagePath(tradeDate, "2")));
assert.ok(memory.has(historyV2DailyStagePath(tradeDate, "9")));
const prefix2 = JSON.parse(memory.get(historyV2DailyStagePath(tradeDate, "2"))!.text);
assert.equal(prefix2.trade_date, tradeDate);
assert.ok(prefix2.symbols["2317"]);
assert.equal(prefix2.symbols["2317"].institutional.length, 2);
const progressReady = JSON.parse(memory.get(historyV2DailyStageProgressPath(tradeDate))!.text);
assert.equal(progressReady.status, "READY");
assert.deepEqual(progressReady.completed_prefixes, ["0","1","2","3","4","5","6","7","8","9"]);
const capture = JSON.parse(memory.get(historyV2MonthCapturePath("2026-08"))!.text);
assert.deepEqual(capture.staged_trade_dates, [tradeDate]);

// Re-staging the exact same canonical day is create-or-same/idempotent.
const stagedAgain = await stageHistoryDayV2(env, {
  tradeDate,
  manifest,
  capturedAt: "2026-08-22T07:30:00.000Z",
  maxPrefixesPerWake: 3,
});
assert.equal(stagedAgain.status, "HISTORY_V2_DAY_ALREADY_STAGED");

// Seed a newer already-indexed row plus a deliberately stale row for the V2
// staged date. Month build must preserve the newer row and replace only 8/11.
put("data/market-data/index/2026/08/2.json", {
  schema_version: "diamond-market-data-symbol-shard/v2",
  month: "2026-08",
  prefix: "2",
  symbols: {
    "2317": {
      institutional: [
        { symbol: "2317", trade_date: "2026-08-11", market: "listed", value: "STALE" },
        { symbol: "2317", trade_date: "2026-08-12", market: "listed", value: "KEEP-ME" },
      ],
    },
  },
  updated_at: "2026-08-12T00:00:00.000Z",
});

const buildState = {
  schema_version: "diamond-market-data-backfill-state/v2" as const,
  anchor_trade_date: "2026-08-21",
  target_start_date: "2026-08-01",
  cursor_date: "2026-07-31",
  phase: "BUILD" as const,
  status: "RUNNING" as const,
  processed_dates: 20,
  updated_at: "2026-08-22T07:30:00.000Z",
  completed_at: null,
};

let last: any = null;
for (let i = 0; i < 20; i++) {
  last = await runHistoryMonthBuildV2(env, {
    state: buildState,
    capturedAt: `2026-08-22T07:${String(30 + i).padStart(2, "0")}:00.000Z`,
  });
  if (last.status === "HISTORY_V2_ALL_MONTHS_READY") break;
}
assert.equal(last.status, "HISTORY_V2_ALL_MONTHS_READY");

const rebuilt2 = JSON.parse(memory.get("data/market-data/index/2026/08/2.json")!.text);
const instRows = rebuilt2.symbols["2317"].institutional;
assert.equal(instRows.find((row: any) => row.trade_date === "2026-08-12")?.value, "KEEP-ME");
assert.ok(!instRows.some((row: any) => row.trade_date === "2026-08-11" && row.value === "STALE"));
assert.equal(instRows.filter((row: any) => row.trade_date === "2026-08-11").length, 2);

const build = JSON.parse(memory.get(historyV2MonthBuildPath("2026-08"))!.text);
assert.equal(build.status, "READY");
assert.deepEqual(build.completed_prefixes, ["0","1","2","3","4","5","6","7","8","9"]);
assert.deepEqual(build.finalized_trade_dates, [tradeDate]);
const finalizedManifest = JSON.parse(memory.get(manifestPath)!.text);
assert.equal(finalizedManifest.index_state.status, "READY");
assert.deepEqual(finalizedManifest.index_state.completed_prefixes, ["0","1","2","3","4","5","6","7","8","9"]);

console.log("PASS History Builder V2 resumable daily staging + bounded month compaction + manifest finalize");
