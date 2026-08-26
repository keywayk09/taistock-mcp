import assert from "node:assert/strict";
import { buildFamilyUnifiedEvidence } from "../src/v6/family-unified-evidence.ts";

const publishedChip = {
  ok: true,
  version: "diamond-market-data-published-gateway/v4-universal-compact",
  status: "READY",
  symbol: "2330",
  requested_as_of: "2026-08-21",
  data_as_of: "2026-08-21",
  publication: {
    trade_date: "2026-08-21",
    generation: "gen-1",
  },
  data_quality: {
    formal_published: true,
    current_month_generation_fenced: true,
    mixed_generation_current_day: false,
  },
  layers: {
    institutional: {
      status: "READY",
      latest: { trade_date: "2026-08-21", foreign_net: 100 },
      windows: { d5: { foreign_net: 500 } },
      rows: [
        { trade_date: "2026-08-20", foreign_net: 50 },
        { trade_date: "2026-08-21", foreign_net: 100 },
      ],
    },
    margin: {
      status: "READY",
      latest: { trade_date: "2026-08-21", margin_balance: 1000 },
      rows: [{ trade_date: "2026-08-21", margin_balance: 1000 }],
    },
    securities_lending: {
      status: "READY",
      latest: { trade_date: "2026-08-21" },
      rows: [{ trade_date: "2026-08-21" }],
    },
    sbl_short_sale: {
      status: "READY",
      latest: { trade_date: "2026-08-21" },
      rows: [{ trade_date: "2026-08-21" }],
    },
    maintenance_risk: { status: "NEEDS_OHLC_JOIN" },
  },
  datasets: [{ path: "published.json", sha: "abc", role: "PUBLISHED_GENERATION_MANIFEST_V5" }],
};

const baseInput = {
  symbol: "2330",
  as_of_date: "2026-08-21",
  request_intent: "FULL_STOCK_ANALYSIS",
  analysis: {
    market_snapshot: {
      source: "FUGLE_DISPLAY_QUOTE",
      quote: { close: 1000 },
      latest_daily_bar: { close: 995 },
      formal_ohlc: false,
    },
    technical: {
      status: "READY",
      source: "FINMIND_DISPLAY_FALLBACK",
      formal_ohlc: false,
      summary: { trend: "UP" },
    },
    chip: publishedChip,
  },
  intelligence: {
    monthly_revenue: { status: "READY", latest: { revenue: 1 } },
    accounting: { status: "READY", latest: { eps: 1 } },
    official_valuation: { status: "READY", data: [{ pe_ratio: 20 }] },
  },
  holding_distribution_rows: [
    {
      date: "2026-08-14",
      HoldingSharesLevel: "400001-600000",
      people: 10,
      percent: 3,
      unit: 5_000_000,
    },
  ],
  foreign_shareholding_rows: [
    {
      date: "2026-08-21",
      ForeignInvestmentSharesRatio: 74.2,
      ForeignInvestmentShares: 100,
    },
  ],
};

const withoutOhlc = buildFamilyUnifiedEvidence(baseInput);
assert.equal(withoutOhlc.version, "family-evidence/v1.1.0");
assert.equal(withoutOhlc.access, "READ_ONLY");
assert.equal(withoutOhlc.identity_policy, "EVIDENCE_CLASS_CANNOT_BE_SELF_PROMOTED");
assert.equal(withoutOhlc.evidence.realtime_market.evidence_class, "DISPLAY_FALLBACK");
assert.equal(withoutOhlc.evidence.realtime_market.formal_research_eligible, false);
assert.equal(withoutOhlc.evidence.realtime_market.source, "FUGLE_DISPLAY_QUOTE");
assert.equal(withoutOhlc.evidence.technical_research_fallback.evidence_class, "DISPLAY_FALLBACK");
assert.equal(withoutOhlc.evidence.canonical_ohlc.evidence_class, "FORMAL_TRUTH");
assert.equal(withoutOhlc.evidence.canonical_ohlc.status, "UNAVAILABLE");
assert.equal(withoutOhlc.evidence.canonical_ohlc.formal_research_eligible, false);
assert.equal(withoutOhlc.evidence.published_chip.evidence_class, "FORMAL_TRUTH");
assert.equal(withoutOhlc.evidence.published_chip.status, "READY");
assert.equal(withoutOhlc.evidence.published_chip.formal_research_eligible, true);
assert.equal(withoutOhlc.evidence.holder_structure.evidence_class, "GOVERNED_CONTEXT");
assert.equal(withoutOhlc.evidence.web_evidence.evidence_class, "WEB_EVIDENCE");
assert.equal(withoutOhlc.evidence.web_evidence.status, "PENDING");
assert.equal(withoutOhlc.decision_readiness.state, "DEGRADED");
assert.ok(withoutOhlc.decision_readiness.missing_critical.includes("canonical_ohlc"));
assert.ok(withoutOhlc.decision_readiness.formal_truth_ready.includes("published_chip"));
assert.ok(withoutOhlc.decision_readiness.formal_truth_missing.includes("canonical_ohlc"));
assert.equal(withoutOhlc.permission_guardrails.github_writes, false);
assert.equal(withoutOhlc.permission_guardrails.production_writes, false);
assert.equal(withoutOhlc.permission_guardrails.order_placement, false);

