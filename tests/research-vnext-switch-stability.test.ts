import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createResearchVNextCompatCutover,
  createResearchVNextCompatRegistrationServer,
} from "../src/v6/research-vnext/compat-cutover.ts";

type RegisteredTool = {
  config: unknown;
  handler: (...args: any[]) => any;
};

const registered = new Map<string, RegisteredTool>();
const baseServer = {
  registerTool(name: string, config: unknown, handler: (...args: any[]) => any) {
    registered.set(name, { config, handler });
    return { name };
  },
};

const stockSummary = { count: 1, evaluated_count: 1, wins: 1, losses: 0, flats: 0, win_rate: 1, expectancy: 1.25, profit_factor: null, ambiguous_count: 0, ambiguous_rate: 0, replay_required_count: 0, breakdown: [] };
const txfSummary = { count: 1, evaluated_count: 1, wins: 1, losses: 0, flats: 0, win_rate: 1, expectancy: 12, profit_factor: null, ambiguous_count: 0, ambiguous_rate: 0, replay_required_count: 0, breakdown: [] };
const selected = [{ rank: 1, score: 88, signal_id: "s1", signal_version: "v1", symbol: "2330", trade_date: "2026-08-31", side: "LONG", strategy: "TEST", stage: null, signal_ts_ms: 1, reason_codes: [], score_source: "SIGNAL_PAYLOAD" }];

let gatewayLoads = 0;
let failCapabilities = new Set<string>();
const cutover = createResearchVNextCompatCutover({
  loadGateway: async () => {
    gatewayLoads += 1;
    return {
      async invoke(capability: string, input: any) {
        if (failCapabilities.has(capability)) {
          return { ok: false as const, capability, error: { code: "CAPABILITY_FAILED", message: "forced stability failure" } };
        }
        if (capability === "review.summary") {
          const market = input?.rows?.[0]?.market;
          return { ok: true as const, capability, value: market === "txf" ? txfSummary : stockSummary };
        }
        if (capability === "swing.rank") return { ok: true as const, capability, value: selected };
        if (capability === "replay.resolve") return { ok: true as const, capability, value: { ok: true, status: "RESOLVED", source: "VNEXT" } };
        return { ok: false as const, capability, error: { code: "UNKNOWN_CAPABILITY", message: capability } };
      },
    };
  },
});

const compatServer = createResearchVNextCompatRegistrationServer(baseServer, { cutover });

let replayLegacyCalls = 0;
let reviewLegacyCalls = 0;
let swingLegacyCalls = 0;
let nonTargetCalls = 0;

const replayConfig = { description: "replay", inputSchema: { frozen: true } };
const reviewConfig = { description: "review", inputSchema: { frozen: true } };
const swingConfig = { description: "swing", inputSchema: { frozen: true } };
const nonTargetConfig = { description: "legacy", inputSchema: { frozen: true } };

compatServer.registerTool("resolve_ambiguous_backtest_with_1m", replayConfig, async () => {
  replayLegacyCalls += 1;
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, status: "LEGACY_REPLAY" }) }], isError: true };
});
compatServer.registerTool("finalize_daily_review_run", reviewConfig, async () => {
  reviewLegacyCalls += 1;
  return {
    content: [{ type: "text", text: JSON.stringify({
      ok: true,
      stock_results: [{ ok: true, status: "OK", signal_id: "a", signal_version: "v1", strategy: "TEST", side: "LONG", net_return_pct: 1.25, mfe_pct: 2, mae_pct: -0.5, ambiguous_intrabar: false, requires_1m_replay: false }],
      txf_results: [{ status: "OK", signal_id: "t", signal_version: "v1", strategy: "TEST", side: "LONG", net_points: 12, gross_points: 12, mfe_points: 20, mae_points: -4, ambiguous_intrabar: false, requires_1m_replay: false }],
      summary: { stock: stockSummary, txf: txfSummary, total_cases: 2 },
      interpretation: { policy: "LEGACY_PRESERVED" },
    }) }],
  };
});
compatServer.registerTool("prepare_swing_selection_run", swingConfig, async () => {
  swingLegacyCalls += 1;
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, selected, data_policy: "SIGNAL_TIME_DATA_ONLY" }) }] };
});
const originalNonTargetHandler = async () => {
  nonTargetCalls += 1;
  return { content: [{ type: "text", text: "legacy" }] };
};
compatServer.registerTool("finalize_swing_review_run", nonTargetConfig, originalNonTargetHandler);

assert.equal(registered.get("resolve_ambiguous_backtest_with_1m")?.config, replayConfig, "Replay public config identity must stay frozen");
assert.equal(registered.get("finalize_daily_review_run")?.config, reviewConfig, "Review public config identity must stay frozen");
assert.equal(registered.get("prepare_swing_selection_run")?.config, swingConfig, "Swing public config identity must stay frozen");
assert.equal(registered.get("finalize_swing_review_run")?.config, nonTargetConfig, "Non-target public config must stay untouched");
assert.equal(registered.get("finalize_swing_review_run")?.handler, originalNonTargetHandler, "Non-target handler identity must pass through untouched");

const replayHandler = registered.get("resolve_ambiguous_backtest_with_1m")!.handler;
const reviewHandler = registered.get("finalize_daily_review_run")!.handler;
const swingHandler = registered.get("prepare_swing_selection_run")!.handler;
const nonTargetHandler = registered.get("finalize_swing_review_run")!.handler;

