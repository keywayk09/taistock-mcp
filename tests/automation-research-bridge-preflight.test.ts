import assert from "node:assert/strict";
import { readFormalBlindOhlc } from "../src/v6/formal-blind-ohlc-reader.ts";
import { getTwMarketCrossSection } from "../src/v6/market-data-cross-section.ts";

// This is a pre-implementation contract test. It deliberately exercises only
// the existing canonical readers so the future Automation HTTP bridge cannot
// weaken Blind cutoff, official verification, immutable market-data gates, or
// fail-closed behavior.

const HEADER = "symbol,bar_time_tw,ts_ms,open,high,low,close,volume,source,updated_at_ms,trade_date,updated_at,ingest_id,export_batch,export_status";

function minuteTs(date: string, hhmm: string) {
  return Date.parse(`${date}T${hhmm}:00+08:00`);
}

function minuteRow(date: string, symbol: string, hhmm: string, price: number) {
  const ts = minuteTs(date, hhmm);
  return [
    symbol,
    `${date} ${hhmm}:00`,
    ts,
    price,
    price + 1,
    price - 1,
    price + 0.5,
    1000,
    "fixture",
    ts + 1000,
    date,
    `${date} 14:00:00`,
    `${symbol}|${ts}`,
    "",
    "",
  ].join(",");
}

function blindEnv(date: string, symbol: string) {
  // Include bars beyond the decision time on purpose. The reader must never
  // return them to the research model.
  const rows = ["09:00", "09:01", "09:02", "09:03", "09:04", "09:05", "09:06"]
    .map((hhmm, index) => minuteRow(date, symbol, hhmm, 100 + index));
  const path = `data/OHLC/tw/1m/${date.slice(0, 4)}/${date.slice(5, 7)}/${date.slice(8, 10)}/${symbol}.csv`;
  return {
    GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
    GITHUB_DATA_BRANCH: "main",
    __GITHUB_DATA_MEMORY: new Map([[path, { sha: `fixture-${date}-${symbol}`, text: [HEADER, ...rows, ""].join("\n") }]]),
  } as any;
}

