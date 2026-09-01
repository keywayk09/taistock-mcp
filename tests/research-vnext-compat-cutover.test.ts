import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RESEARCH_VNEXT_COMPAT_CUTOVER_VERSION,
  createResearchVNextCompatCutover,
} from "../src/v6/research-vnext/compat-cutover.ts";

type Invocation = { capability: string; input: unknown };

const invocations: Invocation[] = [];
let loadCount = 0;
let failCapabilities = new Set<string>();

const cutover = createResearchVNextCompatCutover({
  loadGateway: async () => {
    loadCount += 1;
    return {
      async invoke(capability: string, input: unknown) {
        invocations.push({ capability, input });
        if (failCapabilities.has(capability)) {
          return {
            ok: false as const,
            capability,
            error: { code: "CAPABILITY_FAILED" as const, message: "forced VNext failure" },
          };
        }
        return {
          ok: true as const,
          capability: capability as "review.summary" | "swing.rank" | "replay.resolve",
          value: { source: "VNEXT", capability, input },
        };
      },
    };
  },
});

assert.equal(RESEARCH_VNEXT_COMPAT_CUTOVER_VERSION, "research-vnext-compat-cutover/v1.0.0");
assert.deepEqual(cutover.contract(), {
  schema: "RESEARCH_VNEXT_COMPAT_CUTOVER_CONTRACT_V1",
  version: "research-vnext-compat-cutover/v1.0.0",
  runtime_mode: "COMPAT_CUTOVER_UNREGISTERED",
  reasoning_owner: "GPT",
  vnext_role: "PRIMARY_DETERMINISTIC",
  legacy_role: "FALLBACK_ONLY",
  eligible_capabilities: ["review.summary", "swing.rank", "replay.resolve"],
  loader: "LAZY_CACHED",
  direct_provider_access: "FORBIDDEN",
  ohlc_write: "FORBIDDEN",
  automatic_strategy_promotion: "FORBIDDEN",
  public_abi_change: "FORBIDDEN",
});

let legacyCalls = 0;
const legacy = <T>(value: T) => async () => {
  legacyCalls += 1;
  return value;
};

const reviewRows = [{ market: "tw-stock", signal_id: "a" }];
const review = await cutover.reviewSummary(reviewRows, legacy({ source: "LEGACY_REVIEW" }));
assert.deepEqual(review, { source: "VNEXT", capability: "review.summary", input: { rows: reviewRows } });
assert.equal(legacyCalls, 0, "successful VNext review summary must not call Legacy fallback");

const swingSignals = [{ signal_id: "s1", symbol: "2330" }];
const swing = await cutover.swingRank(swingSignals, 7, legacy({ source: "LEGACY_SWING" }));
assert.deepEqual(swing, { source: "VNEXT", capability: "swing.rank", input: { signals: swingSignals, limit: 7 } });
assert.equal(legacyCalls, 0, "successful VNext swing rank must not call Legacy fallback");

const replayInput = { original_5m_result: { backtest_run_id: "bt1" }, bars_1m: [] };
const replay = await cutover.replayResolve(replayInput, legacy({ source: "LEGACY_REPLAY" }));
assert.deepEqual(replay, { source: "VNEXT", capability: "replay.resolve", input: { input: replayInput } });
assert.equal(legacyCalls, 0, "successful VNext replay must not call Legacy fallback");
assert.equal(loadCount, 1, "gateway loader must be lazy and cached across capabilities");

failCapabilities = new Set(["review.summary", "swing.rank", "replay.resolve"]);
assert.deepEqual(
  await cutover.reviewSummary(reviewRows, legacy({ source: "LEGACY_REVIEW" })),
  { source: "LEGACY_REVIEW" },
);
assert.deepEqual(
  await cutover.swingRank(swingSignals, 7, legacy({ source: "LEGACY_SWING" })),
  { source: "LEGACY_SWING" },
);
assert.deepEqual(
  await cutover.replayResolve(replayInput, legacy({ source: "LEGACY_REPLAY" })),
  { source: "LEGACY_REPLAY" },
);
assert.equal(legacyCalls, 3, "each failed VNext capability must use exactly one Legacy fallback");
assert.equal(loadCount, 1, "failed capability calls must reuse the cached gateway");

let thrownFallbackCalls = 0;
const loaderFailureCutover = createResearchVNextCompatCutover({
  loadGateway: async () => {
    throw new Error("gateway unavailable");
  },
});
const fallbackAfterLoaderFailure = await loaderFailureCutover.reviewSummary(reviewRows, async () => {
  thrownFallbackCalls += 1;
  return { source: "LEGACY_AFTER_LOAD_FAILURE" };
});
assert.deepEqual(fallbackAfterLoaderFailure, { source: "LEGACY_AFTER_LOAD_FAILURE" });
assert.equal(thrownFallbackCalls, 1, "gateway load failure must fail over exactly once");

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "src/v6/research-vnext/compat-cutover.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.match(executable, /import\(["']\.\/research-gateway\.ts["']\)/, "cutover must lazy-load the VNext gateway");
assert.doesNotMatch(executable, /\bfetch\s*\(/, "compat cutover must never access a provider directly");
assert.doesNotMatch(executable, /hypothesis\s*=|interpretation\s*=|buildReviewInterpretation|selectSwingCandidates|summarizeReviewRows|resolveAmbiguousBacktestWith1m/, "compat cutover must not synthesize reasoning or embed Legacy implementation logic");

const ownerSource = fs.readFileSync(path.join(repoRoot, "src/v6/owner-content-handler.ts"), "utf8");
const researchToolsSource = fs.readFileSync(path.join(repoRoot, "src/v6/research-tools.ts"), "utf8");
assert.equal(ownerSource.includes("compat-cutover"), false, "Phase 10A must not modify Owner registration");
assert.equal(researchToolsSource.includes("compat-cutover"), false, "Phase 10A bridge must remain unregistered until its own GREEN");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_COMPAT_CUTOVER_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_COMPAT_CUTOVER_VERSION,
  eligible_capabilities: ["review.summary", "swing.rank", "replay.resolve"],
  vnext_primary_cases: 3,
  legacy_fallback_cases: 4,
  loader: "LAZY_CACHED",
  public_abi: "UNCHANGED",
  production_registration: "UNCHANGED",
}, null, 2));
