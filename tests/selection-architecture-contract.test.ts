import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const journal = readFileSync(new URL("../src/v6/selection-journal.ts", import.meta.url), "utf8");
const evidence = readFileSync(new URL("../src/v6/selection-evidence.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../src/v6/selection-engine.ts", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../src/v6/selection-scheduled-dispatch.ts", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../src/v6/selection-queue-delivery.ts", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/index-v7.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("three selection labels have separate immutable collections", () => {
  assert.match(journal, /SWING: "research\/selection\/swing"/);
  assert.match(journal, /INTRADAY_REVIEW: "research\/selection\/intraday-review"/);
  assert.match(journal, /NEXT_DAY_INTRADAY: "research\/selection\/next-day-intraday"/);
  assert.match(journal, /audit_may_rewrite_prediction: false/);
  assert.match(journal, /future_data_forbidden: true/);
});

test("strict company master is the selector ETF gate", () => {
  assert.match(evidence, /MOPSFIN_TWSE_COMPANIES_CSV/);
  assert.match(evidence, /MOPSFIN_TPEX_COMPANIES_CSV/);
  assert.match(evidence, /\^\[1-9\]\\d\{3\}\$/);
  assert.match(evidence, /STRICT_COMPANY_MASTER_UNAVAILABLE/);
  assert.match(evidence, /QUOTE_TRADE_DATE_STALE_OR_INCOMPLETE/);
});

test("intraday review and next-day intraday do not reuse swing scoring", () => {
  assert.match(engine, /buildIntradayReviewCandidates/);
  assert.match(engine, /buildNextDayIntradayCandidates/);
  assert.match(engine, /buildSwingCandidates/);
  assert.match(engine, /POST_CLOSE_INTRADAY_EVENT_REVIEW_NOT_DIRECTIONAL_PREDICTION/);
  assert.match(engine, /NEXT_SESSION_INTRADAY_WATCHLIST/);
  assert.match(engine, /MULTI_DAY_SWING_RESEARCH_SELECTION/);
});

test("cron path preserves market-data first and sends selection through isolated queue", () => {
  assert.match(dispatcher, /await runExtendedScheduledMarketDataController/);
  assert.match(dispatcher, /await enqueueSelectionWake/);
  assert.match(delivery, /SELECTION_QUEUE_NOT_BOUND/);
  assert.match(delivery, /Fail closed: missing queue delivery/);
  assert.match(dispatcher, /runSelectionQueueBatch/);
  assert.match(dispatcher, /PENDING is acknowledged intentionally/);
});

test("v7 wrapper delegates verified v6 HTTP surfaces and exposes queue consumer", () => {
  assert.match(entry, /extends BaseMyMCP/);
  assert.match(entry, /registerSelectionTools/);
  assert.match(entry, /return baseWorker\.fetch/);
  assert.match(entry, /runSelectionAwareScheduledController/);
  assert.match(entry, /async queue\(/);
  assert.match(entry, /runSelectionQueueBatch/);
  assert.match(wrangler, /"main": "src\/index-v7\.ts"/);
});

test("night selector reserves volume-ratio feature rather than fabricating unavailable history", () => {
  assert.match(engine, /volume_ratio_5d: null/);
  assert.match(engine, /PENDING_BOUNDED_HISTORY_ENRICHMENT/);
  assert.doesNotMatch(engine, /FinMind/);
  assert.doesNotMatch(engine, /market\/snapshot/);
});
