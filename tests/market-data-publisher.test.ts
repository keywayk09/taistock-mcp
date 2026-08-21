import assert from "node:assert/strict";
import { stableJson, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";
import {
  marketReadPublishedPointerPath,
  marketReadPublishedShardPath,
  marketReadPublishStatePath,
  type MarketReadPublishState,
} from "../src/v6/market-data-publish-fence.ts";
import { getTwMarketChipSummaryPublished } from "../src/v6/market-data-published-gateway.ts";
import { MARKET_DATA_PUBLISH_PREFIX_BATCH_SIZE, runMarketDataPublisher } from "../src/v6/market-data-publisher.ts";

const tradeDate = "2026-08-20";
const prefixes = ["30", "31", "32", "33", "34", "35"];
const memory: MemoryGitHubDataStore = new Map();
const env = { __GITHUB_DATA_MEMORY: memory } as unknown as Env;
let seedNo = 0;

function seed(path: string, value: unknown) {
  memory.set(path, { sha: `seed-${++seedNo}`, text: stableJson(value) });
}

function symbolFor(prefix: string) {
  return `${prefix}03`;
}

function rowsFor(symbol: string) {
  return {
    institutional: {
      trade_date: tradeDate,
      symbol,
      name: `S${symbol}`,
      market: "listed",
      foreign_net_shares: 100,
      trust_net_shares: 20,
      dealer_net_shares: -10,
      total_net_shares: 110,
      source: "TWSE_T86",
      source_priority: "OFFICIAL",
    },
    margin: {
      trade_date: tradeDate,
      symbol,
      name: `S${symbol}`,
      market: "listed",
      margin_previous_balance_lots: 10,
      margin_balance_lots: 12,
      margin_balance_change_lots: 2,
      short_previous_balance_lots: 3,
      short_balance_lots: 2,
      short_balance_change_lots: -1,
      source: "TWSE_MI_MARGN",
      source_priority: "OFFICIAL",
    },
    securities_lending: {
      trade_date: tradeDate,
      symbol,
      name: `S${symbol}`,
      market: "listed",
      previous_balance_shares: 1000,
      borrowed_shares: 200,
      returned_shares: 50,
      balance_shares: 1150,
      close_price: 50,
      balance_value: 57500,
      source: "TWSE_TWT72U",
      source_priority: "OFFICIAL",
    },
    sbl_short_sale: {
      trade_date: tradeDate,
      symbol,
      name: `S${symbol}`,
      market: "listed",
      previous_balance_shares: 400,
      sold_shares: 100,
      returned_shares: 20,
      adjustment_shares: 0,
      balance_shares: 480,
      available_shares: 2000,
      sold_volume_shares: 100,
      sold_amount: 5000,
      source: "TWSE_TWT93U",
      source_priority: "OFFICIAL",
    },
  };
}

const allRows = prefixes.map((prefix) => rowsFor(symbolFor(prefix)));
const layerDefs = [
  { kind: "institutional", market: "listed", rows: allRows.map((x) => x.institutional) },
  { kind: "institutional", market: "otc", rows: [] },
  { kind: "margin", market: "listed", rows: allRows.map((x) => x.margin) },
  { kind: "margin", market: "otc", rows: [] },
  { kind: "securities_lending", market: "listed", rows: allRows.map((x) => x.securities_lending) },
  { kind: "securities_lending", market: "otc", rows: [] },
  { kind: "sbl_short_sale", market: "listed", rows: allRows.map((x) => x.sbl_short_sale) },
  { kind: "sbl_short_sale", market: "otc", rows: [] },
];

const layers = layerDefs.map((layer, index) => {
  const snapshotPath = `test/snapshots/${index}.json`;
  seed(snapshotPath, { rows: layer.rows });
  return {
    kind: layer.kind,
    market: layer.market,
    status: "READY",
    snapshot_path: snapshotPath,
    dataset_version: `sha256:${String(index).padStart(64, "0")}`,
    content_sha256: String(index).padStart(64, "0"),
    row_count: layer.rows.length,
  };
});

const manifestPath = "data/market-data/daily/2026/08/20/manifest.json";
seed(manifestPath, {
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
    updated_at: "2026-08-21T00:00:00Z",
  },
});

