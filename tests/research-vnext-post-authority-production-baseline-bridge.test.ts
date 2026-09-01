import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(root, p));

const SOURCE = "6dc5beb02c168ad6c7c74c314fc9cf704253391a";
const NOTE = "docs/change-notes/2026-09-02-research-vnext-post-authority-production-baseline.md";
const WORKFLOW = ".github/workflows/research-vnext-post-authority-production-baseline.yml";
const AUTH = "runtime/research-vnext-post-authority-production-baseline-authorization.json";
const CLEANED = "POST_AUTHORITY_PRODUCTION_BASELINE_COMPLETED_READ_ONLY_TEMPORARY_SURFACES_CLEANED";

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");

const note = read(NOTE);
assert.match(note, new RegExp(SOURCE));
assert.match(note, /PR #207 merged as main commit `9e642058f44e2a57738709bbcb335c51256012ca`/);
assert.match(note, /canonical main Production deploy Run `33541960849`: `SUCCESS`/);
assert.match(note, /02def751-acf1-4e18-baca-cd19cdca361e/);
assert.match(note, /OAuth KV remained `696e3654d2fa4c3bb1a868e5095b5660`/);
assert.match(note, /artifact ID `9813955544`/);
assert.match(note, /sha256:939c565b57e13770c635d1ae2e15345ededa15cac50d072ead86358396fac074/);
assert.match(note, /main commit `2ff6ef09addf2e81b2015c355515c75a08938375`/);
assert.match(note, /expires `2026-09-01T23:40:00Z`/);
assert.match(note, /production_deploy_authorized=false/);
assert.match(note, /production_mutation=NONE/);

const snapshot = read("scripts/research-vnext-production-control-plane-live-snapshot.mjs");
assert.match(snapshot, /method:\s*"GET"/);
assert.doesNotMatch(snapshot, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/i);
const builder = read("src/v6/research-vnext/production-control-plane-snapshot.ts");
assert.match(builder, /token_leak:\s*false/);

console.log("POST_AUTHORITY_PRODUCTION_BASELINE_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_POST_AUTHORITY_PRODUCTION_BASELINE_RED_V1",
  status: "PASS",
  source_sha: SOURCE,
  canonical_main_version: "02def751-acf1-4e18-baca-cd19cdca361e",
  authority_lease_main_commit: "2ff6ef09addf2e81b2015c355515c75a08938375",
  temporary_workflow: exists(WORKFLOW) ? "PRESENT" : "ABSENT",
  temporary_authorization: exists(AUTH) ? "PRESENT" : "ABSENT",
  owner_tool_count: fixture.owner_tool_count,
  token_leak: false,
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

if (!exists(WORKFLOW)) {
  // RED remains immutable, but after the one-time live capture the correct
  // terminal state is that both temporary surfaces are absent. Accept that
  // state only when the immutable live evidence and cleanup disposition are
  // explicitly recorded in the Change Note.
  assert.equal(exists(AUTH), false, "authorization must be absent after temporary workflow cleanup");
  assert.match(note, /live GET-only baseline Run `33548350116`: `SUCCESS`/);
  assert.match(note, /live evidence artifact ID `9816384247`/);
  assert.match(note, /sha256:09988733fdcb120674f76fc9c1d8db218cf4110ef9d44e60ed9a40cff5ae6135/);
  assert.match(note, /72cb66b1-ea3d-4eea-bb70-21c0fe40ef4f/);
  assert.match(note, /d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b/);
  assert.match(note, /workflow removed first at cleanup commit `47fea3a1\.\.\.`/);
  assert.match(note, /authorization removed second at cleanup commit `d873ac51650737ece6b24b2101430697ed5d58ec`/);
  assert.match(note, new RegExp(CLEANED));
  console.log("POST_AUTHORITY_PRODUCTION_BASELINE_CLEANUP_GREEN=PASS");
} else {
  const workflow = read(WORKFLOW);
  assert.match(workflow, /^name:\s*Research VNext Post-Authority Production Baseline/m);
  assert.match(workflow, /push:/);
  assert.match(workflow, /refactor\/research-vnext-foundation-20260901/);
  assert.match(workflow, /runtime\/research-vnext-post-authority-production-baseline-authorization\.json/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /RESEARCH_VNEXT_POST_AUTHORITY_BASELINE_AUTH_V1/);
  assert.match(workflow, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
  assert.match(workflow, new RegExp(SOURCE));
  assert.match(workflow, /production_deploy_authorized/);
  assert.match(workflow, /production_mutation/);
  assert.match(workflow, /research-vnext-production-control-plane-live-snapshot\.mjs/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
  assert.doesNotMatch(workflow, /\bwrangler\s+(?:deploy|rollback)\b|-X\s+(?:POST|PUT|PATCH|DELETE)/i);
  assert.match(workflow, /actions\/upload-artifact@v4/);

  if (exists(AUTH)) {
    const auth = JSON.parse(read(AUTH));
    assert.equal(auth.schema, "RESEARCH_VNEXT_POST_AUTHORITY_BASELINE_AUTH_V1");
    assert.equal(auth.mode, "READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT");
    assert.equal(auth.source_sha, SOURCE);
    assert.equal(auth.production_deploy_authorized, false);
    assert.equal(auth.production_mutation, "NONE");
  }

  console.log("POST_AUTHORITY_PRODUCTION_BASELINE_BRIDGE_GREEN=PASS");
}
