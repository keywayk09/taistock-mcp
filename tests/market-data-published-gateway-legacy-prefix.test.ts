import assert from "node:assert/strict";
import { stableJson, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";
import { getTwMarketChipSummaryPublished } from "../src/v6/market-data-published-gateway.ts";
import { marketReadPublishedPointerPath, marketReadPublishedShardPath } from "../src/v6/market-data-publish-fence.ts";

const tradeDate = "2026-08-20";
const manifestSha = "a".repeat(64);
const generation = `${tradeDate}:${manifestSha}`;
const symbol = "2317";
const memory: MemoryGitHubDataStore = new Map();
const env = { __GITHUB_DATA_MEMORY: memory } as unknown as Env;
let seedNo = 0;

function seed(path: string, value: unknown) {
  const sha = (++seedNo).toString(16).padStart(40, "0");
  memory.set(path, { sha, text: stableJson(value) });
}

seed(marketReadPublishedPointerPath(), {
  schema_version: "diamond-market-data-published-pointer/v1",
  trade_date: tradeDate,
  generation,
  source_manifest_sha: manifestSha,
  prefix_count: 70,
  published_at: "2026-08-21T07:55:10.000Z",
  previous_generation: null,
});

// Production still has an older v3 generation whose physical shards use the
// historical two-digit prefix contract. For 2317 the valid shard is 23.json.
seed(marketReadPublishedShardPath(tradeDate, generation, "23"), {
  schema_version: "diamond-market-data-symbol-shard/v3",
  month: "2026-08",
  prefix: "23",
  build_trade_date: tradeDate,
  generation,
  source_manifest_sha: manifestSha,
  audit_status: "PASS",
  symbols: {
    [symbol]: {
      institutional: [{
        trade_date: tradeDate,
        symbol,
        name: "鴻海",
        market: "listed",
        foreign_net_shares: 1_000_000,
        trust_net_shares: 0,
        dealer_net_shares: 0,
        total_net_shares: 1_000_000,
        source: "TWSE_T86",
        source_priority: "OFFICIAL",
      }],
      margin: [{
        trade_date: tradeDate,
        symbol,
        name: "鴻海",
        market: "listed",
        margin_previous_balance_lots: 10,
        margin_balance_lots: 12,
        margin_balance_change_lots: 2,
        short_previous_balance_lots: 3,
        short_balance_lots: 2,
        short_balance_change_lots: -1,
        source: "TWSE_MI_MARGN",
        source_priority: "OFFICIAL",
      }],
      securities_lending: [{
        trade_date: tradeDate,
        symbol,
        name: "鴻海",
        market: "listed",
        previous_balance_shares: 1000,
        borrowed_shares: 200,
        returned_shares: 50,
        balance_shares: 1150,
        close_price: 200,
        balance_value: 230000,
        source: "TWSE_TWT72U",
        source_priority: "OFFICIAL",
      }],
      sbl_short_sale: [{
        trade_date: tradeDate,
        symbol,
        name: "鴻海",
        market: "listed",
        previous_balance_shares: 400,
        sold_shares: 100,
        returned_shares: 20,
        adjustment_shares: 0,
        balance_shares: 480,
        available_shares: 2000,
        sold_volume_shares: 100,
        sold_amount: 20000,
        source: "TWSE_TWT93U",
        source_priority: "OFFICIAL",
      }],
    },
  },
  updated_at: "2026-08-21T07:55:10.000Z",
});

const result = await getTwMarketChipSummaryPublished(env, {
  symbol,
  calendar_days: 30,
});

assert.equal(result.ok, true, JSON.stringify(result, null, 2));
assert.equal(result.status, "READY");
assert.equal(result.data_as_of, tradeDate);
assert.equal(result.publication?.trade_date, tradeDate);
assert.equal(result.publication?.format, "LEGACY_V3");

console.log("PASS Family published gateway reads legacy two-digit v3 shard for 2317");
