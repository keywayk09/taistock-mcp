import assert from "node:assert/strict";
import { getTwMarketCrossSection } from "../src/v6/market-data-cross-section.ts";

const memory = new Map<string, { sha: string; text: string }>();
const env = { __GITHUB_DATA_MEMORY: memory } as any;

function put(path: string, value: unknown) {
  memory.set(path, { sha: `sha-${path}`, text: JSON.stringify(value, null, 2) + "\n" });
}

put("data/market-data/daily/2026/08/26/manifest.json", {
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
});

put("data/market-data/index/2026/08/2.json", {
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
});

const ready = await getTwMarketCrossSection(env, { as_of:"2026-08-26", calendar_days:20, prefix:"2", limit:50 });
assert.equal(ready.status, "READY");
assert.equal(ready.formal_research_eligible, true);
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

await assert.rejects(() => getTwMarketCrossSection(env, { as_of:"2026-08-26", prefix:"20" }), /invalid prefix/);
console.log("market-data decoded cross-sectional reader tests passed");
