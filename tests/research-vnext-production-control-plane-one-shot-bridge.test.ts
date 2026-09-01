import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(repoRoot, relative));

const SEALED_SOURCE_SHA = "9fa1499eeaeb2ccaa7e118502f8b618c76401a31";
const BRANCH = "refactor/research-vnext-foundation-20260901";
const AUTH_PATH = "runtime/research-vnext-production-control-plane-one-shot-authorization.json";
const BRIDGE_PATH = ".github/workflows/research-vnext-production-control-plane-one-shot.yml";
const CLEANUP_NOTE_PATH = "docs/change-notes/2026-09-01-research-vnext-production-control-plane-one-shot-cleanup.md";

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");

const liveNote = read("docs/change-notes/2026-09-01-research-vnext-production-control-plane-live-snapshot.md");
assert.match(liveNote, /PASS_PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_HARNESS_GET_ONLY_UNDISPATCHED_PRODUCTION_UNCHANGED/);
assert.match(liveNote, /Production deploy authorization: \*\*FALSE\*\*/);
assert.match(liveNote, /Production mutation: \*\*NONE\*\*/);

const canonical = read(".github/workflows/research-vnext-production-control-plane-live-snapshot.yml");
assert.match(canonical, /workflow_dispatch:/);
assert.doesNotMatch(canonical, /^\s*(push|pull_request|schedule):/m);
assert.match(canonical, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
assert.doesNotMatch(canonical, /-X\s+(POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(canonical, /wrangler\s+(deploy|rollback)/i);

console.log("PRODUCTION_CONTROL_PLANE_ONE_SHOT_BRIDGE_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_ONE_SHOT_BRIDGE_RED_V1",
  status: "PASS",
  canonical_manual_harness: "SEALED_UNCHANGED",
  sealed_source_sha: SEALED_SOURCE_SHA,
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

const bridgeExists = exists(BRIDGE_PATH);
const authExists = exists(AUTH_PATH);

// Post-live cleanup is a distinct lifecycle state. The temporary workflow and
// one-shot authorization are allowed to be absent only after immutable live
// evidence and the exact cleanup commits are documented and sealed.
if (!bridgeExists && !authExists) {
  assert.equal(exists(CLEANUP_NOTE_PATH), true, "post-cleanup Change Note must exist before cleanup can pass");
  const cleanupNote = read(CLEANUP_NOTE_PATH);

  console.log("PRODUCTION_CONTROL_PLANE_ONE_SHOT_CLEANUP_RED_READY=PASS");

  assert.match(cleanupNote, /Live snapshot run: `33527987699`/);
  assert.match(cleanupNote, /Live snapshot job: `99923622130`/);
  assert.match(cleanupNote, /Artifact ID: `9808495101`/);
  assert.match(cleanupNote, /Artifact digest: `sha256:f38b86c862b1bce5d2c0d06a94b7d2ebf7ed0c29caa9cfa39102ad35c304e000`/);
  assert.match(cleanupNote, /Snapshot status: `READ_ONLY_SNAPSHOT_VALID`/);
  assert.match(cleanupNote, /Active deployment ID: `8e4b3922-e96b-4e2b-b365-65e2e9f71968`/);
  assert.match(cleanupNote, /Active version ID: `75f989b9-e798-4d32-a95f-7253b4e703ec`/);
  assert.match(cleanupNote, /Rollback target version ID: `75f989b9-e798-4d32-a95f-7253b4e703ec`/);
  assert.match(cleanupNote, /Binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`/);
  assert.match(cleanupNote, /Temporary workflow cleanup commit: `98eb80511bb0fd72a4cd73d234307ffef12f7ff5`/);
  assert.match(cleanupNote, /Authorization cleanup commit: `0944ba36e1dd6366bc0faea542837d958ee8c6c1`/);
  assert.match(cleanupNote, /Production deploy authorized: `false`/);
  assert.match(cleanupNote, /Production mutation: `NONE`/);
  assert.match(
    cleanupNote,
    /PASS_PRODUCTION_CONTROL_PLANE_ONE_SHOT_LIVE_SNAPSHOT_CAPTURED_AND_TEMPORARY_BRIDGE_CLEANED_PRODUCTION_UNCHANGED/,
    "cleanup evidence disposition must be sealed only after accepted RED",
  );

  console.log(JSON.stringify({
    schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_ONE_SHOT_CLEANUP_TEST_V1",
    status: "PASS",
    live_snapshot: "READ_ONLY_SNAPSHOT_VALID",
    temporary_bridge: "REMOVED",
    authorization: "REMOVED",
    source_execution: "PINNED_SEALED_SHA",
    owner_tool_count: fixture.owner_tool_count,
    owner_abi_sha256: fixture.owner_abi_sha256,
    production_deploy_authorized: false,
    production_mutation: "NONE",
  }, null, 2));
  process.exit(0);
}

// TEST BEFORE BUILD: first formal RED stopped here because the temporary
// connector-compat one-shot bridge did not exist yet. While the bridge is in
// its pre-cleanup lifecycle, preserve every original fail-closed assertion.
assert.equal(bridgeExists, true, "temporary one-shot GET-only bridge workflow must exist only after accepted RED");

const workflow = read(BRIDGE_PATH);
assert.match(workflow, /push:/);
assert.match(workflow, new RegExp(BRANCH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(workflow, new RegExp(AUTH_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(workflow, /workflow_dispatch:/, "temporary bridge must not shadow the canonical manual workflow");
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, new RegExp(SEALED_SOURCE_SHA));
assert.match(workflow, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
assert.match(workflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
assert.match(workflow, /path:\s*sealed/);
assert.match(workflow, /sealed\/scripts\/research-vnext-production-control-plane-live-snapshot\.mjs/);
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.doesNotMatch(workflow, /api\.cloudflare\.com/i, "Cloudflare endpoint construction stays inside the already sealed GET-only client");
assert.doesNotMatch(workflow, /curl\b|\bgh\s|wrangler\s+(deploy|rollback)|-X\s+(POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(workflow, /deploy-cloudflare-production\.yml|research-vnext-atomic-production-execution\.yml/);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_ONE_SHOT_BRIDGE_TEST_V1",
  status: "PASS",
  trigger_scope: "EXACT_BRANCH_PLUS_AUTHORIZATION_PATH",
  source_execution: "PINNED_SEALED_SHA",
  cloudflare_method_surface: "SEALED_CLIENT_GET_ONLY",
  canonical_manual_harness: "UNCHANGED",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));
