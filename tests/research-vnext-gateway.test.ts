import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RESEARCH_VNEXT_GATEWAY_VERSION,
  createResearchVNextGateway,
} from "../src/v6/research-vnext/research-gateway.ts";

assert.equal(RESEARCH_VNEXT_GATEWAY_VERSION, "research-vnext-gateway/v1.0.0");

let loadCount = 0;
const callLog: string[] = [];

const fakeFacade = {
  contract() {
    return { production_registration: "DISABLED" as const };
  },
  summarizeReviewEvidence(rows: unknown[]) {
    callLog.push("review.summary");
    return { count: rows.length };
  },
  rankSwingEvidence(signals: unknown[], limit = 10) {
    callLog.push("swing.rank");
    return signals.slice(0, limit);
  },
  summarizeSwingOutcomes(results: unknown[]) {
    callLog.push("swing.outcomes");
    return { count: results.length };
  },
  async resolveSelective1mReplay(input: Record<string, unknown>) {
    callLog.push("replay.resolve");
    return { resolved: true, input };
  },
  memory: {},
};

const gateway = createResearchVNextGateway({
  timeoutMs: 100,
  maxErrorMessageChars: 120,
  loadFacade: async () => {
    loadCount += 1;
    return fakeFacade;
  },
});

assert.equal(loadCount, 0, "gateway creation must not eagerly load the facade");
assert.deepEqual(gateway.contract(), {
  schema: "RESEARCH_VNEXT_GATEWAY_CONTRACT_V1",
  version: RESEARCH_VNEXT_GATEWAY_VERSION,
  runtime_mode: "SHADOW_UNREGISTERED",
  production_registration: "DISABLED",
  reasoning_owner: "GPT",
  loader: "LAZY_CACHED",
  failure_containment: "PER_CALL",
  direct_provider_access: "FORBIDDEN",
  automatic_strategy_promotion: "FORBIDDEN",
});
assert.equal(loadCount, 0, "reading the gateway contract must not load the facade");

const review = await gateway.invoke("review.summary", { rows: [{ id: 1 }, { id: 2 }] });
assert.deepEqual(review, { ok: true, capability: "review.summary", value: { count: 2 } });
assert.equal(loadCount, 1, "first capability invocation must lazy-load the facade exactly once");

const swing = await gateway.invoke("swing.rank", { signals: [{ id: 1 }, { id: 2 }], limit: 1 });
assert.deepEqual(swing, { ok: true, capability: "swing.rank", value: [{ id: 1 }] });
assert.equal(loadCount, 1, "subsequent calls must reuse the cached facade");

const outcomes = await gateway.invoke("swing.outcomes", { results: [{ status: "OK" }] });
assert.deepEqual(outcomes, { ok: true, capability: "swing.outcomes", value: { count: 1 } });

const replay = await gateway.invoke("replay.resolve", { input: { signal_id: "x" } });
assert.equal(replay.ok, true);
assert.deepEqual(callLog, ["review.summary", "swing.rank", "swing.outcomes", "replay.resolve"]);

const unknown = await gateway.invoke("unknown.capability", {});
assert.equal(unknown.ok, false);
if (!unknown.ok) {
  assert.equal(unknown.error.code, "UNKNOWN_CAPABILITY");
  assert.ok(unknown.error.message.length <= 120);
}

let containedLoadCount = 0;
const contained = createResearchVNextGateway({
  timeoutMs: 100,
  maxErrorMessageChars: 80,
  loadFacade: async () => {
    containedLoadCount += 1;
    return {
      ...fakeFacade,
      summarizeReviewEvidence() {
        throw new Error("X".repeat(500));
      },
    };
  },
});
const failed = await contained.invoke("review.summary", { rows: [] });
assert.equal(failed.ok, false);
if (!failed.ok) {
  assert.equal(failed.error.code, "CAPABILITY_FAILED");
  assert.ok(failed.error.message.length <= 80, "gateway errors must be bounded");
}
assert.equal(containedLoadCount, 1);
const afterFailure = await contained.invoke("swing.outcomes", { results: [] });
assert.deepEqual(afterFailure, { ok: true, capability: "swing.outcomes", value: { count: 0 } }, "one capability failure must not poison the gateway");

const timeout = createResearchVNextGateway({
  timeoutMs: 5,
  maxErrorMessageChars: 120,
  loadFacade: async () => ({
    ...fakeFacade,
    async resolveSelective1mReplay() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { resolved: true };
    },
  }),
});
const timedOut = await timeout.invoke("replay.resolve", { input: {} });
assert.equal(timedOut.ok, false);
if (!timedOut.ok) assert.equal(timedOut.error.code, "TIMEOUT");

const repoRoot = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src/v6/research-vnext/research-gateway.ts"), "utf8");
const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(executable, /^\s*import[\s\S]*?from\s+["']\.\/shadow-facade\.ts["']/m, "gateway must not statically import the facade");
assert.doesNotMatch(executable, /research-tools|owner-content-handler|mcp-runtime-composition|index-v6|family-|tw-market-data|formal-blind|registerTool|registerResearchTools/i, "gateway must remain outside shared Production composition");
assert.doesNotMatch(executable, /\.\.\/review-orchestrator|\.\.\/selective-1m-replay|\.\.\/gpt-judgment-memory/i, "gateway must not delegate to legacy research runtime");
assert.doesNotMatch(executable, /\bfetch\s*\(/, "gateway must not access providers directly");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_GATEWAY_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_GATEWAY_VERSION,
  loader: "LAZY_CACHED",
  failure_containment: "PER_CALL",
  timeout: "BOUNDED",
  production_registration: "DISABLED",
}, null, 2));
