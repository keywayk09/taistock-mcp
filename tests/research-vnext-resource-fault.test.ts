import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RESEARCH_VNEXT_RESOURCE_POLICY_VERSION,
  ResearchVNextResourceError,
  assertResearchVNextResourceBudget,
} from "../src/v6/research-vnext/resource-policy.ts";
import { createResearchVNextGateway } from "../src/v6/research-vnext/research-gateway.ts";
import { createResearchVNextShadowFacade } from "../src/v6/research-vnext/shadow-facade.ts";
import { ResearchVNextMemoryError } from "../src/v6/research-vnext/memory/memory-core.ts";

assert.equal(RESEARCH_VNEXT_RESOURCE_POLICY_VERSION, "research-vnext-resource-policy/v1.0.0");

function fakeFacade(overrides: Record<string, unknown> = {}) {
  return {
    contract: () => ({ production_registration: "DISABLED" as const }),
    summarizeReviewEvidence: (rows: unknown[]) => ({ count: rows.length }),
    rankSwingEvidence: (signals: unknown[], limit = 10) => signals.slice(0, limit),
    summarizeSwingOutcomes: (results: unknown[]) => ({ count: results.length }),
    resolveSelective1mReplay: async (input: unknown) => ({ resolved: true, input }),
    memory: {},
    ...overrides,
  };
}

const accepted = assertResearchVNextResourceBudget(
  { rows: [{ id: 1, note: "small" }] },
  {
    maxInputBytes: 4096,
    maxArrayItems: 100,
    maxObjectKeys: 100,
    maxDepth: 10,
    maxNodes: 1000,
  },
);
assert.ok(accepted.bytes > 0);
assert.ok(accepted.nodes > 0);
assert.ok(accepted.max_depth >= 1);

let hugeLoaderCount = 0;
const hugeGateway = createResearchVNextGateway({
  resourcePolicy: {
    maxInputBytes: 4096,
    maxArrayItems: 3,
    maxObjectKeys: 100,
    maxDepth: 10,
    maxNodes: 1000,
  },
  loadFacade: async () => {
    hugeLoaderCount += 1;
    return fakeFacade();
  },
});
const huge = await hugeGateway.invoke("review.summary", {
  rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
});
assert.equal(huge.ok, false);
if (!huge.ok) assert.equal(huge.error.code, "RESOURCE_LIMIT");
assert.equal(hugeLoaderCount, 0, "resource rejection must happen before lazy facade load");

const largeTextGateway = createResearchVNextGateway({
  resourcePolicy: {
    maxInputBytes: 128,
    maxArrayItems: 100,
    maxObjectKeys: 100,
    maxDepth: 10,
    maxNodes: 1000,
  },
  loadFacade: async () => fakeFacade(),
});
const largeText = await largeTextGateway.invoke("review.summary", {
  rows: [{ note: "x".repeat(1000) }],
});
assert.equal(largeText.ok, false);
if (!largeText.ok) assert.equal(largeText.error.code, "RESOURCE_LIMIT");

const deep = { a: { b: { c: { d: 1 } } } };
assert.throws(
  () => assertResearchVNextResourceBudget(deep, {
    maxInputBytes: 4096,
    maxArrayItems: 100,
    maxObjectKeys: 100,
    maxDepth: 2,
    maxNodes: 1000,
  }),
  (error: unknown) => error instanceof ResearchVNextResourceError && error.code === "RESOURCE_LIMIT",
);

const circular: Record<string, unknown> = {};
circular.self = circular;
assert.throws(
  () => assertResearchVNextResourceBudget(circular),
  (error: unknown) => error instanceof ResearchVNextResourceError && error.code === "INVALID_RESOURCE_SHAPE",
);

let malformedLoaderCount = 0;
const malformedGateway = createResearchVNextGateway({
  loadFacade: async () => {
    malformedLoaderCount += 1;
    return fakeFacade();
  },
});
const malformed = await malformedGateway.invoke("review.summary", null);
assert.equal(malformed.ok, false);
if (!malformed.ok) assert.equal(malformed.error.code, "CAPABILITY_FAILED");
assert.equal(malformedLoaderCount, 0, "malformed input must fail before facade load");

let replayLoaderCount = 0;
const replayFault = createResearchVNextGateway({
  loadFacade: async () => {
    replayLoaderCount += 1;
    return fakeFacade({
      resolveSelective1mReplay: async () => {
        throw new Error("forced replay failure");
      },
    });
  },
});
const replayFailure = await replayFault.invoke("replay.resolve", { input: { id: "bad" } });
assert.equal(replayFailure.ok, false);
if (!replayFailure.ok) assert.equal(replayFailure.error.code, "CAPABILITY_FAILED");
const replayRecovery = await replayFault.invoke("review.summary", { rows: [] });
assert.deepEqual(replayRecovery, { ok: true, capability: "review.summary", value: { count: 0 } });
assert.equal(replayLoaderCount, 1, "replay failure must not poison or reload the facade");

