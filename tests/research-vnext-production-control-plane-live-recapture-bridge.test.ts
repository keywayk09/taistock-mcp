import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(repoRoot, relative));

const SEALED_SOURCE_SHA = "bc77effcee66c773fc529df864b1acd33641107f";
const BRANCH = "refactor/research-vnext-foundation-20260901";
const OLD_BRIDGE = ".github/workflows/research-vnext-production-control-plane-one-shot.yml";
const OLD_AUTH = "runtime/research-vnext-production-control-plane-one-shot-authorization.json";
const RECAPTURE_BRIDGE = ".github/workflows/research-vnext-production-control-plane-one-shot-recapture.yml";
const RECAPTURE_AUTH = "runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json";
const RECAPTURE_NOTE = "docs/change-notes/2026-09-01-research-vnext-production-control-plane-live-recapture.md";

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");

assert.equal(exists(OLD_BRIDGE), false, "first temporary bridge must remain cleaned");
assert.equal(exists(OLD_AUTH), false, "first one-shot authorization must remain cleaned");
assert.equal(exists(RECAPTURE_AUTH), false, "recapture authorization must not exist before bridge GREEN + seal");

const completeness = read("src/v6/research-vnext/production-control-plane-snapshot.ts");
assert.match(completeness, /token_leak:\s*false/);

const canonical = read(".github/workflows/research-vnext-production-control-plane-live-snapshot.yml");
assert.match(canonical, /workflow_dispatch:/);
assert.doesNotMatch(canonical, /^\s*(push|pull_request|schedule):/m);
assert.match(canonical, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
assert.doesNotMatch(canonical, /-X\s+(POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(canonical, /wrangler\s+(deploy|rollback)/i);

const liveScript = read("scripts/research-vnext-production-control-plane-live-snapshot.mjs");
assert.match(liveScript, /method:\s*"GET"/);
assert.doesNotMatch(liveScript, /method:\s*"(POST|PUT|PATCH|DELETE)"/i);
assert.doesNotMatch(liveScript, /wrangler\s+(deploy|rollback)/i);

const note = read(RECAPTURE_NOTE);
assert.match(note, new RegExp(SEALED_SOURCE_SHA));
assert.match(note, /Research VNext Incremental Gate Run `33530324815`: `SUCCESS`/);
assert.match(note, /Type check Run `33530324826`: `SUCCESS`/);
assert.match(note, /Research VNext Isolation Gate Run `33530324829`: `SUCCESS`/);
assert.match(note, /Production deploy authorized: `false`/);
assert.match(note, /Production mutation: `NONE`/);

console.log("PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_V1",
  status: "PASS",
  first_temporary_bridge: "CLEANED",
  corrected_sealed_source_sha: SEALED_SOURCE_SHA,
  corrected_receipt_contract: "TOKEN_LEAK_FALSE_PRESENT",
  canonical_manual_harness: "WORKFLOW_DISPATCH_ONLY_UNCHANGED",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after all prior safety/evidence preconditions pass may
// the formal RED stop because the second, distinct connector-compatible bridge
// has not been implemented yet.
assert.equal(
  exists(RECAPTURE_BRIDGE),
  true,
  "temporary one-shot recapture GET-only bridge must exist only after accepted RED",
);

// These assertions are unreachable in the accepted RED and define the future
// GREEN contract once the recapture bridge is implemented.
const workflow = read(RECAPTURE_BRIDGE);
assert.match(workflow, /push:/);
assert.match(workflow, new RegExp(BRANCH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(workflow, new RegExp(RECAPTURE_AUTH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, new RegExp(SEALED_SOURCE_SHA));
assert.match(workflow, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
assert.match(workflow, /path:\s*sealed/);
assert.match(workflow, /sealed\/scripts\/research-vnext-production-control-plane-live-snapshot\.mjs/);
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.match(workflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
assert.doesNotMatch(workflow, /curl\b|\bgh\s|wrangler\s+(deploy|rollback)|-X\s+(POST|PUT|PATCH|DELETE)/i);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_TEST_V1",
  status: "PASS",
  trigger_scope: "EXACT_BRANCH_PLUS_RECAPTURE_AUTHORIZATION_PATH",
  source_execution: "PINNED_CORRECTED_SEALED_SHA",
  cloudflare_method_surface: "SEALED_CLIENT_GET_ONLY",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));