for (const prefix of prefixes) {
  const symbol = symbolFor(prefix);
  const row = rowsFor(symbol);
  seed(`data/market-data/index/2026/08/${prefix}.json`, {
    schema_version: "diamond-market-data-symbol-shard/v2",
    month: "2026-08",
    prefix,
    symbols: {
      [symbol]: {
        institutional: [row.institutional],
        margin: [row.margin],
        securities_lending: [row.securities_lending],
        sbl_short_sale: [row.sbl_short_sale],
      },
    },
    updated_at: "2026-08-21T00:00:00Z",
  });
}

assert.equal(MARKET_DATA_PUBLISH_PREFIX_BATCH_SIZE, 5);
const first = await runMarketDataPublisher(env, { tradeDate, now: new Date("2026-08-21T00:05:00Z") });
assert.equal(first.status, "PUBLISH_PROGRESS");
assert.equal(first.published_prefixes, 5);
assert.equal(memory.has(marketReadPublishedPointerPath()), false);

const statePath = marketReadPublishStatePath(tradeDate);
const firstState = JSON.parse(memory.get(statePath)!.text) as MarketReadPublishState;
assert.equal(firstState.completed_prefixes.length, 5);
assert.equal(firstState.status, "PENDING");
for (const prefix of prefixes.slice(0, 5)) {
  assert.equal(memory.has(marketReadPublishedShardPath(tradeDate, firstState.generation, prefix)), true);
}

// Same-generation replay must be immutable/idempotent, not an immutable-content conflict.
seed(statePath, { ...firstState, status: "PENDING", completed_prefixes: [] });
const replay = await runMarketDataPublisher(env, { tradeDate, now: new Date("2026-08-21T00:10:00Z") });
assert.equal(replay.status, "PUBLISH_PROGRESS");
assert.equal(replay.published_prefixes, 5);

// Failure injection: the last source prefix no longer matches the canonical snapshots.
const badPrefix = "35";
const badPath = `data/market-data/index/2026/08/${badPrefix}.json`;
const goodBadSource = JSON.parse(memory.get(badPath)!.text);
const badSource = structuredClone(goodBadSource);
badSource.symbols[symbolFor(badPrefix)].margin[0].margin_balance_lots = 999;
seed(badPath, badSource);
await assert.rejects(
  () => runMarketDataPublisher(env, { tradeDate, now: new Date("2026-08-21T00:15:00Z") }),
  /source_shard_row_mismatch:35/,
);
assert.equal(memory.has(marketReadPublishedPointerPath()), false);

seed(badPath, goodBadSource);
const second = await runMarketDataPublisher(env, { tradeDate, now: new Date("2026-08-21T00:20:00Z") });
assert.equal(second.status, "PUBLISHED");
assert.equal(second.published_prefixes, 6);

const pointer = JSON.parse(memory.get(marketReadPublishedPointerPath())!.text);
assert.equal(pointer.trade_date, tradeDate);
assert.equal(pointer.generation, firstState.generation);
assert.equal(pointer.prefix_count, 6);

const published = await getTwMarketChipSummaryPublished(env, {
  symbol: "3003",
  calendar_days: 30,
});
assert.equal(published.ok, true);
assert.equal(published.consistency, "PUBLISHED");
assert.equal(published.status, "READY");
assert.equal(published.data_quality.formal_published, true);
assert.equal(published.data_quality.mixed_generation_current_day, false);
assert.equal(published.data_quality.daily_snapshot_overlay, false);
assert.equal(published.publication.generation, pointer.generation);
assert.ok(published.datasets.some((item) => item.role === "PUBLISHED_GENERATION_SHARD"));

const stale = await getTwMarketChipSummaryPublished(env, {
  symbol: "3003",
  as_of: "2026-08-21",
  calendar_days: 30,
});
assert.equal(stale.ok, false);
assert.equal(stale.reason, "requested_as_of_newer_than_published_pointer");

console.log("PASS market-data publisher + published gateway");
