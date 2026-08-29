import assert from "node:assert/strict";
import { inferFamilyAdaptiveIntent, planFamilyQuery } from "../src/v6/family-adaptive-planner.ts";
import { buildFamilyMarketQuestionContext } from "../src/v6/family-market-question.ts";

const question = "昨晚美盤為什麼台指期會下跌嗎？";
assert.equal(inferFamilyAdaptiveIntent(question, []), "MARKET_CONTEXT");
const plan = planFamilyQuery(question, []);
assert.equal(plan.intent, "MARKET_CONTEXT");
assert.ok(plan.preferred_reads.includes("txf_context"));
assert.ok(plan.preferred_reads.includes("global_futures_context"));
assert.ok(plan.preferred_reads.includes("jin10_events"));

const bars = Array.from({ length: 100 }, (_, index) => ({
  trade_date: "2026-08-28",
  bar_time_tw: `2026-08-28 ${String(9 + Math.floor(index / 12)).padStart(2, "0")}:${String((index * 5) % 60).padStart(2, "0")}:00`,
  ts_ms: 1_700_000_000_000 + index * 300_000,
  open: 45_900 - index,
  high: 45_910 - index,
  low: 45_880 - index,
  close: 45_895 - index,
  volume: 100 + index,
  giant_unused_payload: "x".repeat(3_000),
}));

const result = await buildFamilyMarketQuestionContext({} as any, {
  as_of_date: "2026-08-30",
  question,
  intent: "MARKET_CONTEXT",
}, {
  readRegime: (async () => ({
    txf_context: {
      status: "READY",
      source: "OHLC_MCP_TXF_READ",
      verification_level: "GOVERNED_READ_ONLY",
      data_as_of: "2026-08-28",
      data: { ok: true, blocked: false, status: "READY", trade_date: "2026-08-28", timeframe: "5m", rows: bars },
    },
    global_futures_context: {
      status: "READY",
      source: "OHLC_MCP_GLOBAL_FUTURES_READ",
      verification_level: "VERIFIED_CANONICAL_CONTEXT",
      data_as_of: "2026-08-28",
      data: {
        ok: true,
        blocked: false,
        status: "READY",
        trade_date: "2026-08-28",
        requested_as_of_date: "2026-08-30",
        requested_products: ["MNQ", "NIY", "MES", "GC"],
        products: ["MNQ", "NIY", "MES", "GC"].map((product) => ({
          product,
          trade_date: "2026-08-28",
          status: "READY",
          verification_level: "VERIFIED_RECEIPT_GZIP_LOGICAL_SHA256_BOUND",
          dataset_version: `test-${product}`,
          rows: bars,
        })),
        failures: [],
      },
    },
  })) as any,
  readJin10: (async () => ({
    ok: true,
    provider: "jin10-mcp",
    mode: "market_brief",
    read_only: true,
    persistence: "NONE",
    flash: Array.from({ length: 20 }, (_, index) => ({
      id: `flash-${index}`,
      time: `2026-08-29T${String(index % 24).padStart(2, "0")}:00:00+08:00`,
      title: `Fed / 美股事件 ${index}`,
      content: `事件內容 ${index} ${"內容".repeat(2_000)}`,
      important: index < 3,
    })),
    news: [],
    calendar: Array.from({ length: 20 }, (_, index) => ({
      pub_time: `2026-08-29T${String(index % 24).padStart(2, "0")}:30:00+08:00`,
      title: `財經日曆 ${index}`,
      star: 3,
    })),
    partial_errors: [],
  })) as any,
});

assert.equal(result.contract, "FAMILY_MARKET_CONTEXT_READ_ONLY");
assert.equal(result.txf_context.status, "READY");
assert.equal(result.global_futures_context.status, "READY");
assert.equal(result.jin10_context.ok, true);
assert.equal(result.txf_context.data?.rows.length, 32, "TXF timeline must be bounded for Custom GPT transport");
assert.equal(result.txf_context.data?.timeline.source_row_count, 100);
assert.equal(result.txf_context.data?.rows[0]?.ts_ms, bars[0].ts_ms, "timeline must retain first bar");
assert.equal(result.txf_context.data?.rows.at(-1)?.ts_ms, bars.at(-1)?.ts_ms, "timeline must retain last bar");
assert.equal(result.global_futures_context.data?.products.length, 4);
assert.ok(result.global_futures_context.data?.products.every((product: any) => product.rows.length === 16));
assert.ok(result.global_futures_context.data?.products.every((product: any) => product.timeline.source_row_count === 100));
assert.equal(result.jin10_context.flash.length, 6);
assert.equal(result.jin10_context.calendar.length, 6);
assert.equal(result.decision_readiness.txf_context, true);
assert.equal(result.decision_readiness.global_futures_context, true);
assert.equal(result.decision_readiness.jin10_context, true);
const serialized = JSON.stringify(result);
assert.doesNotMatch(serialized, /giant_unused_payload/);
assert.ok(Buffer.byteLength(serialized, "utf8") < 36_000, `market context response unexpectedly large: ${Buffer.byteLength(serialized, "utf8")}`);

const degraded = await buildFamilyMarketQuestionContext({} as any, {
  as_of_date: "2026-08-30",
  question,
  intent: "MARKET_CONTEXT",
}, {
  readRegime: (async () => ({
    txf_context: { status: "READY", source: "OHLC_MCP_TXF_READ", data: { ok: true, status: "READY", rows: bars.slice(-3) } },
    global_futures_context: { status: "UNAVAILABLE", source: "OHLC_MCP_GLOBAL_FUTURES_READ", error: "not ready" },
  })) as any,
  readJin10: (async () => { throw new Error("Bearer test-secret unavailable"); }) as any,
});
assert.equal(degraded.txf_context.status, "READY", "Jin10 failure must not suppress governed TXF evidence");
assert.equal(degraded.jin10_context.ok, false);
assert.equal(degraded.decision_readiness.txf_context, true);
assert.equal(degraded.decision_readiness.jin10_context, false);
assert.doesNotMatch(JSON.stringify(degraded), /test-secret/);
assert.match(JSON.stringify(degraded), /REDACTED/);

console.log("PASS Family market-event query routes to compact full-session TXF + Global Futures + Jin10 context");
