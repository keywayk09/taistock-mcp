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

const doNote = read("docs/change-notes/2026-09-01-research-vnext-do-platform-compatibility.md");
assert.match(
  doNote,
  /PASS_DO_PLATFORM_COMPATIBILITY_FAIL_CLOSED_PRODUCTION_UNCHANGED/,
  "DO platform compatibility must be sealed before atomic-deploy preflight",
);

assert.equal(
  RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.versions_upload,
  "BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT",
);
assert.equal(
  RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.gradual_deployment,
  "BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT",
);
assert.equal(RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.lifecycle_deploy, "WRANGLER_DEPLOY_REQUIRED");
assert.deepEqual(RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.equal(RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.production_mutation, "NONE");

const wrangler = read("wrangler.jsonc");
assert.match(wrangler, /"name"\s*:\s*"taistock-mcp"/);
const oauthBlock = wrangler.match(/\{\s*"binding"\s*:\s*"OAUTH_KV"[\s\S]*?\}/)?.[0] ?? "";
assert.ok(oauthBlock);
assert.doesNotMatch(oauthBlock, /"id"\s*:/);
assert.match(wrangler, /"triggers"\s*:\s*\{[\s\S]*?"crons"\s*:\s*\["\*\/5 \* \* \* \*"\]/);
assert.doesNotMatch(wrangler, /"migrations"\s*:/);
assert.match(wrangler, /"MyMCP"\s*:\s*\{\s*"type"\s*:\s*"durable-object",\s*"storage"\s*:\s*"sqlite"\s*\}/);
assert.match(wrangler, /"FamilyMCP"\s*:\s*\{\s*"type"\s*:\s*"durable-object",\s*"storage"\s*:\s*"sqlite"\s*\}/);
assert.match(wrangler, /"class_name"\s*:\s*"MyMCP"[\s\S]*?"name"\s*:\s*"MCP_OBJECT"/);
assert.match(wrangler, /"class_name"\s*:\s*"FamilyMCP"[\s\S]*?"name"\s*:\s*"FAMILY_MCP_OBJECT"/);
const exportsBlock = wrangler.match(/\n\t"exports"\s*:\s*\{[\s\S]*?\n\t\},\n\t"durable_objects"/)?.[0] ?? "";
assert.ok(exportsBlock, "protected exports block must be capturable for exact preservation check");

const canonicalDeploy = read(".github/workflows/deploy-cloudflare-production.yml");
assert.match(canonicalDeploy, /storage\/kv\/namespaces/);
assert.match(canonicalDeploy, /curl[^\n]*-X POST/);
assert.match(canonicalDeploy, /wrangler deploy --config wrangler\.production\.jsonc/);
assert.match(canonicalDeploy, /workers\/scripts\/taistock-mcp\/schedules/);
assert.match(canonicalDeploy, /curl[^\n]*-X PUT/);

const blockedUpload = read(".github/workflows/research-vnext-version-upload.yml");
assert.match(blockedUpload, /DO_EXPORTS_VERSION_UPLOAD_BLOCKED/);
assert.match(blockedUpload, /PLATFORM_REAUTHORIZATION_REQUIRED/);

console.log("ATOMIC_DEPLOY_PREFLIGHT_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_DEPLOY_PREFLIGHT_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  protected_exports: RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.protected_exports,
  source_oauth_kv_id_present: false,
  source_cron_present: true,
  canonical_kv_create_side_effect: true,
  canonical_cron_put_side_effect: true,
  versions_upload: RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.versions_upload,
  lifecycle_deploy: RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY.lifecycle_deploy,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after all premises above pass in CI may the pure
// atomic-deploy planner and bounded CI dry-run step be implemented.
const planner = await import("../scripts/research-vnext-atomic-deploy-plan.mjs");

assert.equal(
  planner.RESEARCH_VNEXT_ATOMIC_DEPLOY_PLAN_VERSION,
  "research-vnext-atomic-deploy-plan/v1.0.0",
);
assert.equal(typeof planner.buildAtomicDeployPlan, "function");

const fakeKv = "0123456789abcdef0123456789abcdef";
const sourceBefore = wrangler;
const plan = planner.buildAtomicDeployPlan({ sourceConfig: wrangler, oauthKvId: fakeKv });
assert.equal(wrangler, sourceBefore, "planner must never mutate source config text");
assert.equal(plan.receipt.schema, "RESEARCH_VNEXT_ATOMIC_DEPLOY_PLAN_RECEIPT_V1");
assert.equal(plan.receipt.status, "READY_FOR_DRY_RUN_ONLY");
assert.equal(plan.receipt.worker_name, "taistock-mcp");
assert.equal(plan.receipt.oauth_kv_binding, "OAUTH_KV");
assert.equal(plan.receipt.oauth_kv_id_validated, true);
assert.equal(plan.receipt.cron_in_source, true);
assert.equal(plan.receipt.triggers_in_deploy_config, false);
assert.equal(plan.receipt.crons_empty_array_in_deploy_config, false);
assert.deepEqual(plan.receipt.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.equal(plan.receipt.exports_preserved, true);
assert.equal(plan.receipt.migrations_present, false);
assert.equal(plan.receipt.deployment_mode, "ATOMIC_IMMEDIATE_100_PERCENT");
assert.equal(plan.receipt.phase_authorization, "DRY_RUN_ONLY");
assert.equal(plan.receipt.production_deploy_authorized, false);
assert.equal(plan.receipt.trigger_mutation_intent, "NONE");
assert.equal(plan.receipt.resource_provisioning, "DISABLED");
assert.equal(plan.receipt.production_mutation, "NONE");
assert.equal(JSON.stringify(plan.receipt).includes(fakeKv), false, "receipt must not leak OAuth KV namespace id");

const generated = String(plan.configText);
assert.match(generated, new RegExp(`"binding"\\s*:\\s*"OAUTH_KV"[\\s\\S]*?"id"\\s*:\\s*"${fakeKv}"`));
assert.equal((generated.match(new RegExp(fakeKv, "g")) ?? []).length, 1);
assert.doesNotMatch(generated, /"triggers"\s*:/);
assert.doesNotMatch(generated, /"crons"\s*:\s*\[\s*\]/);
assert.ok(generated.includes(exportsBlock), "protected exports block must be preserved exactly");
assert.match(generated, /"class_name"\s*:\s*"MyMCP"[\s\S]*?"name"\s*:\s*"MCP_OBJECT"/);
assert.match(generated, /"class_name"\s*:\s*"FamilyMCP"[\s\S]*?"name"\s*:\s*"FAMILY_MCP_OBJECT"/);
assert.doesNotMatch(generated, /"migrations"\s*:/);

for (const invalid of ["", "abc", "g".repeat(32), "0".repeat(31), "0".repeat(33)]) {
  assert.throws(
    () => planner.buildAtomicDeployPlan({ sourceConfig: wrangler, oauthKvId: invalid }),
    /oauth|kv|32|hex/i,
  );
}

const changedExport = wrangler.replace('"storage": "sqlite"', '"storage": "legacy-kv"');
assert.throws(
  () => planner.buildAtomicDeployPlan({ sourceConfig: changedExport, oauthKvId: fakeKv }),
  /export|durable|storage|contract/i,
  "protected Durable Object export changes must fail closed",
);
const missingExports = wrangler.replace(/\n\t"exports"\s*:\s*\{[\s\S]*?\n\t\},(?=\n\t"durable_objects")/, "");
assert.throws(
  () => planner.buildAtomicDeployPlan({ sourceConfig: missingExports, oauthKvId: fakeKv }),
  /export|durable|contract/i,
);

const plannerSource = read("scripts/research-vnext-atomic-deploy-plan.mjs");
assert.doesNotMatch(plannerSource, /\bfetch\s*\(|api\.cloudflare\.com/i);
assert.doesNotMatch(plannerSource, /child_process|exec\(|spawn\(/i);
assert.doesNotMatch(plannerSource, /wrangler\s+(?:deploy|versions\s+upload|versions\s+deploy|triggers\s+deploy)/i);

const gate = read(".github/workflows/research-vnext-foundation-gate.yml");
assert.match(gate, /scripts\/research-vnext-\*\.mjs/);
assert.match(gate, /Atomic deploy config dry-run only/);
assert.match(gate, /research-vnext-atomic-deploy-plan\.mjs/);
assert.match(gate, /RESEARCH_VNEXT_OAUTH_KV_ID:\s*0123456789abcdef0123456789abcdef/);
assert.match(gate, /--experimental-provision=false/);
assert.match(gate, /--experimental-auto-create=false/);
assert.match(gate, /atomic_deploy_preflight=PASS/);
const deployLines = gate.split("\n").filter((line) => /npx\s+wrangler\s+deploy\b/.test(line));
assert.ok(deployLines.length >= 2, "canonical and atomic-config dry-runs must both be present");
for (const line of deployLines) {
  assert.match(line, /--dry-run/, `all VNext gate wrangler deploy invocations must be dry-run only: ${line}`);
}
assert.doesNotMatch(gate, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_DEPLOY_PREFLIGHT_TEST_V1",
  status: "PASS",
  local_planner: "PASS",
  protected_exports: "EXACTLY_PRESERVED",
  oauth_kv: "EXISTING_INPUT_ONLY",
  trigger_mutation_intent: "NONE",
  resource_provisioning: "DISABLED",
  ci_execution: "WRANGLER_DEPLOY_DRY_RUN_ONLY",
  real_deploy_semantics: "ATOMIC_IMMEDIATE_100_PERCENT",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));
