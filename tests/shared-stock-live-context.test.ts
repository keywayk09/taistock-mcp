import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFamilyStockMarketContext } from "../src/v6/family-ohlc-read-bridge.ts";

function liveContext(symbol = "2317") {
  return {
    ok: true,
    market: "stock",
    symbol,
    historical: {
      daily: {
        ok: true,
        data_status: "OK",
        rows: [{ date: "2026-08-25", symbol, close: 243 }],
      },
    },
    live: {
      ok: true,
      symbol,
      live_status: "READY",
      decision_eligible: true,
      rpc_display_ready: true,
      rpc_wait_ms: 325,
      connection: {
        alive: true,
        authenticated: true,
        last_error: "",
      },
      stream: {
        trade_fresh: true,
        book_fresh: true,
        market_quiet: false,
        profile: "FULL",
      },
      snapshot: {
        symbol,
        last_price: 243,
        best_bid: 242.5,
        best_ask: 243,
        state: "BUY_CONTROL",
        feed: {
          quality: "FULL",
          trade_age_ms: 200,
          book_age_ms: 150,
        },
        book: {
          bids: [
            { price: 242.5, size: 100 },
            { price: 242, size: 80 },
            { price: 241.5, size: 70 },
            { price: 241, size: 60 },
            { price: 240.5, size: 50 },
          ],
          asks: [
            { price: 243, size: 90 },
            { price: 243.5, size: 85 },
            { price: 244, size: 75 },
            { price: 244.5, size: 65 },
            { price: 245, size: 55 },
          ],
          bid_depth: 360,
          ask_depth: 370,
          imbalance: -0.0137,
        },
        windows: {
          "30s": { delta: 120, buy_ratio: 0.63 },
          "60s": { delta: 180, buy_ratio: 0.61 },
        },
        context_30m: {
          delta: 1250,
          buy_ratio: 0.57,
        },
      },
      persistence: "none",
    },
    contract: {
      persistence: "none",
      writes: {
        github: false,
        ohlc: false,
        kv: false,
        r2: false,
        d1: false,
        orders: false,
      },
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

const result = await readFamilyStockMarketContext(env, {
  symbol: "2317",
  books: true,
  wait_ms: 1_800,
});

assert.equal(result.status, "READY");
assert.equal(result.source, "OHLC_READ_SERVICE_STOCK_LIVE");
assert.equal(result.symbol, "2317");
assert.equal(result.live_status, "READY");
assert.equal(result.display_ready, true);
assert.equal(result.decision_eligible, true);
assert.equal(result.formal_research_eligible, false);
assert.equal(result.last_price, 243);
assert.equal(result.best_bid, 242.5);
assert.equal(result.best_ask, 243);
assert.equal(result.book.bids.length, 5);
assert.equal(result.book.asks.length, 5);
assert.equal(result.book.bids[0].size, 100);
assert.equal(result.book.asks[0].size, 90);
assert.equal(result.book.imbalance, -0.0137);
assert.equal(result.order_flow?.state, "BUY_CONTROL");
assert.equal(result.order_flow?.windows?.["30s"]?.delta, 120);
assert.equal(result.persistence, "none");
assert.equal(result.error, null);
assert.deepEqual(calls, [{
  symbol: "2317",
  books: true,
  wait_ms: 1800,
  history_days: 120,
  history_limit: 160,
}]);

const noBinding = await readFamilyStockMarketContext({} as any, {
  symbol: "2317",
  books: true,
});
assert.equal(noBinding.status, "UNAVAILABLE");
assert.equal(noBinding.display_ready, false);
assert.equal(noBinding.formal_research_eligible, false);
assert.equal(noBinding.persistence, "none");
assert.equal(noBinding.error, "OHLC_READ_SERVICE_STOCK_LIVE_NOT_BOUND");

const noLiveMethod = await readFamilyStockMarketContext({
  OHLC_READ_SERVICE: { async readOhlc() { return {}; } },
} as any, { symbol: "2317" });
assert.equal(noLiveMethod.status, "UNAVAILABLE");
assert.equal(noLiveMethod.error, "OHLC_READ_SERVICE_STOCK_LIVE_NOT_BOUND");

const wranglerText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const wrangler = JSON.parse(wranglerText.replace(/\/\*[\s\S]*?\*\//g, ""));
const serviceBindings = (wrangler.services ?? []).filter((item: any) => item.binding === "OHLC_READ_SERVICE");
assert.equal(serviceBindings.length, 1);
assert.deepEqual(serviceBindings[0], {
  binding: "OHLC_READ_SERVICE",
  service: "tv-fugle-1d",
  entrypoint: "OhlcFamilyReadService",
});

const index = await readFile(new URL("../src/index-v6.ts", import.meta.url), "utf8");
assert.match(index, /registerSharedStockMarketContextTools/);
assert.match(index, /"get_quote"/);
assert.match(index, /"get_daily_price"/);
assert.match(index, /shared_read_service: "tv-fugle-1d\/OhlcFamilyReadService"/);
assert.doesNotMatch(index, /\/api\/live-market-context/);

const ownerTools = await readFile(new URL("../src/v6/shared-stock-market-context-tools.ts", import.meta.url), "utf8");
assert.match(ownerTools, /registerTool\("get_stock_market_context"/);
assert.match(ownerTools, /registerTool\("get_quote"/);
assert.match(ownerTools, /registerTool\("get_daily_price"/);
assert.match(ownerTools, /readFamilyStockMarketContext/);
assert.match(ownerTools, /readFamilyCanonicalOhlc/);
assert.match(ownerTools, /OHLC_READ_SERVICE_STOCK_LIVE/);
assert.match(ownerTools, /FUGLE_REST_DISPLAY_FALLBACK/);
assert.doesNotMatch(ownerTools, /GitHub|GITHUB_TOKEN|\.put\(|order_placement|placeOrder|submitOrder/);

const familyMcp = await readFile(new URL("../src/v6/family-mcp.ts", import.meta.url), "utf8");
assert.match(familyMcp, /get_family_stock_market_context/);
assert.match(familyMcp, /readFamilyStockMarketContext/);
assert.match(familyMcp, /EPHEMERAL_READ_ONLY_NO_CANONICAL_WRITE/);

const familyAnalysis = await readFile(new URL("../src/v6/family-analysis.ts", import.meta.url), "utf8");
assert.match(familyAnalysis, /stock_live_context/);
assert.match(familyAnalysis, /stock_live_display_ready/);
assert.match(familyAnalysis, /STOCK_LIVE_HUB_READ_ONLY_EPHEMERAL/);

const bridge = await readFile(new URL("../src/v6/family-ohlc-read-bridge.ts", import.meta.url), "utf8");
assert.match(bridge, /readStockMarketContext/);
assert.match(bridge, /wait_ms/);
assert.doesNotMatch(bridge, /syncOhlc|backfillOhlc|writeOhlc|GITHUB_TOKEN|placeOrder|submitOrder/);

console.log("shared-stock-live-context: PASS");
