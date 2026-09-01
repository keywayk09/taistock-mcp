import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(repoRoot, relative));

const SOURCE_SHA = "87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7";
const BRANCH = "refactor/research-vnext-foundation-20260901";
const BASELINE_VERSION = "75f989b9-e798-4d32-a95f-7253b4e703ec";
const BASELINE_BINDING_FINGERPRINT = "d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b";
const WORKFLOW = ".github/workflows/research-vnext-atomic-production-one-shot.yml";
const AUTH = "runtime/research-vnext-atomic-production-one-shot-authorization.json";
const NOTE = "docs/change-notes/2026-09-02-research-vnext-atomic-production-one-shot.md";
const RESULT_NOTE = "docs/change-notes/2026-09-02-research-vnext-atomic-production-deploy-result.md";
const CLEANUP_NOTE = "docs/change-notes/2026-09-02-research-vnext-atomic-production-cleanup.md";
const CREDENTIAL_BLOCKED_DISPOSITION = "DEPLOYED_CONTROL_PLANE_PASS_AUTHENTICATED_PROBE_CREDENTIAL_BLOCKED_NO_ROLLBACK_TEMPORARY_SURFACES_CLEANED";

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");

const cleanupSeal = read("docs/change-notes/2026-09-01-research-vnext-production-control-plane-live-recapture-cleanup-seal.md");
assert.match(cleanupSeal, /PASS_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_COMPLETE_AND_TEMPORARY_BRIDGE_CLEANED_SEALED|Only after all three are `SUCCESS` may the phase disposition become/);
assert.equal(exists(".github/workflows/research-vnext-production-control-plane-one-shot-recapture.yml"), false);
assert.equal(exists("runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json"), false);

const blockedSkeleton = read(".github/workflows/research-vnext-atomic-production-execution.yml");
assert.match(blockedSkeleton, /BLOCKED_SKELETON/);
assert.match(blockedSkeleton, /ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION/);
assert.doesNotMatch(blockedSkeleton, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|RESEARCH_VNEXT_OAUTH_KV_ID/);
assert.doesNotMatch(blockedSkeleton, /\bwrangler\b|\bcurl\b|api\.cloudflare\.com/i);

