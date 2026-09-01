import assert from "node:assert/strict";
import {
  createResearchVNextCompatRegistrationServer,
} from "../src/v6/research-vnext/compat-cutover.ts";

type Registration = {
  name: string;
  config: Record<string, unknown>;
  handler?: (...args: any[]) => Promise<any> | any;
};

const registrations: Registration[] = [];
const baseServer = {
  registerTool(name: string, config: Record<string, unknown>, handler?: (...args: any[]) => Promise<any> | any) {
    registrations.push({ name, config, handler });
    return { name };
  },
};

const textResponse = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});
const bodyOf = (response: any) => JSON.parse(String(response.content?.[0]?.text ?? "null"));

const reviewInputs: unknown[][] = [];
const swingInputs: Array<{ signals: unknown[]; limit: number }> = [];
const replayInputs: unknown[] = [];
let replayMode: "VNEXT" | "FALLBACK" = "VNEXT";

const fakeCutover = {
  async reviewSummary(rows: unknown[], legacyFallback: () => unknown | Promise<unknown>) {
    reviewInputs.push(rows);
    const legacy = await legacyFallback();
    return legacy;
  },
  async swingRank(signals: unknown[], limit: number, legacyFallback: () => unknown | Promise<unknown>) {
    swingInputs.push({ signals, limit });
    const legacy = await legacyFallback();
    return legacy;
  },
  async replayResolve(input: unknown, legacyFallback: () => unknown | Promise<unknown>) {
    replayInputs.push(input);
    if (replayMode === "FALLBACK") return await legacyFallback();
    return { ok: true, status: "RESOLVED", resolution: "STOP_FIRST" };
  },
};

const compatServer = createResearchVNextCompatRegistrationServer(baseServer, {
  cutover: fakeCutover,
});

const replayConfig = { description: "replay", inputSchema: { x: 1 } };
let legacyReplayCalls = 0;
const legacyReplayHandler = async (input: unknown) => {
  legacyReplayCalls += 1;
  return textResponse({ ok: false, error: { code: "LEGACY_REPLAY_ERROR", input } }, true);
};
compatServer.registerTool("resolve_ambiguous_backtest_with_1m", replayConfig, legacyReplayHandler);

const reviewConfig = { description: "review", inputSchema: { y: 1 } };
const legacyReviewBody = {
  ok: true,
  stock_results: [{
    ok: true,
    status: "OK",
    signal_id: "s1",
    signal_version: "v1",
    strategy: "S1",
    side: "SHORT",
    net_return_pct: 1.25,
    mfe_pct: 2.5,
    mae_pct: -0.5,
    ambiguous_intrabar: false,
    requires_1m_replay: false,
  }],
  txf_results: [{
    status: "OK",
    signal_id: "t1",
    signal_version: "v1",
    strategy: "T1",
    side: "LONG",
    net_points: null,
    gross_points: 18,
    mfe_points: 30,
    mae_points: -8,
    ambiguous_intrabar: true,
    requires_1m_replay: true,
  }],
  summary: {
    stock: { marker: "LEGACY_STOCK_SUMMARY" },
    txf: { marker: "LEGACY_TXF_SUMMARY" },
    total_cases: 2,
  },
  interpretation: { marker: "LEGACY_INTERPRETATION" },
  experiment: { marker: "LEGACY_PERSISTENCE" },
};
const legacyReviewHandler = async () => textResponse(legacyReviewBody);
compatServer.registerTool("finalize_daily_review_run", reviewConfig, legacyReviewHandler);

const swingConfig = { description: "swing", inputSchema: { z: 1 } };
const legacySelected = [{
  rank: 1,
  score: 88,
  signal_id: "sw1",
  signal_version: "v1",
  symbol: "2330",
  trade_date: "2026-09-01",
  side: "LONG",
  strategy: "SWING",
  stage: "WATCH",
  signal_ts_ms: 1788226200000,
  reason_codes: ["A"],
  score_source: "SIGNAL_PAYLOAD",
}];
const legacySwingHandler = async () => textResponse({
  ok: true,
  selected: legacySelected,
  note: "LEGACY_ORCHESTRATION_STAYS",
});
compatServer.registerTool("prepare_swing_selection_run", swingConfig, legacySwingHandler);

const untouchedConfig = { description: "untouched" };
const untouchedHandler = async () => textResponse({ untouched: true });
compatServer.registerTool("finalize_swing_review_run", untouchedConfig, untouchedHandler);
compatServer.registerTool("get_review_orchestration_contract", untouchedConfig, untouchedHandler);

