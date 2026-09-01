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

const mechanicsNote = read("docs/change-notes/2026-09-01-research-vnext-atomic-execution-mechanics.md");
assert.match(
  mechanicsNote,
  /PASS_ATOMIC_EXECUTION_MECHANICS_BEHIND_HARD_BLOCKER_PRODUCTION_UNCHANGED/,
);

const blockedWorkflow = read(".github/workflows/research-vnext-atomic-production-execution.yml");
assert.match(blockedWorkflow, /ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION/);
assert.match(blockedWorkflow, /production_deploy_authorized=false/);
assert.match(blockedWorkflow, /production_mutation=NONE/);
assert.doesNotMatch(blockedWorkflow, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|\bwrangler\b|\bcurl\b|api\.cloudflare\.com/i);

const authorization = await import("../src/v6/research-vnext/atomic-deploy-authorization.ts");
assert.equal(authorization.RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.production_deploy_authorized, false);
assert.equal(authorization.RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.production_mutation, "NONE");
assert.deepEqual(
  authorization.RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION.protected_exports,
  ["MyMCP", "FamilyMCP"],
);

const wrangler = read("wrangler.jsonc");
assert.match(wrangler, /"MyMCP"\s*:\s*\{/);
assert.match(wrangler, /"FamilyMCP"\s*:\s*\{/);
assert.match(wrangler, /"class_name"\s*:\s*"MyMCP"/);
assert.match(wrangler, /"class_name"\s*:\s*"FamilyMCP"/);
assert.match(wrangler, /"binding"\s*:\s*"OAUTH_KV"/);
assert.match(wrangler, /"crons"\s*:\s*\["\*\/5 \* \* \* \*"\]/);

const canonicalDeploy = read(".github/workflows/deploy-cloudflare-production.yml");
assert.match(canonicalDeploy, /-X POST/);
assert.match(canonicalDeploy, /-X PUT/);
assert.match(canonicalDeploy, /wrangler deploy/);

console.log("PRODUCTION_CONTROL_PLANE_SNAPSHOT_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  atomic_execution_mechanics: "SEALED",
  blocked_execution_workflow: "SEALED",
  protected_exports: ["MyMCP", "FamilyMCP"],
  expected_cron: "*/5 * * * *",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after every sealed Production-safety premise above
// passes may a pure deterministic snapshot validator/receipt builder be added.
const snapshot = await import("../src/v6/research-vnext/production-control-plane-snapshot.ts");

assert.equal(
  snapshot.RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_VERSION,
  "research-vnext-production-control-plane-snapshot/v1.0.0",
);

const validInput = {
  workerName: "taistock-mcp",
  sourceSha: "1234567890abcdef1234567890abcdef12345678",
  activeDeploymentId: "11111111-2222-4333-8444-555555555555",
  activeVersionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  activeVersionPercentage: 100,
  cronSchedules: ["*/5 * * * *"],
  oauthKvId: "0123456789abcdef0123456789abcdef",
  protectedExports: ["MyMCP", "FamilyMCP"],
  durableObjectBindings: [
    { name: "MCP_OBJECT", className: "MyMCP" },
    { name: "FAMILY_MCP_OBJECT", className: "FamilyMCP" },
  ],
  bindingFingerprint: "a".repeat(64),
  hardBlockerActive: true,
  readOnlyCapture: true,
  productionAuthorizationIssued: false,
};

const receipt = snapshot.buildProductionControlPlaneSnapshot(validInput);
assert.equal(receipt.schema, "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_V1");
assert.equal(receipt.status, "READ_ONLY_SNAPSHOT_VALID");
assert.equal(receipt.worker_name, "taistock-mcp");
assert.equal(receipt.source_sha, validInput.sourceSha);
assert.equal(receipt.active_deployment_id, validInput.activeDeploymentId);
assert.equal(receipt.active_version_id, validInput.activeVersionId);
assert.equal(receipt.active_version_percentage, 100);
assert.deepEqual(receipt.cron_schedules, ["*/5 * * * *"]);
assert.equal(receipt.oauth_kv_id, validInput.oauthKvId);
assert.deepEqual(receipt.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.deepEqual(receipt.durable_object_bindings, validInput.durableObjectBindings);
assert.equal(receipt.binding_fingerprint, validInput.bindingFingerprint);
assert.equal(receipt.rollback_target_version_id, validInput.activeVersionId);
assert.equal(receipt.hard_blocker, "REQUIRED_ACTIVE");
assert.equal(receipt.production_deploy_authorized, false);
assert.equal(receipt.production_mutation, "NONE");

const expectInvalid = (patch: Record<string, unknown>, reason: string) => {
  assert.throws(
    () => snapshot.buildProductionControlPlaneSnapshot({ ...validInput, ...patch }),
    new RegExp(`production_control_plane_snapshot_invalid:${reason}`),
  );
};
expectInvalid({ workerName: "other" }, "worker_name_mismatch");
expectInvalid({ sourceSha: "bad" }, "source_sha_must_be_40_hex");
expectInvalid({ activeDeploymentId: "bad" }, "active_deployment_id_must_be_uuid");
expectInvalid({ activeVersionId: "bad" }, "active_version_id_must_be_uuid");
expectInvalid({ activeVersionPercentage: 99 }, "active_version_must_be_100_percent");
expectInvalid({ cronSchedules: [] }, "cron_contract_mismatch");
expectInvalid({ oauthKvId: "bad" }, "oauth_kv_id_must_be_32_hex");
expectInvalid({ protectedExports: ["FamilyMCP", "MyMCP"] }, "protected_exports_mismatch");
expectInvalid({ durableObjectBindings: [] }, "durable_object_bindings_mismatch");
expectInvalid({ bindingFingerprint: "bad" }, "binding_fingerprint_must_be_64_hex");
expectInvalid({ hardBlockerActive: false }, "hard_blocker_must_remain_active");
expectInvalid({ readOnlyCapture: false }, "snapshot_must_be_read_only");
expectInvalid({ productionAuthorizationIssued: true }, "production_authorization_must_remain_false");

const source = read("src/v6/research-vnext/production-control-plane-snapshot.ts");
assert.doesNotMatch(source, /^\s*import\s/m);
assert.doesNotMatch(source, /\bfetch\s*\(|api\.cloudflare\.com|workers\.dev|child_process|exec\(|spawn\(|\bcurl\b/i);
assert.doesNotMatch(source, /wrangler\s+(?:deploy|rollback|versions)/i);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_TEST_V1",
  status: "PASS",
  receipt_status: receipt.status,
  rollback_target_captured: true,
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));