// Success burst: VNext-primary Replay must not call Legacy; Review/Swing run their
// existing Legacy orchestration first and may replace only strict-parity deterministic evidence.
failCapabilities = new Set();
const successBurst = await Promise.all(Array.from({ length: 25 }, async (_, index) => {
  const replay = await replayHandler({ case_id: `ok-${index}` });
  const review = await reviewHandler({ case_id: `ok-${index}` });
  const swing = await swingHandler({ case_id: `ok-${index}` });
  return { replay, review, swing };
}));
assert.equal(replayLegacyCalls, 0, "VNext-primary Replay success burst must not invoke Legacy fallback");
assert.equal(reviewLegacyCalls, 25, "Review orchestration must remain Legacy-owned exactly once per public call");
assert.equal(swingLegacyCalls, 25, "Swing orchestration must remain Legacy-owned exactly once per public call");
for (const row of successBurst) {
  assert.equal(JSON.parse(row.replay.content[0].text).source, "VNEXT");
  const reviewBody = JSON.parse(row.review.content[0].text);
  assert.deepEqual(reviewBody.summary.stock, stockSummary);
  assert.deepEqual(reviewBody.summary.txf, txfSummary);
  assert.equal(reviewBody.interpretation.policy, "LEGACY_PRESERVED");
  assert.deepEqual(JSON.parse(row.swing.content[0].text).selected, selected);
}

// Failure burst: Replay must fall back exactly once per call. Review/Swing must
// return the original Legacy-compatible result without poisoning the adapter.
failCapabilities = new Set(["review.summary", "swing.rank", "replay.resolve"]);
const failureBurst = await Promise.all(Array.from({ length: 25 }, async (_, index) => {
  const replay = await replayHandler({ case_id: `fail-${index}` });
  const review = await reviewHandler({ case_id: `fail-${index}` });
  const swing = await swingHandler({ case_id: `fail-${index}` });
  return { replay, review, swing };
}));
assert.equal(replayLegacyCalls, 25, "Replay failure burst must call Legacy exactly once per public invocation");
assert.equal(reviewLegacyCalls, 50, "Review Legacy orchestration must remain exactly once per call during VNext failure");
assert.equal(swingLegacyCalls, 50, "Swing Legacy orchestration must remain exactly once per call during VNext failure");
for (const row of failureBurst) {
  assert.equal(JSON.parse(row.replay.content[0].text).status, "LEGACY_REPLAY");
  assert.equal(row.replay.isError, true, "Replay Legacy domain-error shape must be preserved");
  assert.equal(JSON.parse(row.review.content[0].text).interpretation.policy, "LEGACY_PRESERVED");
  assert.deepEqual(JSON.parse(row.swing.content[0].text).selected, selected);
}

// Recovery after failure proves a bounded VNext error does not poison later calls.
failCapabilities = new Set();
const recoveredReplay = await replayHandler({ case_id: "recovered" });
assert.equal(JSON.parse(recoveredReplay.content[0].text).source, "VNEXT");
assert.equal(replayLegacyCalls, 25, "Recovered VNext call must not add another Legacy fallback");
assert.equal(gatewayLoads, 1, "Gateway loader must remain lazy-cached across success/failure/recovery bursts");

await nonTargetHandler({});
assert.equal(nonTargetCalls, 1, "Unproven non-target Legacy handler must remain callable and untouched");

const repoRoot = path.resolve(import.meta.dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "tests/fixtures/research-vnext-public-abi-snapshot.json"), "utf8"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");

const owner = fs.readFileSync(path.join(repoRoot, "src/v6/owner-content-handler.ts"), "utf8");
const researchTools = fs.readFileSync(path.join(repoRoot, "src/v6/research-tools.ts"), "utf8");
assert.doesNotMatch(owner, /research-vnext/i, "Owner must still have no direct Research VNext registration");
assert.match(researchTools, /\.\/research-vnext\/compat-cutover/, "research-tools must retain the bounded compat boundary");
assert.match(researchTools, /registerGptJudgmentMemoryTools\(server, env\)/, "unproven GPT Memory must remain Legacy");
assert.match(researchTools, /registerSwingOutcomePathTool\(server\)/, "unproven swing outcome path must remain Legacy");
assert.equal(fs.existsSync(path.join(repoRoot, "src/v6/review-orchestrator.ts")), true, "Legacy deterministic review fallback must remain present");
assert.equal(fs.existsSync(path.join(repoRoot, "src/v6/selective-1m-replay.ts")), true, "Legacy replay fallback must remain present");

console.log("SWITCH_STABILITY_PRECHECK=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_SWITCH_STABILITY_PRECHECK_V1",
  status: "PASS",
  success_burst_per_lane: 25,
  failure_burst_per_lane: 25,
  recovery: "PASS",
  gateway_loads: gatewayLoads,
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  legacy_fallback: "RETAINED",
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: the formal retirement policy module must not exist until
// this entire switched-path stability precheck has passed once in CI.
const readiness = await import("../src/v6/research-vnext/retirement-readiness.ts");
assert.equal(readiness.RESEARCH_VNEXT_RETIREMENT_POLICY.schema, "RESEARCH_VNEXT_RETIREMENT_POLICY_V1");
assert.equal(readiness.RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_retirement, "BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE");
assert.equal(readiness.RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_fallback, "MUST_REMAIN_AVAILABLE");
assert.equal(readiness.RESEARCH_VNEXT_RETIREMENT_POLICY.reasoning_owner, "GPT");
assert.equal(readiness.RESEARCH_VNEXT_RETIREMENT_POLICY.production_mutation_this_phase, "NONE");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_SWITCH_STABILITY_TEST_V1",
  status: "PASS",
  retirement_policy: readiness.RESEARCH_VNEXT_RETIREMENT_POLICY,
}, null, 2));
