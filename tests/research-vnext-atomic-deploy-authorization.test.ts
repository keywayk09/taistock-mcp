import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY } from "../src/v6/research-vnext/do-deployment-policy.ts";
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
assert.equal(
  RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.lifecycle_deploy,
  "WRANGLER_DEPLOY_REQUIRED",
);
assert.equal(
  RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.versions_upload,
  "BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT",
);
assert.deepEqual(RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.protected_exports, ["MyMCP", "FamilyMCP"]);

const preflightNote = read("docs/change-notes/2026-09-01-research-vnext-atomic-deploy-preflight.md");
assert.match(
  preflightNote,
  /PASS_ATOMIC_DEPLOY_PREFLIGHT_DRY_RUN_ONLY_PRODUCTION_UNCHANGED/,
  "atomic deploy dry-run preflight must be sealed before execution authorization design",
);

const atomicPlanner = read("scripts/research-vnext-atomic-deploy-plan.mjs");
assert.match(atomicPlanner, /READY_FOR_DRY_RUN_ONLY/);
assert.match(atomicPlanner, /ATOMIC_IMMEDIATE_100_PERCENT/);
assert.match(atomicPlanner, /production_deploy_authorized:\s*false/);
assert.doesNotMatch(atomicPlanner, /\bfetch\s*\(|child_process|exec\(|spawn\(/i);

const readOnlyValidation = read(".github/workflows/research-vnext-production-validation.yml");
assert.match(readOnlyValidation, /workflow_dispatch:/);
assert.match(readOnlyValidation, /READ_ONLY_PRODUCTION_PROBE/);
assert.match(readOnlyValidation, /production_mutation=NONE/);

const canonicalDeploy = read(".github/workflows/deploy-cloudflare-production.yml");
assert.match(canonicalDeploy, /push:[\s\S]*?branches:[\s\S]*?- main/);
assert.match(canonicalDeploy, /curl[^\n]*-X POST/);
assert.match(canonicalDeploy, /wrangler deploy --config wrangler\.production\.jsonc/);
assert.match(canonicalDeploy, /curl[^\n]*-X PUT/);

const blockedUpload = read(".github/workflows/research-vnext-version-upload.yml");
assert.match(blockedUpload, /DO_EXPORTS_VERSION_UPLOAD_BLOCKED/);
assert.match(blockedUpload, /PLATFORM_REAUTHORIZATION_REQUIRED/);

console.log("ATOMIC_DEPLOY_AUTHORIZATION_PRECONDITIONS=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  protected_exports: RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.protected_exports,
  atomic_preflight: "SEALED_DRY_RUN_ONLY",
  canonical_production_workflow: "UNSUITABLE_FOR_VNEXT_CUTOVER_DUE_TO_EXTRA_SIDE_EFFECTS",
  versions_upload: RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.versions_upload,
  legacy_retirement: RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_retirement,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: the policy module must not exist until the repository,
// ABI, DO lifecycle, dry-run preflight and current Production-side-effect
// premises above have all passed in CI.
const authorizationModule = await import("../src/v6/research-vnext/atomic-deploy-authorization.ts");
const policy = authorizationModule.RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION;

assert.equal(policy.schema, "RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION_V1");
assert.equal(policy.phase, "DESIGN_ONLY_EXECUTION_BLOCKED");
assert.equal(policy.workflow_mode, "MANUAL_ONLY_REQUIRED");
assert.equal(policy.required_confirmation, "EXECUTE_ATOMIC_VNEXT_PRODUCTION");
assert.equal(policy.expected_sha, "EXACT_40_HEX_REQUIRED");
assert.equal(policy.oauth_kv, "EXISTING_SECRET_INPUT_ONLY");
assert.equal(policy.predeploy_snapshot, "ACTIVE_DEPLOYMENT_AND_VERSION_REQUIRED");
assert.equal(policy.cron_snapshot, "EXACT_PRE_POST_MATCH_REQUIRED");
assert.deepEqual(policy.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.equal(policy.do_lifecycle_change, "FORBIDDEN_FOR_THIS_CUTOVER");
assert.equal(policy.deploy_semantics, "ATOMIC_IMMEDIATE_100_PERCENT");
assert.equal(policy.rollback.mode, "EXACT_VERSION_ID_ONLY");
assert.equal(policy.rollback.target, "PREDEPLOY_ACTIVE_VERSION_REQUIRED");
assert.equal(
  policy.rollback.allowed_only_if,
  "NO_DO_LIFECYCLE_CHANGE_AND_BINDINGS_STILL_VALID",
);
assert.equal(policy.rollback.automatic, false);
assert.equal(policy.rollback.on_uncertainty, "FAIL_CLOSED_MANUAL_INTERVENTION");
assert.equal(policy.postdeploy_probe, "READ_ONLY_PRODUCTION_PROBE_REQUIRED");
assert.equal(policy.owner_tool_count, 123);
assert.equal(
  policy.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
);
assert.equal(policy.legacy_retirement, "BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE");
assert.equal(policy.production_deploy_authorized, false);
assert.equal(policy.production_mutation, "NONE");

const policySource = read("src/v6/research-vnext/atomic-deploy-authorization.ts");
assert.doesNotMatch(policySource, /^\s*import\s/m);
assert.doesNotMatch(policySource, /\bfetch\s*\(|api\.cloudflare\.com|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(policySource, /wrangler\s+(?:deploy|rollback|versions\s+upload|versions\s+deploy)/i);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION_TEST_V1",
  status: "PASS",
  phase: policy.phase,
  workflow_mode: policy.workflow_mode,
  deploy_semantics: policy.deploy_semantics,
  do_lifecycle_change: policy.do_lifecycle_change,
  rollback: policy.rollback,
  postdeploy_probe: policy.postdeploy_probe,
  owner_abi: `${policy.owner_tool_count}:${policy.owner_abi_sha256}`,
  legacy_retirement: policy.legacy_retirement,
  production_deploy_authorized: policy.production_deploy_authorized,
  production_mutation: policy.production_mutation,
}, null, 2));
