import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

const uploadNote = read("docs/change-notes/2026-09-01-research-vnext-version-upload-isolation.md");
assert.match(
  uploadNote,
  /PASS_VERSION_UPLOAD_ISOLATION_PATH_READY_NOT_EXECUTED/,
  "historical local-isolation PASS must remain sealed and immutable",
);

const wrangler = read("wrangler.jsonc");
assert.match(wrangler, /Durable Object lifecycle uses declarative exports; production deploys must use `wrangler deploy`/);
assert.match(wrangler, /"exports"\s*:\s*\{/);
assert.match(wrangler, /"MyMCP"\s*:\s*\{[\s\S]*?"type"\s*:\s*"durable-object"/);
assert.match(wrangler, /"FamilyMCP"\s*:\s*\{[\s\S]*?"type"\s*:\s*"durable-object"/);
assert.doesNotMatch(wrangler, /"migrations"\s*:/, "do not mix declarative exports with legacy migrations");

const uploadWorkflow = read(".github/workflows/research-vnext-version-upload.yml");
assert.match(uploadWorkflow, /workflow_dispatch:/);
assert.match(uploadWorkflow, /wrangler versions upload/);
assert.doesNotMatch(
  uploadWorkflow,
  /DO_EXPORTS_VERSION_UPLOAD_BLOCKED/,
  "RED premise requires the current manual workflow to lack the newly required platform blocker",
);

console.log("DO_PLATFORM_COMPATIBILITY_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_DO_PLATFORM_COMPATIBILITY_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  durable_object_exports: ["MyMCP", "FamilyMCP"],
  versions_upload_present: true,
  versions_upload_platform_blocker_present: false,
  legacy_retirement: RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_retirement,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after every repository/platform premise above has
// passed in CI may the policy-only compatibility correction be implemented.
const policyModule = await import("../src/v6/research-vnext/do-deployment-policy.ts");

const policy = policyModule.RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY;
assert.equal(policy.schema, "RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY_V1");
assert.equal(policy.versions_upload, "BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT");
assert.equal(policy.gradual_deployment, "BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT");
assert.equal(policy.lifecycle_deploy, "WRANGLER_DEPLOY_REQUIRED");
assert.equal(policy.remove_exports_automatically, false);
assert.deepEqual(policy.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.equal(policy.zero_traffic_candidate_validation, "BLOCKED_PENDING_COMPATIBLE_DEPLOYMENT_DESIGN");
assert.equal(policy.production_mutation, "NONE");

const policySource = read("src/v6/research-vnext/do-deployment-policy.ts");
assert.doesNotMatch(policySource, /^\s*import\s/m);
assert.doesNotMatch(policySource, /\bfetch\s*\(|api\.cloudflare\.com|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(policySource, /wrangler\s+(?:deploy|versions\s+upload|versions\s+deploy|triggers\s+deploy)/i);

const correctedWorkflow = read(".github/workflows/research-vnext-version-upload.yml");
assert.match(correctedWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(correctedWorkflow, /^\s*(push|pull_request|schedule|workflow_call):/m);
assert.match(correctedWorkflow, /DO_EXPORTS_VERSION_UPLOAD_BLOCKED/);
assert.match(correctedWorkflow, /PLATFORM_REAUTHORIZATION_REQUIRED/);
assert.match(correctedWorkflow, /"exports"|exports/);

const blockerAt = correctedWorkflow.indexOf("DO_EXPORTS_VERSION_UPLOAD_BLOCKED");
assert.ok(blockerAt >= 0, "explicit DO exports blocker must exist");
for (const laterOperation of [
  "actions/setup-node@v4",
  "npm install",
  "research-vnext-version-upload-plan.mjs",
  "wrangler deployments list",
  "wrangler versions upload",
  "wrangler versions list",
]) {
  const operationAt = correctedWorkflow.indexOf(laterOperation);
  assert.ok(operationAt > blockerAt, `${laterOperation} must remain after the fail-closed platform blocker`);
}

const blockerStep = correctedWorkflow.slice(
  Math.max(0, correctedWorkflow.lastIndexOf("- name:", blockerAt)),
  correctedWorkflow.indexOf("\n      - name:", blockerAt + 1) === -1
    ? correctedWorkflow.length
    : correctedWorkflow.indexOf("\n      - name:", blockerAt + 1),
);
assert.match(blockerStep, /exit 78/);
assert.match(blockerStep, /wrangler\.jsonc/);
assert.match(blockerStep, /exports/);
assert.match(blockerStep, /PLATFORM_REAUTHORIZATION_REQUIRED/);
assert.doesNotMatch(blockerStep, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|RESEARCH_VNEXT_OAUTH_KV_ID/);
assert.doesNotMatch(blockerStep, /wrangler\s|curl\s|fetch\s/i);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_DO_PLATFORM_COMPATIBILITY_TEST_V1",
  status: "PASS",
  versions_upload: policy.versions_upload,
  gradual_deployment: policy.gradual_deployment,
  lifecycle_deploy: policy.lifecycle_deploy,
  protected_exports: policy.protected_exports,
  manual_upload_workflow: "FAIL_CLOSED_BEFORE_CLOUDFLARE_OPERATION",
  zero_traffic_candidate_validation: policy.zero_traffic_candidate_validation,
  production_mutation: "NONE",
}, null, 2));
