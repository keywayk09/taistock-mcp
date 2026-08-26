import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { getTwMarketCrossSection } from "../src/v6/market-data-cross-section.ts";

const memory = new Map<string, { sha: string; text: string }>();
const env = { __GITHUB_DATA_MEMORY: memory } as any;

function put(path: string, value: unknown) {
  memory.set(path, { sha: `sha-${path}`, text: JSON.stringify(value, null, 2) + "\n" });
}

const readyLayers = [
  { kind:"institutional", market:"listed", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/institutional-listed.json" },
  { kind:"institutional", market:"otc", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/institutional-otc.json" },
  { kind:"margin", market:"listed", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/margin-listed.json" },
  { kind:"margin", market:"otc", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/margin-otc.json" },
  { kind:"securities_lending", market:"listed", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/securities-lending-listed.json" },
  { kind:"securities_lending", market:"otc", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/securities-lending-otc.json" },
  { kind:"sbl_short_sale", market:"listed", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/sbl-listed.json" },
  { kind:"sbl_short_sale", market:"otc", status:"READY", snapshot_path:"data/market-data/daily/2026/08/26/sbl-otc.json" },
];

const readyManifest = {
  schema_version: "diamond-market-data-manifest/v2",
  trade_date: "2026-08-26",
  day_status: "COMPLETE",
  terminal: true,
  ready_layers: 8,
  expected_layers: 8,
  missing_layers: [],
  layers: readyLayers,
  index_state: {
    status: "READY",
    completed_prefixes: ["0","1","2","3","4","5","6","7","8","9"],
    total_prefixes: 10,
  },
};

const readyShard = {
  schema_version: "diamond-market-data-symbol-shard/v2",
  month: "2026-08",
  prefix: "2",
  symbols: {
    "2330": {
      institutional: [
        { trade_date:"2026-08-24", symbol:"2330", name:"台積電", market:"listed", foreign_net_shares:10, trust_net_shares:2, dealer_net_shares:1, total_net_shares:13, source:"TWSE_T86", source_priority:"OFFICIAL" },
        { trade_date:"2026-08-25", symbol:"2330", name:"台積電", market:"listed", foreign_net_shares:20, trust_net_shares:3, dealer_net_shares:2, total_net_shares:25, source:"TWSE_T86", source_priority:"OFFICIAL" },
        { trade_date:"2026-08-26", symbol:"2330", name:"台積電", market:"listed", foreign_net_shares:30, trust_net_shares:4, dealer_net_shares:3, total_net_shares:37, source:"TWSE_T86", source_priority:"OFFICIAL" },
      ],
      margin: [
        { trade_date:"2026-08-26", symbol:"2330", name:"台積電", market:"listed", margin_previous_balance_lots:100, margin_balance_lots:90, margin_balance_change_lots:-10, short_previous_balance_lots:4, short_balance_lots:5, short_balance_change_lots:1, source:"TWSE_MI_MARGN", source_priority:"OFFICIAL" },
      ],
      securities_lending: [
        { trade_date:"2026-08-26", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:1000, borrowed_shares:200, returned_shares:50, balance_shares:1150, close_price:1000, balance_value:1150000, source:"TWSE_TWT72U", source_priority:"OFFICIAL" },
      ],
      sbl_short_sale: [
        { trade_date:"2026-08-26", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:100, sold_shares:25, returned_shares:5, adjustment_shares:0, balance_shares:120, available_shares:999, sold_volume_shares:25, sold_amount:null, source:"TWSE_TWT93U", source_priority:"OFFICIAL" },
      ],
    },
  },
  updated_at: "2026-08-26T14:21:00Z",
};

put("data/market-data/daily/2026/08/26/manifest.json", readyManifest);
put("data/market-data/index/2026/08/2.json", readyShard);

const ready = await getTwMarketCrossSection(env, { as_of:"2026-08-26", calendar_days:20, prefix:"2", limit:50 });
assert.equal(ready.status, "READY");
assert.equal(ready.formal_research_eligible, true);
assert.equal(ready.source_revision, "memory:main");
assert.equal(ready.data_gate.manifest_valid, true);
assert.equal(ready.data_gate.requested_prefixes_complete, true);
assert.deepEqual(ready.scan.invalid_shards, []);
assert.equal(ready.scan.symbols_returned, 1);
assert.equal(ready.symbols[0].symbol, "2330");
assert.equal(ready.symbols[0].coverage.ready_layers, 4);

assert.equal(ready.symbols[0].institutional.net_1d, 37);
assert.equal(ready.symbols[0].institutional.net_3d, 75);
assert.equal(ready.symbols[0].institutional.net_5d, null);
assert.deepEqual(ready.symbols[0].institutional.window_days, { "1d":1, "3d":3, "5d":3 });
assert.deepEqual(ready.symbols[0].institutional.window_observations, { "1d":1, "3d":3, "5d":3 });

assert.equal(ready.symbols[0].margin.margin_change_1d, -10);
assert.equal(ready.symbols[0].margin.margin_change_3d, null);
assert.equal(ready.symbols[0].margin.margin_change_5d, null);
assert.equal(ready.symbols[0].margin.short_change_1d, 1);
assert.equal(ready.symbols[0].margin.short_change_3d, null);
assert.deepEqual(ready.symbols[0].margin.window_days, { "1d":1, "3d":1, "5d":1 });
assert.deepEqual(ready.symbols[0].margin.margin_change_observations, { "1d":1, "3d":1, "5d":1 });
assert.deepEqual(ready.symbols[0].margin.short_change_observations, { "1d":1, "3d":1, "5d":1 });

assert.equal(ready.symbols[0].securities_lending.net_borrowed_1d, 150);
assert.equal(ready.symbols[0].securities_lending.net_borrowed_3d, null);
assert.equal(ready.symbols[0].securities_lending.net_borrowed_5d, null);
assert.deepEqual(ready.symbols[0].securities_lending.window_days, { "1d":1, "3d":1, "5d":1 });
assert.deepEqual(ready.symbols[0].securities_lending.window_observations, { "1d":1, "3d":1, "5d":1 });

assert.equal(ready.symbols[0].sbl_short_sale.sold_1d, 25);
assert.equal(ready.symbols[0].sbl_short_sale.sold_3d, null);
assert.equal(ready.symbols[0].sbl_short_sale.sold_5d, null);
assert.deepEqual(ready.symbols[0].sbl_short_sale.window_days, { "1d":1, "3d":1, "5d":1 });
assert.deepEqual(ready.symbols[0].sbl_short_sale.window_observations, { "1d":1, "3d":1, "5d":1 });

// Null observations do not count toward completed horizons.
const nullObservedShard = structuredClone(readyShard) as any;
nullObservedShard.symbols["2330"].margin = [
  { trade_date:"2026-08-24", symbol:"2330", name:"台積電", market:"listed", margin_previous_balance_lots:120, margin_balance_lots:110, margin_balance_change_lots:-10, short_previous_balance_lots:1, short_balance_lots:2, short_balance_change_lots:1, source:"TWSE_MI_MARGN", source_priority:"OFFICIAL" },
  { trade_date:"2026-08-25", symbol:"2330", name:"台積電", market:"listed", margin_previous_balance_lots:110, margin_balance_lots:null, margin_balance_change_lots:null, short_previous_balance_lots:2, short_balance_lots:4, short_balance_change_lots:2, source:"TWSE_MI_MARGN", source_priority:"OFFICIAL" },
  { trade_date:"2026-08-26", symbol:"2330", name:"台積電", market:"listed", margin_previous_balance_lots:100, margin_balance_lots:90, margin_balance_change_lots:-10, short_previous_balance_lots:4, short_balance_lots:5, short_balance_change_lots:1, source:"TWSE_MI_MARGN", source_priority:"OFFICIAL" },
];
nullObservedShard.symbols["2330"].securities_lending = [
  { trade_date:"2026-08-24", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:900, borrowed_shares:200, returned_shares:50, balance_shares:1050, close_price:1000, balance_value:1050000, source:"TWSE_TWT72U", source_priority:"OFFICIAL" },
  { trade_date:"2026-08-25", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:1050, borrowed_shares:100, returned_shares:null, balance_shares:null, close_price:1000, balance_value:null, source:"TWSE_TWT72U", source_priority:"OFFICIAL" },
  { trade_date:"2026-08-26", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:1000, borrowed_shares:200, returned_shares:50, balance_shares:1150, close_price:1000, balance_value:1150000, source:"TWSE_TWT72U", source_priority:"OFFICIAL" },
];
nullObservedShard.symbols["2330"].sbl_short_sale = [
  { trade_date:"2026-08-24", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:90, sold_shares:10, returned_shares:0, adjustment_shares:0, balance_shares:100, available_shares:999, sold_volume_shares:10, sold_amount:null, source:"TWSE_TWT93U", source_priority:"OFFICIAL" },
  { trade_date:"2026-08-25", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:100, sold_shares:null, returned_shares:5, adjustment_shares:0, balance_shares:null, available_shares:999, sold_volume_shares:null, sold_amount:null, source:"TWSE_TWT93U", source_priority:"OFFICIAL" },
  { trade_date:"2026-08-26", symbol:"2330", name:"台積電", market:"listed", previous_balance_shares:100, sold_shares:25, returned_shares:5, adjustment_shares:0, balance_shares:120, available_shares:999, sold_volume_shares:25, sold_amount:null, source:"TWSE_TWT93U", source_priority:"OFFICIAL" },
];
put("data/market-data/index/2026/08/2.json", nullObservedShard);
const nullObserved = await getTwMarketCrossSection(env, { as_of:"2026-08-26", calendar_days:20, prefix:"2", limit:50 });
assert.equal(nullObserved.status, "READY");
assert.equal(nullObserved.formal_research_eligible, true);
assert.deepEqual(nullObserved.symbols[0].margin.window_days, { "1d":1, "3d":3, "5d":3 });
assert.deepEqual(nullObserved.symbols[0].margin.margin_change_observations, { "1d":1, "3d":2, "5d":2 });
assert.deepEqual(nullObserved.symbols[0].margin.short_change_observations, { "1d":1, "3d":3, "5d":3 });
assert.equal(nullObserved.symbols[0].margin.margin_change_3d, null);
assert.equal(nullObserved.symbols[0].margin.short_change_3d, 4);
assert.deepEqual(nullObserved.symbols[0].securities_lending.window_observations, { "1d":1, "3d":2, "5d":2 });
assert.equal(nullObserved.symbols[0].securities_lending.net_borrowed_3d, null);
assert.deepEqual(nullObserved.symbols[0].sbl_short_sale.window_observations, { "1d":1, "3d":2, "5d":2 });
assert.equal(nullObserved.symbols[0].sbl_short_sale.sold_3d, null);

put("data/market-data/index/2026/08/2.json", readyShard);
put("data/market-data/daily/2026/08/26/manifest.json", readyManifest);

put("data/market-data/daily/2026/08/26/manifest.json", {
  ...readyManifest,
  day_status: "PARTIAL",
  terminal: false,
  ready_layers: 7,
  missing_layers: ["institutional-otc"],
  index_state: { status: "PENDING", completed_prefixes: ["2"], total_prefixes: 10 },
});
const partial = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(partial.status, "DEGRADED");
assert.equal(partial.formal_research_eligible, false);
assert.equal(partial.data_gate.manifest_valid, false);

put("data/market-data/daily/2026/08/26/manifest.json", { ...readyManifest, trade_date: "2026-08-25" });
const wrongDateManifest = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(wrongDateManifest.status, "DEGRADED");
assert.equal(wrongDateManifest.formal_research_eligible, false);
assert.equal(wrongDateManifest.data_gate.manifest_valid, false);
assert.equal(wrongDateManifest.data_gate.manifest_error, "manifest_trade_date_mismatch");

put("data/market-data/daily/2026/08/26/manifest.json", {
  ...readyManifest,
  ready_layers: 7,
  missing_layers: ["institutional-otc"],
});
const inconsistentManifest = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(inconsistentManifest.status, "DEGRADED");
assert.equal(inconsistentManifest.formal_research_eligible, false);
assert.equal(inconsistentManifest.data_gate.manifest_valid, false);

put("data/market-data/daily/2026/08/26/manifest.json", {
  ...readyManifest,
  index_state: { ...readyManifest.index_state, completed_prefixes: ["0","1"], total_prefixes: 2 },
});
const missingPrefixReceipt = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(missingPrefixReceipt.status, "DEGRADED");
assert.equal(missingPrefixReceipt.formal_research_eligible, false);
assert.equal(missingPrefixReceipt.data_gate.requested_prefixes_complete, false);

put("data/market-data/daily/2026/08/26/manifest.json", readyManifest);

const wrongMonthShard = structuredClone(readyShard) as any;
wrongMonthShard.month = "2026-07";
put("data/market-data/index/2026/08/2.json", wrongMonthShard);
const wrongMonth = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(wrongMonth.status, "DEGRADED");
assert.equal(wrongMonth.formal_research_eligible, false);
assert.equal(wrongMonth.scan.invalid_shards.length, 1);
assert.equal(wrongMonth.scan.invalid_shards[0].reason, "shard_month_mismatch");
assert.equal(wrongMonth.scan.symbols_returned, 0);

const wrongSymbolPrefixShard = structuredClone(readyShard) as any;
wrongSymbolPrefixShard.symbols["1330"] = wrongSymbolPrefixShard.symbols["2330"];
delete wrongSymbolPrefixShard.symbols["2330"];
put("data/market-data/index/2026/08/2.json", wrongSymbolPrefixShard);
const wrongSymbolPrefix = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(wrongSymbolPrefix.status, "DEGRADED");
assert.equal(wrongSymbolPrefix.formal_research_eligible, false);
assert.equal(wrongSymbolPrefix.scan.invalid_shards.length, 1);
assert.match(wrongSymbolPrefix.scan.invalid_shards[0].reason, /^shard_symbol_prefix:/);
assert.equal(wrongSymbolPrefix.scan.symbols_returned, 0);

const wrongSchemaShard = structuredClone(readyShard) as any;
wrongSchemaShard.schema_version = "diamond-market-data-symbol-shard/v1";
put("data/market-data/index/2026/08/2.json", wrongSchemaShard);
const wrongSchema = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(wrongSchema.status, "DEGRADED");
assert.equal(wrongSchema.formal_research_eligible, false);
assert.equal(wrongSchema.scan.invalid_shards[0].reason, "shard_schema_invalid");

// Same symbol/kind/day is a duplicate even when market labels differ.
const duplicateDateShard = structuredClone(readyShard) as any;
duplicateDateShard.symbols["2330"].institutional.push({
  ...duplicateDateShard.symbols["2330"].institutional.at(-1),
  market: "otc",
});
put("data/market-data/index/2026/08/2.json", duplicateDateShard);
const duplicateDate = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(duplicateDate.status, "DEGRADED");
assert.equal(duplicateDate.formal_research_eligible, false);
assert.match(duplicateDate.scan.invalid_shards[0].reason, /^shard_duplicate_trade_date:2330:institutional:2026-08-26$/);
assert.equal(duplicateDate.scan.symbols_returned, 0);

// Canonical rows must carry their own symbol identity; absence is invalid.
const missingRowSymbolShard = structuredClone(readyShard) as any;
delete missingRowSymbolShard.symbols["2330"].margin[0].symbol;
put("data/market-data/index/2026/08/2.json", missingRowSymbolShard);
const missingRowSymbol = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(missingRowSymbol.status, "DEGRADED");
assert.equal(missingRowSymbol.formal_research_eligible, false);
assert.equal(missingRowSymbol.scan.invalid_shards[0].reason, "shard_row_symbol:2330:margin");
assert.equal(missingRowSymbol.scan.symbols_returned, 0);

// Malformed shard payloads are fail-closed DEGRADED receipts, not thrown MCP failures.
memory.set("data/market-data/index/2026/08/2.json", { sha:"sha-malformed", text:"{" });
const malformedShard = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(malformedShard.status, "DEGRADED");
assert.equal(malformedShard.formal_research_eligible, false);
assert.equal(malformedShard.scan.missing_shards.length, 0);
assert.equal(malformedShard.scan.invalid_shards.length, 1);
assert.match(malformedShard.scan.invalid_shards[0].reason, /^shard_read_error:/);
assert.equal(malformedShard.scan.symbols_returned, 0);

put("data/market-data/index/2026/08/2.json", readyShard);
put("data/market-data/daily/2026/08/26/manifest.json", readyManifest);

await assert.rejects(() => getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"20" }), /invalid prefix/);

// Production-path regression: one immutable revision + large Contents fallback.
const originalFetch = globalThis.fetch;
const revision = "a".repeat(40);
const manifestBlob = "b".repeat(40);
const shardBlob = "c".repeat(40);
const seen: string[] = [];
const jsonContent = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8").toString("base64");
try {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("/commits/main")) {
      return new Response(JSON.stringify({ sha: revision }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/contents/data/market-data/daily/2026/08/26/manifest.json")) {
      return new Response(JSON.stringify({ sha:manifestBlob, encoding:"base64", content:jsonContent(readyManifest) }), { status: 200, headers: { "content-type":"application/json" } });
    }
    if (url.includes("/contents/data/market-data/index/2026/08/2.json")) {
      return new Response(JSON.stringify({ sha:shardBlob, size:2_847_044, encoding:"none", content:"" }), { status: 200, headers: { "content-type":"application/json" } });
    }
    if (url.includes(`/git/blobs/${shardBlob}`)) {
      return new Response(JSON.stringify({ sha:shardBlob, encoding:"base64", content:jsonContent(readyShard) }), { status: 200, headers: { "content-type":"application/json" } });
    }
    return new Response(JSON.stringify({ message:"not found" }), { status:404, headers:{ "content-type":"application/json" } });
  }) as typeof fetch;

  const pinned = await getTwMarketCrossSection({ GITHUB_DATA_REPO:"keywayk09/tv-papertrader", GITHUB_DATA_BRANCH:"main" } as any, {
    as_of:"2026-08-26",
    calendar_days:20,
    prefix:"2",
    limit:50,
  });
  assert.equal(pinned.status, "READY");
  assert.equal(pinned.formal_research_eligible, true);
  assert.equal(pinned.source_revision, revision);
  assert.equal(pinned.data_gate.manifest_valid, true);
  assert.deepEqual(pinned.scan.invalid_shards, []);
  assert.equal(pinned.symbols[0].margin.margin_change_3d, null);

  const contentReads = seen.filter((url) => url.includes("/contents/"));
  assert.equal(contentReads.length, 2);
  assert.equal(contentReads.every((url) => url.includes(`ref=${revision}`)), true);
  assert.equal(contentReads.some((url) => url.includes("ref=main")), false);

  const blobReads = seen.filter((url) => url.includes("/git/blobs/"));
  assert.deepEqual(blobReads, [`https://api.github.com/repos/keywayk09/tv-papertrader/git/blobs/${shardBlob}`]);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("market-data decoded cross-sectional reader tests passed");
