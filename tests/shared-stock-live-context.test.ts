import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFamilyStockMarketContext } from "../src/v6/family-ohlc-read-bridge.ts";

function liveContext(symbol = "2317") {
  return {
    ok: true,
    market: "stock",
    symbol,
    historical: {},
    live: {
      ok: true,
      symbol,
      live_status: "READY",
      decision_eligible: true,
      rpc_display_ready: true,
      rpc_wait_ms: 325,
      connection: { alive: true, authenticated: true, last_error: "" },
      stream: { trade_fresh: true, book_fresh: true, market_quiet: false, profile: "FULL" },
      snapshot: {
        symbol,
        last_price: 243,
        best_bid: 242.5,
        best_ask: 243,
        state: "BUY_CONTROL",
        feed: { quality: "FULL", trade_age_ms: 200, book_age_ms: 150 },
        book: {
          bids: [
            { price: 242.5, size: 100 }, { price: 242, size: 80 }, { price: 241.5, size: 70 },
            { price: 241, size: 60 }, { price: 240.5, size: 50 },
          ],
          asks: [
            { price: 243, size: 90 }, { price: 243.5, size: 85 }, { price: 244, size: 75 },
            { price: 244.5, size: 65 }, { price: 245, size: 55 },
          ],
          bid_depth: 360,
          ask_depth: 370,
          imbalance: -0.0137,
        },
        recent_trades: [{
          time: 1_777_000_000_000,
          serial: 1,
          price: 243,
          size: 120,
          bid: 242.5,
          ask: 243,
          side: "buy",
          aggressor: "BUY",
          taiwan_side: "OUTSIDE",
          classification_method: "quote",
          cumulative_volume: 35_312,
          is_large: true,
        }],
        trade_tape: {
          window_ms: 180_000,
          returned: 1,
          available_in_window: 1,
          limit: 300,
          truncated: false,
          large_trade_threshold: 100,
          classification: "quote_then_tick_rule",
          persisted: false,
        },
        windows: { "30s": { delta: 120, buy_ratio: 0.63 }, "60s": { delta: 180, buy_ratio: 0.61 } },
        context_30m: { delta: 1250, buy_ratio: 0.57 },
      },
      persistence: "none",
    },
    contract: {
      source: "OHLC_READ_SERVICE_STOCK_LIVE",
      persistence: "none",
      writes: { github: false, ohlc: false, kv: false, r2: false, d1: false, orders: false },
    },
  };
}

const calls: any[] = [];
const env = {
  OHLC_READ_SERVICE: {
    async readOhlc() { return { ok: false }; },
    async readTxfOhlc() { return { ok: false }; },
    async getTxfOhlcStatus() { return { ok: false }; },
    async readGlobalOhlc() { return { ok: false }; },
    async readGlobalFuturesOhlc() { return { ok: false }; },
    async getGlobalFuturesStatus() { return { ok: false }; },
    async readStockMarketContext(args: any) {
      calls.push(args);
      return liveContext(args.symbol);
    },
  },
} as any;

const result = await readFamilyStockMarketContext(env, { symbol: "2317", books: true, wait_ms: 1_800 });
assert.equal(result.status, "READY");
assert.equal(result.source, "OHLC_READ_SERVICE_STOCK_LIVE");
assert.equal(result.symbol, "2317");
assert.equal(result.display_ready, true);
assert.equal(result.book.bids.length, 5);
assert.equal(result.book.asks.length, 5);
assert.equal(result.recent_trades.length, 1);
assert.equal(result.recent_trades[0].aggressor, "BUY");
assert.equal(result.trade_tape?.persisted, false);
assert.equal(result.order_flow?.state, "BUY_CONTROL");
assert.equal(result.persistence, "none");
assert.deepEqual(calls, [{ symbol: "2317", books: true, wait_ms: 1800, history_days: 120, history_limit: 160 }]);

const noBinding = await readFamilyStockMarketContext({} as any, { symbol: "2317", books: true });
assert.equal(noBinding.status, "UNAVAILABLE");
assert.equal(noBinding.persistence, "none");
assert.equal(noBinding.error, "OHLC_READ_SERVICE_STOCK_LIVE_NOT_BOUND");

