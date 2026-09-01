import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(repoRoot, relative));

const RESULT_NOTE = "docs/change-notes/2026-09-02-research-vnext-atomic-production-deploy-result.md";
const CLEANUP_NOTE = "docs/change-notes/2026-09-02-research-vnext-atomic-production-cleanup.md";
const WORKFLOW = ".github/workflows/research-vnext-atomic-production-one-shot.yml";
const AUTH = "runtime/research-vnext-atomic-production-one-shot-authorization.json";
const FINAL_DISPOSITION = "DEPLOYED_CONTROL_PLANE_PASS_AUTHENTICATED_PROBE_CREDENTIAL_BLOCKED_NO_ROLLBACK_TEMPORARY_SURFACES_CLEANED";

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");

assert.equal(exists(WORKFLOW), false, "temporary Production one-shot workflow must be absent after cleanup");
assert.equal(exists(AUTH), false, "temporary Production authorization must be absent after cleanup");

const result = read(RESULT_NOTE);
assert.match(result, /One-shot run: `33534878858`/);
assert.match(result, /Immutable artifact: `9811214109`/);
assert.match(result, /sha256:3ca25cf38fab2e1520e0a5a25688a4c2068aa67c0c670610f0628f7f0b35c8e2/);
assert.match(result, /75f989b9-e798-4d32-a95f-7253b4e703ec/);
assert.match(result, /0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c/);
assert.match(result, /POSTDEPLOY_AUTHENTICATED_MCP_PROBE_BLOCKED_BY_MISSING_GITHUB_SECRET/);
assert.match(result, /Decision: `NO_ROLLBACK`/);
assert.match(result, /protocol_negotiation_failed:modern=http_401:;legacy=http_401:/);
assert.match(result, /full binding fingerprint unchanged: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`/);

const cleanup = read(CLEANUP_NOTE);
assert.match(cleanup, /Workflow cleanup commit: `1845c557bd21d67c5beff4cd04e6d472b1f9a5a9`/);
assert.match(cleanup, /Authorization cleanup commit: `70073b0da92d33a5b742e85a884ac520ba7fadab`/);
assert.match(cleanup, /Production rollback: `NONE`/);
assert.match(cleanup, /Legacy retirement: `BLOCKED`/);
assert.match(cleanup, /Authenticated MCP probe: `BLOCKED_BY_MISSING_GITHUB_SECRET`/);

console.log("ATOMIC_PRODUCTION_ONE_SHOT_CLEANUP_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ATOMIC_PRODUCTION_ONE_SHOT_CLEANUP_RED_V1",
  status: "PASS",
  deployed_version_id: "0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c",
  control_plane: "PASS",
  authenticated_mcp_probe: "BLOCKED_BY_MISSING_GITHUB_SECRET",
  rollback: "NONE",
  workflow: "ABSENT",
  authorization: "ABSENT",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
}, null, 2));

assert.match(
  cleanup,
  new RegExp(FINAL_DISPOSITION),
  "credential-blocked cleanup disposition must be recorded only after accepted cleanup RED",
);
