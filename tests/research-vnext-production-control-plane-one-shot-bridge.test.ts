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

// TEST BEFORE BUILD: first formal RED must stop here because the temporary
// connector-compat one-shot bridge does not exist yet.
assert.equal(exists(BRIDGE_PATH), true, "temporary one-shot GET-only bridge workflow must exist only after accepted RED");

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