const missingOhlcGateway = createResearchVNextGateway({ timeoutMs: 1000 });
const missingOhlc = await missingOhlcGateway.invoke("replay.resolve", { input: {} });
assert.equal(missingOhlc.ok, false);
if (!missingOhlc.ok) assert.equal(missingOhlc.error.code, "CAPABILITY_FAILED");

let repeatedLoaderCount = 0;
const repeated = createResearchVNextGateway({
  loadFacade: async () => {
    repeatedLoaderCount += 1;
    return fakeFacade();
  },
});
for (let index = 0; index < 50; index += 1) {
  const result = await repeated.invoke("review.summary", { rows: [{ index }] });
  assert.equal(result.ok, true);
}
assert.equal(repeatedLoaderCount, 1, "repeated bounded calls must share one lazy facade");

let coldLoadCount = 0;
const coldGateways = Array.from({ length: 20 }, () => createResearchVNextGateway({
  loadFacade: async () => {
    coldLoadCount += 1;
    return fakeFacade();
  },
}));
for (const gateway of coldGateways) gateway.contract();
assert.equal(coldLoadCount, 0, "cold-start contract inspection must not eager-load VNext");
const oneWarm = await coldGateways[0].invoke("review.summary", { rows: [] });
assert.equal(oneWarm.ok, true);
assert.equal(coldLoadCount, 1);

const memoryFacade = createResearchVNextShadowFacade({
  memoryAdapterOptions: { now: () => "2026-09-01T11:10:00.000Z" },
});
let memoryError: unknown;
try {
  await memoryFacade.memory.recordMarketJudgment({} as Env, {} as any);
} catch (error) {
  memoryError = error;
}
assert.ok(memoryError instanceof ResearchVNextMemoryError);
assert.equal((memoryError as ResearchVNextMemoryError).code, "INVALID_INPUT");
assert.doesNotThrow(() => memoryFacade.summarizeReviewEvidence([]), "Memory failure must not poison deterministic facade compute");

let schemaError: unknown;
try {
  await memoryFacade.memory.recordTradingKnowledge({} as Env, {
    knowledge_id: "fault-k1",
    knowledge_version: "v1",
    market_scope: "TW_STOCK",
    topic: "fault probe",
    statement: "invalid acceptance actor",
    status: "ACCEPTED",
    evidence_count: 1,
    actor_type: "GPT_REVIEW",
    human_approved: true,
  });
} catch (error) {
  schemaError = error;
}
assert.ok(schemaError instanceof ResearchVNextMemoryError);
assert.equal((schemaError as ResearchVNextMemoryError).code, "HUMAN_APPROVAL_REQUIRED");

const repoRoot = path.resolve(import.meta.dirname, "..");
const policySource = fs.readFileSync(path.join(repoRoot, "src/v6/research-vnext/resource-policy.ts"), "utf8");
const executablePolicy = policySource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(executablePolicy, /research-tools|owner-content-handler|mcp-runtime-composition|index-v6|family-|tw-market-data|formal-blind/i);
assert.doesNotMatch(executablePolicy, /\.\.\/review-orchestrator|\.\.\/selective-1m-replay|\.\.\/gpt-judgment-memory/i);
assert.doesNotMatch(executablePolicy, /\bfetch\s*\(|github-data-store|putIndexedImmutableRecord|readIndexedRecord/i);
assert.doesNotMatch(executablePolicy, /Date\.now\s*\(|new Date\s*\(/, "resource policy must be deterministic and clock-free");

const gatewaySource = fs.readFileSync(path.join(repoRoot, "src/v6/research-vnext/research-gateway.ts"), "utf8");
assert.match(gatewaySource, /resource-policy\.ts/, "gateway must enforce the pure resource policy before dispatch");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_RESOURCE_FAULT_TEST_V1",
  status: "PASS",
  version: RESEARCH_VNEXT_RESOURCE_POLICY_VERSION,
  huge_input: "BLOCKED_BEFORE_LOAD",
  replay_throw: "CONTAINED",
  memory_throw: "CONTAINED",
  bad_schema: "FAIL_CLOSED",
  missing_ohlc: "FAIL_CLOSED",
  repeated_calls: "LAZY_CACHE_STABLE",
  cold_start: "NO_EAGER_LOAD",
  production_registration: "DISABLED",
}, null, 2));
