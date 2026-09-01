import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION } from "../src/v6/research-vnext/atomic-deploy-authorization.ts";
import { RESEARCH_VNEXT_RETIREMENT_POLICY } from "../src/v6/research-vnext/retirement-readiness.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(
  fixture.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
);
assert.equal(
  RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_retirement,
  "BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE",
);

const authorizationNote = read("docs/change-notes/2026-09-01-research-vnext-atomic-deploy-authorization.md");
assert.match(
  authorizationNote,
  /PASS_ATOMIC_DEPLOY_AUTHORIZATION_POLICY_EXECUTION_BLOCKED_PRODUCTION_UNCHANGED/,
  "authorization policy must be sealed before execution-workflow skeleton design",
);

assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.phase, "DESIGN_ONLY_EXECUTION_BLOCKED");
assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.workflow_mode, "MANUAL_ONLY_REQUIRED");
assert.equal(
  RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.required_confirmation,
  "EXECUTE_ATOMIC_VNEXT_PRODUCTION",
);
assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.expected_sha, "EXACT_40_HEX_REQUIRED");
assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.oauth_kv, "EXISTING_SECRET_INPUT_ONLY");
assert.deepEqual(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.rollback.automatic, false);
assert.equal(
  RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.rollback.on_uncertainty,
  "FAIL_CLOSED_MANUAL_INTERVENTION",
);
assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.owner_tool_count, 123);
assert.equal(
  RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
);
assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.production_deploy_authorized, false);
assert.equal(RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.production_mutation, "NONE");

console.log("ATOMIC_PRODUCTION_EXECUTION_SKELETON_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_PRODUCTION_EXECUTION_SKELETON_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  authorization_phase: RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.phase,
  workflow_mode: RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.workflow_mode,
  automatic_rollback: RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.rollback.automatic,
  production_deploy_authorized: RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.production_deploy_authorized,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after every policy / ABI premise above is proven in CI
// may the permanently blocked workflow skeleton be added.
const workflow = read(".github/workflows/research-vnext-atomic-production-execution.yml");

assert.match(workflow, /^name:\s*Research VNext Atomic Production Execution/m);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule|workflow_call):/m);
assert.match(workflow, /confirmation:/);
assert.match(workflow, /expected_sha:/);
assert.match(workflow, /EXECUTE_ATOMIC_VNEXT_PRODUCTION/);
assert.match(workflow, /EXACT_40_HEX_REQUIRED/);
assert.match(workflow, /BLOCKED_SKELETON/);
assert.match(workflow, /ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION/);
assert.match(workflow, /exit 78/);
assert.match(workflow, /production_deploy_authorized=false/);
assert.match(workflow, /production_mutation=NONE/);
assert.match(workflow, /PREDEPLOY_ACTIVE_VERSION_REQUIRED/);
assert.match(workflow, /EXACT_PRE_POST_MATCH_REQUIRED/);
assert.match(workflow, /NO_DO_LIFECYCLE_CHANGE_AND_BINDINGS_STILL_VALID/);
assert.match(workflow, /FAIL_CLOSED_MANUAL_INTERVENTION/);
assert.match(workflow, /READ_ONLY_PRODUCTION_PROBE_REQUIRED/);
assert.match(workflow, /123:00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d/);
assert.match(workflow, /contents:\s*read/);

const blockerAt = workflow.indexOf("ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION");
assert.ok(blockerAt >= 0);
const checkoutAt = workflow.indexOf("actions/checkout@v4");
assert.ok(checkoutAt >= 0 && checkoutAt < blockerAt, "checkout may precede the hard blocker");

// Blocked skeleton must contain no Cloudflare credential wiring or executable
// Production operation at all. A later separately RED-proven phase may add them.
assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|RESEARCH_VNEXT_OAUTH_KV_ID/);
assert.doesNotMatch(workflow, /actions\/setup-node@|npm\s+(?:install|ci)/);
assert.doesNotMatch(workflow, /\bwrangler\b|\bcurl\b|\bfetch\b/i);
assert.doesNotMatch(workflow, /research-vnext-production-probe\.mjs/);
assert.doesNotMatch(workflow, /workers\.dev|api\.cloudflare\.com/i);

const stepsAfterCheckout = workflow.slice(checkoutAt);
const blockerStepCount = (stepsAfterCheckout.match(/- name:\s*Fail closed pending explicit Production authorization/g) ?? []).length;
assert.equal(blockerStepCount, 1);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_PRODUCTION_EXECUTION_SKELETON_TEST_V1",
  status: "PASS",
  trigger: "WORKFLOW_DISPATCH_ONLY",
  execution_state: "BLOCKED_SKELETON",
  cloudflare_credentials_wired: false,
  production_commands_present: false,
  automatic_rollback: false,
  owner_abi: "123:00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));