// Production fallback: direct, read-only Fugle REST quote + trades. No Worker binding.
const originalFetch = globalThis.fetch;
const nowUs = Date.now() * 1_000;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/intraday/quote/2317")) {
    return new Response(JSON.stringify({
      symbol: "2317",
      lastPrice: 243,
      lastUpdated: nowUs,
      bids: [
        { price: 242.5, size: 100 }, { price: 242, size: 80 }, { price: 241.5, size: 70 },
        { price: 241, size: 60 }, { price: 240.5, size: 50 },
      ],
      asks: [
        { price: 243, size: 90 }, { price: 243.5, size: 85 }, { price: 244, size: 75 },
        { price: 244.5, size: 65 }, { price: 245, size: 55 },
      ],
      total: { tradeVolume: 35_312, tradeVolumeAtBid: 14_000, tradeVolumeAtAsk: 18_000, transaction: 5_000 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/intraday/trades/2317")) {
    return new Response(JSON.stringify({
      symbol: "2317",
      data: [
        { bid: 242.5, ask: 243, price: 243, size: 120, volume: 35_312, time: nowUs, serial: 3 },
        { bid: 242.5, ask: 243, price: 242.5, size: 80, volume: 35_192, time: nowUs - 1_000_000, serial: 2 },
        { bid: 242, ask: 242.5, price: 242.5, size: 60, volume: 35_112, time: nowUs - 2_000_000, serial: 1 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;
try {
  const direct = await readFamilyStockMarketContext({
    GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
    FUGLE_API_KEY: "test-key",
  } as any, { symbol: "2317", books: true });
  assert.equal(direct.status, "READY");
  assert.equal(direct.source, "FUGLE_REST_READ_ONLY");
  assert.equal(direct.last_price, 243);
  assert.equal(direct.book.bids.length, 5);
  assert.equal(direct.book.asks.length, 5);
  assert.equal(direct.recent_trades.length, 3);
  assert.equal(direct.recent_trades[0].price, 243);
  assert.equal(direct.recent_trades[0].aggressor, "BUY");
  assert.equal(direct.recent_trades[0].taiwan_side, "OUTSIDE");
  assert.equal(direct.persistence, "none");
  assert.equal(direct.contract?.writes?.github, false);
  assert.equal(direct.contract?.writes?.orders, false);
} finally {
  globalThis.fetch = originalFetch;
}

const wranglerText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const wrangler = JSON.parse(wranglerText.replace(/\/\*[\s\S]*?\*\//g, ""));
assert.equal(Array.isArray(wrangler.services) ? wrangler.services.length : 0, 0);

const index = await readFile(new URL("../src/index-v6.ts", import.meta.url), "utf8");
const ownerContent = await readFile(new URL("../src/v6/owner-content-handler.ts", import.meta.url), "utf8");
assert.match(ownerContent, /registerSharedStockMarketContextTools/);
assert.match(ownerContent, /"get_quote"/);
assert.match(ownerContent, /"get_daily_price"/);
assert.doesNotMatch(index, /\/api\/live-market-context/);

const ownerTools = await readFile(new URL("../src/v6/shared-stock-market-context-tools.ts", import.meta.url), "utf8");
assert.match(ownerTools, /registerTool\("get_stock_market_context"/);
assert.match(ownerTools, /registerTool\("get_stock_trade_tape"/);
assert.match(ownerTools, /registerTool\("get_quote"/);
assert.match(ownerTools, /registerTool\("get_daily_price"/);
assert.match(ownerTools, /readFamilyStockMarketContext/);
assert.match(ownerTools, /readFamilyCanonicalOhlc/);
assert.match(ownerTools, /recent_trades/);
assert.match(ownerTools, /trade_tape/);
assert.match(ownerTools, /classification_method/);
assert.match(ownerTools, /taiwan_side/);
assert.match(ownerTools, /FUGLE_REST_READ_ONLY/);
assert.doesNotMatch(ownerTools, /updateGitHubJson|putImmutableGitHubJson|order_placement|placeOrder|submitOrder/);

const familyMcp = await readFile(new URL("../src/v6/family-mcp.ts", import.meta.url), "utf8");
assert.match(familyMcp, /get_family_stock_market_context/);
assert.match(familyMcp, /readFamilyStockMarketContext/);

const adapter = await readFile(new URL("../src/v6/cross-account-read-service.ts", import.meta.url), "utf8");
assert.match(adapter, /intraday\/quote/);
assert.match(adapter, /intraday\/trades/);
assert.match(adapter, /data\/OHLC\/tw\/1d/);
assert.match(adapter, /readGitHubText/);
assert.doesNotMatch(adapter, /updateGitHubJson|putImmutableGitHubJson|placeOrder|submitOrder/);

console.log("shared-stock-live-context: PASS");
