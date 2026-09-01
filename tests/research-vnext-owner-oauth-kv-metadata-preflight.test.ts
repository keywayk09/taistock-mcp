import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(repoRoot, relative));

const SEALED_HEAD = "ca89b77a06b79a09df3ade88a18e7225b53b2093";
const ACTIVE_VERSION = "0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c";
const OAUTH_KV_ID = "696e3654d2fa4c3bb1a868e5095b5660";
const BINDING_FINGERPRINT = "d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b";
const WORKFLOW = ".github/workflows/research-vnext-owner-oauth-kv-metadata-preflight.yml";
const AUTH = "runtime/research-vnext-owner-oauth-kv-metadata-preflight-authorization.json";
const NOTE = "docs/change-notes/2026-09-02-research-vnext-owner-oauth-kv-metadata-preflight.md";

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");

const cleanup = read("docs/change-notes/2026-09-02-research-vnext-atomic-production-cleanup.md");
assert.match(cleanup, /SEALED_DEPLOYED_CONTROL_PLANE_PASS_AUTHENTICATED_PROBE_CREDENTIAL_BLOCKED_NO_ROLLBACK_TEMPORARY_SURFACES_CLEANED/);
assert.match(cleanup, /Research VNext Incremental Gate Run `33537703573`|Only after all three are `SUCCESS` is the cleanup lifecycle sealed as/);
assert.match(cleanup, new RegExp(ACTIVE_VERSION));
assert.match(cleanup, /Authenticated MCP probe: `BLOCKED_BY_MISSING_GITHUB_SECRET`/);
assert.match(cleanup, /Legacy retirement: `BLOCKED`/);

assert.equal(exists(".github/workflows/research-vnext-atomic-production-one-shot.yml"), false);
assert.equal(exists("runtime/research-vnext-atomic-production-one-shot-authorization.json"), false);

const note = read(NOTE);
assert.match(note, new RegExp(SEALED_HEAD));
assert.match(note, new RegExp(ACTIVE_VERSION));
assert.match(note, new RegExp(OAUTH_KV_ID));
assert.match(note, new RegExp(BINDING_FINGERPRINT));
assert.match(note, /raw KV key names are never logged or emitted/);
assert.match(note, /raw KV values are never logged or emitted/);
assert.match(note, /token_leak=false/);
assert.match(note, /production_mutation=NONE/);
assert.match(note, /Legacy retirement/);

const snapshot = read("scripts/research-vnext-production-control-plane-live-snapshot.mjs");
assert.match(snapshot, /method:\s*"GET"/);
assert.doesNotMatch(snapshot, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/i);
const builder = read("src/v6/research-vnext/production-control-plane-snapshot.ts");
assert.match(builder, /token_leak:\s*false/);

console.log("OWNER_OAUTH_KV_METADATA_PREFLIGHT_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_OWNER_OAUTH_KV_METADATA_PREFLIGHT_RED_V1",
  status: "PASS",
  sealed_head: SEALED_HEAD,
  expected_active_version: ACTIVE_VERSION,
  expected_oauth_kv_id: OAUTH_KV_ID,
  expected_binding_fingerprint: BINDING_FINGERPRINT,
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  temporary_workflow: exists(WORKFLOW) ? "PRESENT" : "ABSENT",
  temporary_authorization: exists(AUTH) ? "PRESENT" : "ABSENT",
  token_leak: false,
  production_mutation: "NONE",
}, null, 2));

if (!exists(WORKFLOW)) {
  assert.equal(exists(AUTH), false, "authorization must not exist before metadata-preflight workflow GREEN");
  assert.fail("temporary Owner OAuth KV metadata preflight workflow must exist only after accepted RED");
}

const workflow = read(WORKFLOW);
assert.match(workflow, /^name:\s*Research VNext Owner OAuth KV Metadata Preflight/m);
assert.match(workflow, /push:/);
assert.match(workflow, /refactor\/research-vnext-foundation-20260901/);
assert.match(workflow, /runtime\/research-vnext-owner-oauth-kv-metadata-preflight-authorization\.json/);
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, new RegExp(SEALED_HEAD));
assert.match(workflow, new RegExp(ACTIVE_VERSION));
assert.match(workflow, new RegExp(OAUTH_KV_ID));
assert.match(workflow, new RegExp(BINDING_FINGERPRINT));
assert.match(workflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
assert.match(workflow, /research-vnext-production-control-plane-live-snapshot\.mjs/);
assert.match(workflow, /storage\/kv\/namespaces/);
assert.match(workflow, /method:\s*['"]GET['"]/);
assert.doesNotMatch(workflow, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
assert.doesNotMatch(workflow, /\bwrangler\s+deploy\b|\bwrangler\s+rollback\b|-X\s+(?:POST|PUT|PATCH|DELETE)/i);
assert.match(workflow, /createHash\(['"]sha256['"]\)/);
assert.match(workflow, /token_leak:\s*false/);
assert.match(workflow, /production_mutation:\s*['"]NONE['"]/);
assert.match(workflow, /owner:full/);
assert.match(workflow, /role/);
assert.match(workflow, /userId/);

if (exists(AUTH)) {
  const auth = JSON.parse(read(AUTH));
  assert.equal(auth.schema, "RESEARCH_VNEXT_OWNER_OAUTH_KV_METADATA_PREFLIGHT_AUTH_V1");
  assert.equal(auth.mode, "GET_ONLY_OAUTH_KV_METADATA");
  assert.equal(auth.source_sha, SEALED_HEAD);
  assert.equal(auth.expected_active_version_id, ACTIVE_VERSION);
  assert.equal(auth.expected_oauth_kv_id, OAUTH_KV_ID);
  assert.equal(auth.expected_binding_fingerprint, BINDING_FINGERPRINT);
  assert.equal(auth.production_mutation, "NONE");
}

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_OWNER_OAUTH_KV_METADATA_PREFLIGHT_WORKFLOW_TEST_V1",
  status: "PASS",
  token_leak: false,
  production_mutation: "NONE",
  authorization_present: exists(AUTH),
}, null, 2));
