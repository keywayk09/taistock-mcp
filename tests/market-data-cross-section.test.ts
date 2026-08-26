import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { getTwMarketCrossSection } from "../src/v6/market-data-cross-section.ts";

const memory = new Map<string, { sha: string; text: string }>();
const env = { __GITHUB_DATA_MEMORY: memory } as any;

function put(path: string, value: unknown) {
  memory.set(path, { sha: `sha-${path}`, text: JSON.stringify(value, null, 2) + "\n" });
}

const readyManifest = {
  trade_date: "2026-08-26",
  day_status: "COMPLETE",
  terminal: true,
  ready_layers: 8,
  expected_layers: 8,
  missing_layers: [],
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
assert.equal(ready.data_gate.requested_prefixes_complete, true);
assert.equal(ready.scan.symbols_returned, 1);
assert.equal(ready.symbols[0].symbol, "2330");
assert.equal(ready.symbols[0].coverage.ready_layers, 4);
assert.equal(ready.symbols[0].institutional.net_1d, 37);
assert.equal(ready.symbols[0].institutional.net_3d, 75);
assert.equal(ready.symbols[0].margin.margin_change_1d, -10);
assert.equal(ready.symbols[0].securities_lending.net_borrowed_1d, 150);
assert.equal(ready.symbols[0].sbl_short_sale.sold_1d, 25);

// Formal research must fail closed when the daily index has not completed.
put("data/market-data/daily/2026/08/26/manifest.json", {
  trade_date: "2026-08-26",
  day_status: "PARTIAL",
  terminal: false,
  ready_layers: 7,
  expected_layers: 8,
  missing_layers: ["institutional-otc"],
  index_state: { status: "PENDING", completed_prefixes: ["2"], total_prefixes: 10 },
});
const partial = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(partial.status, "DEGRADED");
assert.equal(partial.formal_research_eligible, false);

// Even a nominal READY manifest cannot authorize a prefix the manifest did not
// complete. This protects partial index generations from being used formally.
put("data/market-data/daily/2026/08/26/manifest.json", {
  ...readyManifest,
  index_state: { ...readyManifest.index_state, completed_prefixes: ["0","1"] },
});
const missingPrefixReceipt = await getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"2" });
assert.equal(missingPrefixReceipt.status, "DEGRADED");
assert.equal(missingPrefixReceipt.formal_research_eligible, false);
assert.equal(missingPrefixReceipt.data_gate.requested_prefixes_complete, false);

await assert.rejects(() => getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"20" }), /invalid prefix/);

// Production-path regression: resolve the moving branch once, then prove every
// canonical contents request is pinned to that exact immutable commit SHA.
const originalFetch = globalThis.fetch;
const revision = "a".repeat(40);
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
      return new Response(JSON.stringify({ sha:"manifest-blob", content:jsonContent(readyManifest) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/contents/data/market-data/index/2026/08/2.json")) {
      return new Response(JSON.stringify({ sha:"shard-blob", content:jsonContent(readyShard) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ message:"not found" }), { status: 404, headers: { "content-type": "application/json" } });
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
  const contentReads = seen.filter((url) => url.includes("/contents/"));
  assert.equal(contentReads.length, 2);
  assert.equal(contentReads.every((url) => url.includes(`ref=${revision}`)), true);
  assert.equal(contentReads.some((url) => url.includes("ref=main")), false);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("market-data decoded cross-sectional reader tests passed");
