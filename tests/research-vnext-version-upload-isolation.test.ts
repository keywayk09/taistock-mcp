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
  "version-upload preparation must not authorize Legacy retirement",
);

const preflightNote = read("docs/change-notes/2026-09-01-research-vnext-production-validation-preflight.md");
assert.match(
  preflightNote,
  /PASS_PRODUCTION_VALIDATION_PREFLIGHT_HARNESS_READY_PRODUCTION_NOT_CONTACTED/,
  "Production validation preflight must be sealed before version-upload isolation starts",
);

const wrangler = read("wrangler.jsonc");
const oauthBlock = wrangler.match(/\{\s*"binding"\s*:\s*"OAUTH_KV"[\s\S]*?\}/)?.[0] ?? "";
assert.ok(oauthBlock, "wrangler must still contain OAUTH_KV binding");
assert.doesNotMatch(oauthBlock, /"id"\s*:/, "source wrangler must still require external existing OAuth KV id injection");
assert.match(wrangler, /"triggers"\s*:\s*\{[\s\S]*?"crons"\s*:\s*\["\*\/5 \* \* \* \*"\]/);
assert.match(wrangler, /"MyMCP"/);
assert.match(wrangler, /"FamilyMCP"/);

const canonicalDeploy = read(".github/workflows/deploy-cloudflare-production.yml");
assert.match(canonicalDeploy, /storage\/kv\/namespaces/);
assert.match(canonicalDeploy, /curl[^\n]*-X POST/);
assert.match(canonicalDeploy, /workers\/scripts\/taistock-mcp\/schedules/);
assert.match(canonicalDeploy, /curl[^\n]*-X PUT/);
assert.match(canonicalDeploy, /wrangler deploy --config wrangler\.production\.jsonc/);

console.log("VERSION_UPLOAD_ISOLATION_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_VERSION_UPLOAD_ISOLATION_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  source_oauth_kv_id_present: false,
  source_cron_present: true,
  canonical_deploy_has_resource_side_effects: true,
  legacy_retirement: RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_retirement,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after every premise above has passed once in CI may
// the local planner and manual upload workflow be implemented.
const planner = await import("../scripts/research-vnext-version-upload-plan.mjs");

assert.equal(planner.RESEARCH_VNEXT_VERSION_UPLOAD_PLAN_VERSION, "research-vnext-version-upload-plan/v1.0.0");
assert.equal(typeof planner.buildVersionUploadPlan, "function");

const fakeKv = "0123456789abcdef0123456789abcdef";
const sourceBefore = wrangler;
const plan = planner.buildVersionUploadPlan({ sourceConfig: wrangler, oauthKvId: fakeKv });
assert.equal(wrangler, sourceBefore, "planner must never mutate source config text");
assert.equal(plan.receipt.schema, "RESEARCH_VNEXT_VERSION_UPLOAD_PLAN_RECEIPT_V1");
assert.equal(plan.receipt.status, "READY");
assert.equal(plan.receipt.worker_name, "taistock-mcp");
assert.equal(plan.receipt.oauth_kv_binding, "OAUTH_KV");
assert.equal(plan.receipt.oauth_kv_id_validated, true);
assert.equal(plan.receipt.cron_in_source, true);
assert.equal(plan.receipt.cron_in_upload_config, false);
assert.equal(plan.receipt.write_operation, "VERSIONS_UPLOAD_ONLY");
assert.equal(plan.receipt.traffic_shift, "NONE");
assert.equal(plan.receipt.trigger_mutation, "NONE");
assert.equal(plan.receipt.resource_provisioning, "DISABLED");
assert.equal(JSON.stringify(plan.receipt).includes(fakeKv), false, "planner receipt must not leak OAuth KV namespace id");

const generated = String(plan.configText);
assert.match(generated, new RegExp(`"binding"\\s*:\\s*"OAUTH_KV"[\\s\\S]*?"id"\\s*:\\s*"${fakeKv}"`));
assert.equal((generated.match(new RegExp(fakeKv, "g")) ?? []).length, 1, "existing OAuth KV id must be injected exactly once");
assert.doesNotMatch(generated, /"triggers"\s*:/, "temporary version-upload config must carry no Cron trigger intent");
assert.match(generated, /"MyMCP"/);
assert.match(generated, /"FamilyMCP"/);

for (const invalid of ["", "abc", "g".repeat(32), "0".repeat(31), "0".repeat(33)]) {
  assert.throws(
    () => planner.buildVersionUploadPlan({ sourceConfig: wrangler, oauthKvId: invalid }),
    /oauth|kv|32|hex/i,
    `invalid existing OAuth KV id must fail closed: ${invalid || "<empty>"}`,
  );
}

const alreadyBound = wrangler.replace(
  '"binding": "OAUTH_KV"',
  `"binding": "OAUTH_KV",\n\t\t\t"id": "${fakeKv}"`,
);
assert.throws(
  () => planner.buildVersionUploadPlan({ sourceConfig: alreadyBound, oauthKvId: fakeKv }),
  /already|id|source/i,
  "planner must fail closed if source binding semantics have changed",
);

const plannerSource = read("scripts/research-vnext-version-upload-plan.mjs");
assert.doesNotMatch(plannerSource, /\bfetch\s*\(/);
assert.doesNotMatch(plannerSource, /api\.cloudflare\.com/i);
assert.doesNotMatch(plannerSource, /child_process|exec\(|spawn\(/i);
assert.doesNotMatch(plannerSource, /wrangler\s+(deploy|versions\s+deploy|triggers\s+deploy)/i);

const workflow = read(".github/workflows/research-vnext-version-upload.yml");
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule|workflow_call):/m, "version upload must remain manual-only");
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, /UPLOAD_UNDEPLOYED_VNEXT_VERSION/);
assert.match(workflow, /RESEARCH_VNEXT_OAUTH_KV_ID/);
assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
assert.match(workflow, /research-vnext-version-upload-plan\.mjs/);
assert.match(workflow, /wrangler versions upload/);
assert.match(workflow, /--experimental-provision=false/);
assert.match(workflow, /--experimental-auto-create=false/);
assert.match(workflow, /wrangler versions list[^\n]*--json/);
assert.match(workflow, /actions\/upload-artifact/);
assert.doesNotMatch(workflow, /wrangler\s+deploy/i);
assert.doesNotMatch(workflow, /wrangler\s+versions\s+deploy/i);
assert.doesNotMatch(workflow, /wrangler\s+triggers\s+deploy/i);
assert.doesNotMatch(workflow, /api\.cloudflare\.com/i);
assert.doesNotMatch(workflow, /curl[^\n]*-X\s+(POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(workflow, /research-vnext-production-probe\.mjs/);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_VERSION_UPLOAD_ISOLATION_TEST_V1",
  status: "PASS",
  local_planner: "PASS",
  existing_kv_input_only: "PASS",
  cron_stripped_from_upload_config: "PASS",
  auto_provisioning: "DISABLED",
  workflow_mode: "MANUAL_UNDEPLOYED_VERSION_UPLOAD",
  workflow_dispatched: false,
  production_traffic_shift: "NONE",
  production_mutation_during_ci: "NONE",
}, null, 2));