const byName = new Map(registrations.map((entry) => [entry.name, entry]));
for (const [name, config] of [
  ["resolve_ambiguous_backtest_with_1m", replayConfig],
  ["finalize_daily_review_run", reviewConfig],
  ["prepare_swing_selection_run", swingConfig],
] as const) {
  const registration = byName.get(name);
  assert.ok(registration, `${name} must still be registered`);
  assert.equal(registration.config, config, `${name} public config/schema object must pass through unchanged`);
}
assert.notEqual(byName.get("resolve_ambiguous_backtest_with_1m")?.handler, legacyReplayHandler);
assert.notEqual(byName.get("finalize_daily_review_run")?.handler, legacyReviewHandler);
assert.notEqual(byName.get("prepare_swing_selection_run")?.handler, legacySwingHandler);
assert.equal(byName.get("finalize_swing_review_run")?.handler, untouchedHandler, "unproven swing outcome handler must remain Legacy");
assert.equal(byName.get("get_review_orchestration_contract")?.handler, untouchedHandler, "non-target handler must be untouched");

const replayRegistration = byName.get("resolve_ambiguous_backtest_with_1m")!;
const replaySuccess = await replayRegistration.handler?.({ case: "vnext" });
assert.deepEqual(bodyOf(replaySuccess), { ok: true, status: "RESOLVED", resolution: "STOP_FIRST" });
assert.equal(legacyReplayCalls, 0, "VNext replay success must not invoke Legacy handler");
assert.deepEqual(replayInputs, [{ case: "vnext" }]);

replayMode = "FALLBACK";
const replayFallback = await replayRegistration.handler?.({ case: "legacy" });
assert.equal(replayFallback.isError, true);
assert.deepEqual(bodyOf(replayFallback), {
  ok: false,
  error: { code: "LEGACY_REPLAY_ERROR", input: { case: "legacy" } },
});
assert.equal(legacyReplayCalls, 1, "Replay bounded failure must preserve exactly one Legacy fallback");

const reviewRegistration = byName.get("finalize_daily_review_run")!;
const reviewResponse = await reviewRegistration.handler?.({ trade_date: "2026-09-01" });
assert.deepEqual(bodyOf(reviewResponse), legacyReviewBody, "review wrapper must preserve the full public body when VNext summary equals Legacy fallback");
assert.equal(reviewInputs.length, 2, "stock and TXF summaries must be sent separately to VNext");
assert.deepEqual(reviewInputs[0], [{
  market: "tw-stock",
  signal_id: "s1",
  signal_version: "v1",
  strategy: "S1",
  side: "SHORT",
  net_return_pct: 1.25,
  mfe_pct: 2.5,
  mae_pct: -0.5,
  ambiguous_intrabar: false,
  requires_1m_replay: false,
}]);
assert.deepEqual(reviewInputs[1], [{
  market: "txf",
  signal_id: "t1",
  signal_version: "v1",
  strategy: "T1",
  side: "LONG",
  net_points: 18,
  mfe_points: 30,
  mae_points: -8,
  ambiguous_intrabar: true,
  requires_1m_replay: true,
}]);

const swingRegistration = byName.get("prepare_swing_selection_run")!;
const swingResponse = await swingRegistration.handler?.({ limit: 10 });
assert.deepEqual(bodyOf(swingResponse), {
  ok: true,
  selected: legacySelected,
  note: "LEGACY_ORCHESTRATION_STAYS",
});
assert.equal(swingInputs.length, 1);
assert.equal(swingInputs[0].limit, 1);
assert.deepEqual(swingInputs[0].signals, [{
  signal_id: "sw1",
  signal_version: "v1",
  symbol: "2330",
  trade_date: "2026-09-01",
  side: "LONG",
  strategy: "SWING",
  stage: "WATCH",
  signal_ts_ms: 1788226200000,
  reason_codes: ["A"],
  payload: { swing_score: 88 },
}]);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_COMPAT_REGISTRATION_TEST_V1",
  status: "PASS",
  wrapped_handlers: [
    "resolve_ambiguous_backtest_with_1m",
    "finalize_daily_review_run",
    "prepare_swing_selection_run",
  ],
  untouched_handler_examples: [
    "finalize_swing_review_run",
    "get_review_orchestration_contract",
  ],
  public_configs: "IDENTITY_PRESERVED",
  replay_legacy_fallback: "PRESERVED",
  review_non_deterministic_fields: "PRESERVED",
  swing_outcome_summary: "LEGACY_UNCHANGED",
}, null, 2));
