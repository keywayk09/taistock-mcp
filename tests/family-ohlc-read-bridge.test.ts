import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  readFamilyCanonicalOhlc,
  readFamilyMarketRegimeContext,
  shouldUseFamilyIntradayContext,
  shouldUseFamilyRegimeContext,
} from "../src/v6/family-ohlc-read-bridge.ts";
import { planFamilyQuery } from "../src/v6/family-adaptive-planner.ts";

function verifiedStock(symbol: string, timeframe: string) {
  return {
    ok: true,
    blocked: false,
    data_status: "OK",
    market: "tw-stock",
    symbol,
    timeframe,
    mode: "research",
    source: "github_historical",
    resolved_date: "2026-08-21",
    dataset_id: `tw-stock:${symbol}:${timeframe}`,
    dataset_version: `sha256:${"a".repeat(64)}`,
    dataset_hash: "a".repeat(64),
    dataset_complete_view: true,
    formal_research_eligible: true,
    quality: { gate: "PASS" },
    provenance: { verification_level: "official_day_verified" },
    rows: [{ date: "2026-08-21", symbol, close: 100 }],
  };
}

const calls: Array<{ method: string; args: any }> = [];
const service = {
  async readOhlc(args: any) {
    calls.push({ method: "readOhlc", args });
    return verifiedStock(args.symbol, args.timeframe);
  },
  async readTxfOhlc(args: any) {
    calls.push({ method: "readTxfOhlc", args });
    return { ok: true, blocked: false, status: "READY", verification_level: "FUGLE_PROVIDER_CAPTURED", rows: [{ close: 23000 }] };
  },
  async getTxfOhlcStatus(args: any) {
    calls.push({ method: "getTxfOhlcStatus", args });
    return { ok: true };
  },
  async readGlobalOhlc(args: any) {
    calls.push({ method: "readGlobalOhlc", args });
    return { ok: true };
  },
  async readGlobalFuturesOhlc(args: any) {
    calls.push({ method: "readGlobalFuturesOhlc", args });
    return {
      ok: true,
      blocked: false,
      status: "READY",
      product: args.product,
      timeframe: args.timeframe,
      trade_date: "2026-08-21",
      source: "OHLC_MCP_GLOBAL_FUTURES",
      formal_research_eligible: true,
      verification_level: "VERIFIED_RECEIPT_GZIP_LOGICAL_SHA256_BOUND",
      dataset_version: `sha256:${"b".repeat(64)}`,
      provenance: { canonical_path: `data/Futures/v2/${args.product}/1m/2026/08/21/${args.product}.csv.gz` },
      rows: [{ close: 1 }],
    };
  },
  async getGlobalFuturesStatus(args: any) {
    calls.push({ method: "getGlobalFuturesStatus", args });
    return { ok: true };
  },
};

const env = { OHLC_READ_SERVICE: service } as any;

assert.equal(shouldUseFamilyIntradayContext("3105 技術位置與支撐", "QUICK_STOCK_QUESTION"), true);
assert.equal(shouldUseFamilyIntradayContext("3105 去年營收如何", "QUICK_STOCK_QUESTION"), false);
assert.equal(shouldUseFamilyRegimeContext("3105 技術位置", "QUICK_STOCK_QUESTION"), true);
assert.equal(shouldUseFamilyRegimeContext("3105 去年營收如何", "QUICK_STOCK_QUESTION"), false);

calls.length = 0;
const canonical = await readFamilyCanonicalOhlc(env, {
  symbol: "3105",
  as_of_date: "2026-08-24",
  question: "3105 技術位置與支撐",
  intent: "QUICK_STOCK_QUESTION",
});
assert.equal(canonical.status, "READY");
assert.equal(canonical.source, "OHLC_MCP");
assert.equal(canonical.formal_research_eligible, true);
assert.equal(canonical.daily?.formal_research_eligible, true);
assert.equal(canonical.intraday_5m?.formal_research_eligible, true);
assert.equal(calls.filter((x) => x.method === "readOhlc").length, 2);
const dailyCall = calls.find((x) => x.method === "readOhlc" && x.args.timeframe === "1d");
assert.equal(dailyCall?.args.mode, "research");
assert.equal(dailyCall?.args.to, "2026-08-24");
assert.equal(dailyCall?.args.limit, 420);

const unavailable = await readFamilyCanonicalOhlc({} as any, {
  symbol: "3105",
  as_of_date: "2026-08-24",
});
assert.equal(unavailable.status, "UNAVAILABLE");
assert.equal(unavailable.formal_research_eligible, false);
assert.equal(unavailable.error, "OHLC_READ_SERVICE_NOT_BOUND");

calls.length = 0;
const skippedRegime = await readFamilyMarketRegimeContext(env, {
  as_of_date: "2026-08-24",
  question: "3105 去年營收如何",
  intent: "QUICK_STOCK_QUESTION",
});
assert.equal(skippedRegime.txf_context.status, "UNAVAILABLE");
assert.equal(skippedRegime.txf_context.error, "NOT_REQUIRED_BY_ADAPTIVE_PLAN");
assert.equal(calls.length, 0);

calls.length = 0;
const regime = await readFamilyMarketRegimeContext(env, {
  as_of_date: "2026-08-24",
  question: "3105 完整分析，含技術與市場風險",
  intent: "FULL_STOCK_ANALYSIS",
});
assert.equal(regime.txf_context.status, "READY");
assert.equal(regime.txf_context.formal_research_eligible, false);
assert.equal(regime.global_futures_context.status, "READY");
assert.equal(regime.global_futures_context.formal_research_eligible, false);
assert.equal(calls.filter((x) => x.method === "readTxfOhlc").length, 1);
assert.deepEqual(
  calls.filter((x) => x.method === "readGlobalFuturesOhlc").map((x) => x.args.product),
  ["MNQ", "NIY", "MES", "GC"],
);
assert.equal(calls.some((x) => /sync|backfill|write/i.test(x.method)), false);

const quickPlan = planFamilyQuery("3105 技術位置與支撐", ["3105"]);
assert.equal(quickPlan.preferred_reads.includes("txf_context"), true);
assert.equal(quickPlan.preferred_reads.includes("global_futures_context"), true);
const revenuePlan = planFamilyQuery("3105 去年營收如何", ["3105"]);
assert.equal(revenuePlan.preferred_reads.includes("txf_context"), false);

const wrangler = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const binding = wrangler.services?.find((item: any) => item.binding === "OHLC_READ_SERVICE");
assert.deepEqual(binding, {
  binding: "OHLC_READ_SERVICE",
  service: "tv-fugle-1d",
  entrypoint: "OhlcFamilyReadService",
});

const bridgeSource = await readFile(new URL("../src/v6/family-ohlc-read-bridge.ts", import.meta.url), "utf8");
assert.doesNotMatch(bridgeSource, /syncOhlc|backfillOhlc|writeOhlc|GITHUB_TOKEN|FUGLE_API_KEY|GLOBAL_FUTURES_ADMIN_KEY/);
assert.match(bridgeSource, /OHLC_READ_SERVICE/);
assert.match(bridgeSource, /formal_research_eligible/);

console.log("family-ohlc-read-bridge: PASS");