const planner = read("scripts/research-vnext-atomic-deploy-plan.mjs");
assert.match(planner, /ATOMIC_IMMEDIATE_100_PERCENT/);
assert.match(planner, /resource_provisioning:\s*"DISABLED"/);
assert.match(planner, /trigger_mutation_intent:\s*"NONE"/);
assert.doesNotMatch(planner, /\bfetch\s*\(|api\.cloudflare\.com|child_process|exec\(|spawn\(/i);

const liveSnapshot = read("scripts/research-vnext-production-control-plane-live-snapshot.mjs");
assert.match(liveSnapshot, /method:\s*"GET"/);
assert.doesNotMatch(liveSnapshot, /method:\s*"(POST|PUT|PATCH|DELETE)"/i);
const snapshotBuilder = read("src/v6/research-vnext/production-control-plane-snapshot.ts");
assert.match(snapshotBuilder, /token_leak:\s*false/);

const probe = read("scripts/research-vnext-production-probe.mjs");
assert.match(probe, /READ_ONLY_PRODUCTION_PROBE/);
assert.match(probe, /production_mutation:\s*"NONE"/);

const note = read(NOTE);
assert.match(note, new RegExp(SOURCE_SHA));
assert.match(note, new RegExp(BASELINE_VERSION));
assert.match(note, new RegExp(BASELINE_BINDING_FINGERPRINT));
assert.match(note, /Research VNext Incremental Gate Run `33532739409`: `SUCCESS`/);
assert.match(note, /Type check Run `33532739410`: `SUCCESS`/);
assert.match(note, /Research VNext Isolation Gate Run `33532739330`: `SUCCESS`/);
assert.match(note, /Production deployment decision: `FAIL_CLOSED_AUTONOMOUS`/);

console.log("ATOMIC_PRODUCTION_ONE_SHOT_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_PRODUCTION_ONE_SHOT_RED_V1",
  status: "PASS",
  source_sha: SOURCE_SHA,
  expected_predeploy_version: BASELINE_VERSION,
  expected_binding_fingerprint: BASELINE_BINDING_FINGERPRINT,
  expected_cron: "*/5 * * * *",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  permanent_execution_skeleton: "BLOCKED_UNCHANGED",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

if (!exists(WORKFLOW)) {
  const fullyAuthenticatedPass = /PASS_ATOMIC_PRODUCTION_ONE_SHOT_DEPLOY_AND_CLEANUP_SEALED/.test(note);
  const resultNote = exists(RESULT_NOTE) ? read(RESULT_NOTE) : "";
  const cleanupNote = exists(CLEANUP_NOTE) ? read(CLEANUP_NOTE) : "";
  const credentialBlockedCleaned = new RegExp(CREDENTIAL_BLOCKED_DISPOSITION).test(cleanupNote);

  if (fullyAuthenticatedPass || credentialBlockedCleaned) {
    assert.equal(exists(AUTH), false, "authorization must be absent after sealed cleanup");

    if (credentialBlockedCleaned) {
      assert.match(resultNote, /POSTDEPLOY_AUTHENTICATED_MCP_PROBE_BLOCKED_BY_MISSING_GITHUB_SECRET/);
      assert.match(resultNote, /Decision: `NO_ROLLBACK`/);
      assert.match(resultNote, /0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c/);
      assert.match(cleanupNote, /Production control-plane validation: `PASS`/);
      assert.match(cleanupNote, /Authenticated MCP probe: `BLOCKED_BY_MISSING_GITHUB_SECRET`/);
      assert.match(cleanupNote, /Production rollback: `NONE`/);
      assert.match(cleanupNote, /Legacy retirement: `BLOCKED`/);
      assert.doesNotMatch(cleanupNote, /PASS_ATOMIC_PRODUCTION_ONE_SHOT_DEPLOY_AND_CLEANUP_SEALED/);
      console.log("ATOMIC_PRODUCTION_ONE_SHOT_POST_CLEANUP_CREDENTIAL_BLOCKED=PASS");
    } else {
      console.log("ATOMIC_PRODUCTION_ONE_SHOT_POST_CLEANUP=PASS");
    }
    process.exit(0);
  }

  assert.fail("temporary atomic Production one-shot workflow must exist only after accepted RED");
}

const workflow = read(WORKFLOW);
assert.match(workflow, /^name:\s*Research VNext Atomic Production One-Shot/m);
assert.match(workflow, /push:/);
assert.match(workflow, new RegExp(BRANCH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(workflow, new RegExp(AUTH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, new RegExp(SOURCE_SHA));
assert.match(workflow, new RegExp(BASELINE_VERSION));
assert.match(workflow, new RegExp(BASELINE_BINDING_FINGERPRINT));
assert.match(workflow, /EXECUTE_ATOMIC_VNEXT_PRODUCTION/);
assert.match(workflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
assert.match(workflow, /RESEARCH_VNEXT_PROBE_TOKEN:\s*\$\{\{\s*secrets\.RESEARCH_VNEXT_PROBE_TOKEN\s*\}\}/);
assert.match(workflow, /research-vnext-production-control-plane-live-snapshot\.mjs/);
assert.match(workflow, /research-vnext-atomic-deploy-plan\.mjs/);
assert.match(workflow, /wrangler deploy --dry-run --config wrangler\.research-vnext-atomic\.jsonc/);
assert.match(workflow, /wrangler deploy --config wrangler\.research-vnext-atomic\.jsonc/);
assert.match(workflow, /research-vnext-production-probe\.mjs/);
assert.doesNotMatch(workflow, /storage\/kv\/namespaces|schedules[^\n]*-X\s+PUT|-X\s+(POST|PUT|PATCH|DELETE)/i);

if (exists(AUTH)) {
  const auth = JSON.parse(read(AUTH));
  assert.equal(auth.schema, "RESEARCH_VNEXT_ATOMIC_PRODUCTION_ONE_SHOT_AUTH_V1");
  assert.equal(auth.confirmation, "EXECUTE_ATOMIC_VNEXT_PRODUCTION");
  assert.equal(auth.source_sha, SOURCE_SHA);
  assert.equal(auth.expected_predeploy_version_id, BASELINE_VERSION);
  assert.equal(auth.expected_binding_fingerprint, BASELINE_BINDING_FINGERPRINT);
  assert.equal(auth.expected_cron, "*/5 * * * *");
  assert.equal(auth.production_deploy_authorized, true);
  assert.equal(auth.allowed_mutation, "ATOMIC_WORKER_DEPLOY_ONLY");
}

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_PRODUCTION_ONE_SHOT_WORKFLOW_TEST_V1",
  status: "PASS",
  source_sha: SOURCE_SHA,
  predeploy_drift_policy: "FAIL_CLOSED_EXACT_BASELINE",
  resource_provisioning: "DISABLED",
  cron_mutation: "FORBIDDEN",
  automatic_rollback: false,
  authorization_present: exists(AUTH),
}, null, 2));
