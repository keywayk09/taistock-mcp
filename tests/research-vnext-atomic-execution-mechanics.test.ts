import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(
  fixture.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
);

const skeletonNote = read("docs/change-notes/2026-09-01-research-vnext-atomic-production-execution-skeleton.md");
assert.match(
  skeletonNote,
  /PASS_ATOMIC_PRODUCTION_EXECUTION_SKELETON_BLOCKED_NO_CREDENTIALS_NO_COMMANDS_PRODUCTION_UNCHANGED/,
);

const blockedWorkflow = read(".github/workflows/research-vnext-atomic-production-execution.yml");
assert.match(blockedWorkflow, /ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION/);
assert.match(blockedWorkflow, /production_deploy_authorized=false/);
assert.match(blockedWorkflow, /production_mutation=NONE/);
assert.doesNotMatch(blockedWorkflow, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|RESEARCH_VNEXT_OAUTH_KV_ID/);
assert.doesNotMatch(blockedWorkflow, /\bwrangler\b|\bcurl\b|api\.cloudflare\.com|workers\.dev/i);

console.log("ATOMIC_EXECUTION_MECHANICS_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  blocked_skeleton: "SEALED",
  cloudflare_credentials_wired: false,
  production_commands_present: false,
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after the sealed hard-blocked workflow and frozen ABI
// premises above pass may the pure deterministic mechanics planner be added.
const mechanics = await import("../src/v6/research-vnext/atomic-execution-mechanics.ts");

assert.equal(mechanics.RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_VERSION, "research-vnext-atomic-execution-mechanics/v1.0.0");

const validInput = {
  confirmation: "EXECUTE_ATOMIC_VNEXT_PRODUCTION",
  expectedSha: "1234567890abcdef1234567890abcdef12345678",
  actualSha: "1234567890abcdef1234567890abcdef12345678",
  oauthKvId: "0123456789abcdef0123456789abcdef",
  predeployVersionId: "11111111-2222-4333-8444-555555555555",
  predeployCrons: ["*/5 * * * *"],
  protectedExports: ["MyMCP", "FamilyMCP"],
  bindingFingerprint: "a".repeat(64),
  hardBlockerActive: true,
  productionAuthorizationIssued: false,
};

const plan = mechanics.buildAtomicProductionExecutionMechanics(validInput);
assert.equal(plan.schema, "RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_PLAN_V1");
assert.equal(plan.status, "READY_BEHIND_HARD_BLOCKER");
assert.equal(plan.source_sha, validInput.actualSha);
assert.equal(plan.predeploy_version_id, validInput.predeployVersionId);
assert.deepEqual(plan.predeploy_crons, ["*/5 * * * *"]);
assert.deepEqual(plan.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.equal(plan.binding_fingerprint, validInput.bindingFingerprint);
assert.equal(plan.oauth_kv_validated, true);
assert.equal(plan.hard_blocker, "REQUIRED_ACTIVE");
assert.equal(plan.production_deploy_authorized, false);
assert.equal(plan.production_mutation, "NONE");
assert.deepEqual(
  plan.operation_graph.map((row: any) => [row.order, row.operation, row.execution_class]),
  [
    [1, "VERIFY_EXACT_SHA_AND_CONFIRMATION", "LOCAL_ONLY"],
    [2, "SNAPSHOT_ACTIVE_DEPLOYMENT_VERSION", "FUTURE_READ_ONLY_CONTROL_PLANE"],
    [3, "SNAPSHOT_CRON_PRE", "FUTURE_READ_ONLY_CONTROL_PLANE"],
    [4, "BUILD_ATOMIC_CONFIG", "LOCAL_ONLY"],
    [5, "VERIFY_EXPORTS_AND_BINDING_FINGERPRINT", "LOCAL_ONLY"],
    [6, "EXECUTE_ATOMIC_DEPLOY", "FUTURE_MUTATION_BLOCKED"],
    [7, "RUN_READ_ONLY_PRODUCTION_PROBE", "FUTURE_READ_ONLY_PRODUCTION"],
    [8, "SNAPSHOT_CRON_POST", "FUTURE_READ_ONLY_CONTROL_PLANE"],
    [9, "COMPARE_POSTDEPLOY_ABI_AND_CRON", "LOCAL_ONLY"],
    [10, "ASSESS_MANUAL_ROLLBACK_ELIGIBILITY", "LOCAL_ONLY"],
    [11, "MANUAL_ROLLBACK_EXACT_VERSION", "FUTURE_MUTATION_CONDITIONAL_BLOCKED"],
  ],
);

const expectInvalid = (patch: Record<string, unknown>, reason: string) => {
  assert.throws(
    () => mechanics.buildAtomicProductionExecutionMechanics({ ...validInput, ...patch }),
    new RegExp(`atomic_execution_mechanics_invalid:${reason}`),
  );
};
expectInvalid({ confirmation: "wrong" }, "confirmation_mismatch");
expectInvalid({ expectedSha: "abc" }, "expected_sha_must_be_40_hex");
expectInvalid({ actualSha: "f".repeat(40) }, "source_sha_mismatch");
expectInvalid({ oauthKvId: "bad" }, "oauth_kv_id_must_be_32_hex");
expectInvalid({ predeployVersionId: "bad" }, "predeploy_version_id_must_be_uuid");
expectInvalid({ predeployCrons: [] }, "predeploy_cron_contract_mismatch");
expectInvalid({ protectedExports: ["FamilyMCP", "MyMCP"] }, "protected_exports_mismatch");
expectInvalid({ bindingFingerprint: "bad" }, "binding_fingerprint_must_be_64_hex");
expectInvalid({ hardBlockerActive: false }, "hard_blocker_must_remain_active");
expectInvalid({ productionAuthorizationIssued: true }, "production_authorization_must_remain_false_in_design_phase");

const eligibleRollback = mechanics.assessAtomicRollbackEligibility({
  predeployVersionId: validInput.predeployVersionId,
  doLifecycleChanged: false,
  bindingsValid: true,
  targetVersionAvailable: true,
  cronSnapshotMatches: true,
});
assert.deepEqual(eligibleRollback, {
  schema: "RESEARCH_VNEXT_ATOMIC_ROLLBACK_ELIGIBILITY_V1",
  eligible: true,
  target_version_id: validInput.predeployVersionId,
  automatic: false,
  action: "MANUAL_ROLLBACK_ELIGIBLE",
  reason: "NO_DO_LIFECYCLE_CHANGE_AND_BINDINGS_STILL_VALID",
});

for (const [patch, reason] of [
  [{ doLifecycleChanged: true }, "DO_LIFECYCLE_CHANGED"],
  [{ bindingsValid: false }, "BINDINGS_NOT_VALID"],
  [{ targetVersionAvailable: false }, "TARGET_VERSION_NOT_AVAILABLE"],
  [{ cronSnapshotMatches: false }, "CRON_SNAPSHOT_DRIFT"],
] as const) {
  const result = mechanics.assessAtomicRollbackEligibility({
    predeployVersionId: validInput.predeployVersionId,
    doLifecycleChanged: false,
    bindingsValid: true,
    targetVersionAvailable: true,
    cronSnapshotMatches: true,
    ...patch,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.automatic, false);
  assert.equal(result.action, "FAIL_CLOSED_MANUAL_INTERVENTION");
  assert.equal(result.reason, reason);
}

const source = read("src/v6/research-vnext/atomic-execution-mechanics.ts");
assert.doesNotMatch(source, /^\s*import\s/m);
assert.doesNotMatch(source, /\bfetch\s*\(|api\.cloudflare\.com|workers\.dev|child_process|exec\(|spawn\(|\bcurl\b/i);
assert.doesNotMatch(source, /wrangler\s+(?:deploy|rollback|versions)/i);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_TEST_V1",
  status: "PASS",
  plan_status: plan.status,
  operation_count: plan.operation_graph.length,
  future_mutation_steps: plan.operation_graph.filter((row: any) => row.execution_class.includes("MUTATION")).length,
  hard_blocker: plan.hard_blocker,
  automatic_rollback: false,
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));