function verifiedReceipt(date: string, symbol: string, decisionTime = "09:05:00") {
  return new Response(JSON.stringify({
    ok: true,
    formal_blind_eligible: true,
    symbol,
    timeframe: "1m",
    trade_date: date,
    decision_time: decisionTime,
    cutoff: { leakage_validated: true, prefix_completeness: true },
    verification: { accepted_for_research: true, level: "official_day_verified" },
    dataset_hash: `proof-${date}-${symbol}`,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function assertFormalBlindWorks(date: string, symbol: string, label: string) {
  const result = await readFormalBlindOhlc(
    blindEnv(date, symbol),
    { symbol, trade_date: date, timeframe: "1m", decision_time: "09:05", limit: 300 },
    (async () => verifiedReceipt(date, symbol)) as any,
  ) as any;

  assert.equal(result.ok, true, `${label}: canonical source must be readable`);
  assert.equal(result.formal_blind_eligible, true, `${label}: formal Blind must stay eligible only after verification`);
  assert.equal(result.formal_research_eligible, true, `${label}: formal research gate`);
  assert.equal(result.scorecard_eligible, true, `${label}: scorecard gate`);
  assert.equal(result.leakage_validated, true, `${label}: leakage gate`);
  assert.equal(result.cutoff?.prefix_completeness, true, `${label}: prefix completeness`);
  assert.deepEqual(
    result.rows.map((row: any) => row.bar_time_tw),
    ["09:00", "09:01", "09:02", "09:03", "09:04"].map((hhmm) => `${date} ${hhmm}:00`),
    `${label}: no unfinished or future bar may cross the decision-time boundary`,
  );
}

// Weekday production-style Blind review.
await assertFormalBlindWorks("2026-08-28", "2330", "weekday Blind");

// Saturday/Sunday Historical Blind Exam still reads a past trading date. The
// canonical reader must not depend on the current wall-clock weekday.
await assertFormalBlindWorks("2026-08-06", "2317", "weekend Historical Blind");

// Official verification rejection must remain fail-closed.
const rejected = await readFormalBlindOhlc(
  blindEnv("2026-08-28", "2330"),
  { symbol: "2330", trade_date: "2026-08-28", timeframe: "1m", decision_time: "09:05", limit: 300 },
  (async () => new Response(JSON.stringify({
    ok: true,
    formal_blind_eligible: false,
    symbol: "2330",
    timeframe: "1m",
    trade_date: "2026-08-28",
    decision_time: "09:05:00",
    cutoff: { leakage_validated: true, prefix_completeness: true },
    verification: { accepted_for_research: false },
    eligibility_reason: "OFFICIAL_NOT_VERIFIED",
  }), { status: 200, headers: { "content-type": "application/json" } })) as any,
) as any;
assert.equal(rejected.formal_blind_eligible, false);
assert.equal(rejected.scorecard_eligible, false);
assert.equal(rejected.eligibility_reason, "OFFICIAL_NOT_VERIFIED");

function marketMemory() {
  const memory = new Map<string, { sha: string; text: string }>();
  const put = (path: string, value: unknown) => {
    memory.set(path, { sha: `sha-${path}`, text: `${JSON.stringify(value)}\n` });
  };

  const date = "2026-08-28";
  const root = `data/market-data/daily/2026/08/28`;
  const layers = [
    ["institutional", "listed"], ["institutional", "otc"],
    ["margin", "listed"], ["margin", "otc"],
    ["securities_lending", "listed"], ["securities_lending", "otc"],
    ["sbl_short_sale", "listed"], ["sbl_short_sale", "otc"],
  ].map(([kind, market]) => ({
    kind,
    market,
    status: "READY",
    snapshot_path: `${root}/${kind}-${market}.json`,
  }));

  put(`${root}/manifest.json`, {
    schema_version: "diamond-market-data-manifest/v2",
    trade_date: date,
    day_status: "COMPLETE",
    terminal: true,
    ready_layers: 8,
    expected_layers: 8,
    missing_layers: [],
    layers,
    index_state: {
      status: "READY",
      completed_prefixes: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      total_prefixes: 10,
    },
  });

  for (let prefix = 0; prefix <= 9; prefix += 1) {
    const p = String(prefix);
    const symbol = `${p}001`;
    put(`data/market-data/index/2026/08/${p}.json`, {
      schema_version: "diamond-market-data-symbol-shard/v2",
      month: "2026-08",
      prefix: p,
      symbols: {
        [symbol]: {
          institutional: [{
            trade_date: date, symbol, name: `測試${p}`, market: "listed",
            foreign_net_shares: 10, trust_net_shares: 2, dealer_net_shares: 1,
            total_net_shares: 13, source: "OFFICIAL", source_priority: "OFFICIAL",
          }],
          margin: [{
            trade_date: date, symbol, name: `測試${p}`, market: "listed",
            margin_previous_balance_lots: 100, margin_balance_lots: 90,
            margin_balance_change_lots: -10, short_previous_balance_lots: 4,
            short_balance_lots: 5, short_balance_change_lots: 1,
            source: "OFFICIAL", source_priority: "OFFICIAL",
          }],
          securities_lending: [{
            trade_date: date, symbol, name: `測試${p}`, market: "listed",
            previous_balance_shares: 1000, borrowed_shares: 200, returned_shares: 50,
            balance_shares: 1150, close_price: 100, balance_value: 115000,
            source: "OFFICIAL", source_priority: "OFFICIAL",
          }],
          sbl_short_sale: [{
            trade_date: date, symbol, name: `測試${p}`, market: "listed",
            previous_balance_shares: 100, sold_shares: 25, returned_shares: 5,
            adjustment_shares: 0, balance_shares: 120, available_shares: 999,
            sold_volume_shares: 25, sold_amount: null,
            source: "OFFICIAL", source_priority: "OFFICIAL",
          }],
        },
      },
      updated_at: "2026-08-28T14:21:00Z",
    });
  }

  return memory;
}

// Full 0..9 whole-market reader must execute server-side as one formal read.
const wholeMarketEnv = { __GITHUB_DATA_MEMORY: marketMemory() } as any;
const wholeMarket = await getTwMarketCrossSection(wholeMarketEnv, {
  as_of: "2026-08-28",
  calendar_days: 20,
  limit: 2500,
}) as any;
assert.equal(wholeMarket.status, "READY");
assert.equal(wholeMarket.formal_research_eligible, true);
assert.equal(wholeMarket.source_revision, "memory:main");
assert.equal(wholeMarket.data_gate.requested_prefixes_complete, true);
assert.deepEqual(wholeMarket.scan.missing_shards, []);
assert.deepEqual(wholeMarket.scan.invalid_shards, []);
assert.equal(wholeMarket.scan.symbols_discovered, 10);
assert.equal(wholeMarket.scan.symbols_returned, 10);

// One malformed shard must invalidate the formal whole-market research gate.
const badMemory = marketMemory();
const badPath = "data/market-data/index/2026/08/7.json";
const bad = JSON.parse(badMemory.get(badPath)!.text);
bad.schema_version = "broken-schema";
badMemory.set(badPath, { sha: "sha-bad-7", text: `${JSON.stringify(bad)}\n` });
const degraded = await getTwMarketCrossSection({ __GITHUB_DATA_MEMORY: badMemory } as any, {
  as_of: "2026-08-28",
  calendar_days: 20,
  limit: 2500,
}) as any;
assert.equal(degraded.status, "DEGRADED");
assert.equal(degraded.formal_research_eligible, false);
assert.equal(degraded.scan.invalid_shards.length, 1);

console.log("automation-research-bridge-preflight: PASS");