const withStockLive = buildFamilyUnifiedEvidence({
  ...baseInput,
  analysis: {
    ...baseInput.analysis,
    stock_live_context: {
      status: "READY",
      source: "OHLC_READ_SERVICE_STOCK_LIVE",
      display_ready: true,
      formal_research_eligible: false,
      last_price: 1001,
      best_bid: 1000,
      best_ask: 1001,
      book: {
        bids: [
          { price: 1000, size: 50 },
          { price: 999, size: 40 },
          { price: 998, size: 30 },
          { price: 997, size: 20 },
          { price: 996, size: 10 },
        ],
        asks: [
          { price: 1001, size: 45 },
          { price: 1002, size: 35 },
          { price: 1003, size: 25 },
          { price: 1004, size: 15 },
          { price: 1005, size: 5 },
        ],
        imbalance: 0.0909,
      },
      order_flow: { state: "BUY_CONTROL", windows: { "30s": { delta: 100 } } },
      feed: { quality: "FULL" },
      persistence: "none",
    },
  },
});
assert.equal(withStockLive.evidence.realtime_market.status, "READY");
assert.equal(withStockLive.evidence.realtime_market.source, "OHLC_READ_SERVICE_STOCK_LIVE");
assert.equal(withStockLive.evidence.realtime_market.verification_level, "EPHEMERAL_READ_ONLY_LIVE_CONTEXT");
assert.equal((withStockLive.evidence.realtime_market.data as any).last_price, 1001);
assert.equal((withStockLive.evidence.realtime_market.data as any).five_level_book.bids.length, 5);
assert.equal((withStockLive.evidence.realtime_market.data as any).five_level_book.asks.length, 5);
assert.equal((withStockLive.evidence.realtime_market.data as any).order_flow.state, "BUY_CONTROL");
assert.equal(withStockLive.evidence.realtime_market.formal_research_eligible, false);

const withOhlc = buildFamilyUnifiedEvidence({
  ...baseInput,
  analysis: {
    ...baseInput.analysis,
    canonical_ohlc: {
      status: "READY",
      source: "OHLC_MCP",
      formal_research_eligible: true,
      verification_level: "DAY_VERIFIED",
      dataset_version: "ohlc-v4-dataset-123",
      as_of: "2026-08-21",
      provenance: { source: "OHLC_MCP", receipt: "receipt-1" },
      bars: [{ date: "2026-08-21", close: 1000 }],
    },
  },
});
assert.equal(withOhlc.evidence.canonical_ohlc.status, "READY");
assert.equal(withOhlc.evidence.canonical_ohlc.formal_research_eligible, true);
assert.equal(withOhlc.evidence.canonical_ohlc.dataset_version, "ohlc-v4-dataset-123");
assert.equal(withOhlc.decision_readiness.state, "READY");
assert.ok(!withOhlc.decision_readiness.missing_critical.includes("canonical_ohlc"));

const fakeFormalOhlc = buildFamilyUnifiedEvidence({
  ...baseInput,
  analysis: {
    ...baseInput.analysis,
    canonical_ohlc: {
      status: "READY",
      source: "FINMIND_DISPLAY_FALLBACK",
      formal_research_eligible: true,
    },
  },
});
assert.equal(fakeFormalOhlc.evidence.canonical_ohlc.status, "UNAVAILABLE");
assert.equal(fakeFormalOhlc.evidence.canonical_ohlc.formal_research_eligible, false);

console.log("family-unified-evidence.test.ts: PASS");
