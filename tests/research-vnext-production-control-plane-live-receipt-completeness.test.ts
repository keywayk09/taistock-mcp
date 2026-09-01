import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { collectProductionControlPlaneSnapshot } from "../scripts/research-vnext-production-control-plane-live-snapshot.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const exists = (relative: string) => fs.existsSync(path.join(repoRoot, relative));
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const BRIDGE_PATH = ".github/workflows/research-vnext-production-control-plane-one-shot.yml";
const AUTH_PATH = "runtime/research-vnext-production-control-plane-one-shot-authorization.json";
const CLEANUP_NOTE = "docs/change-notes/2026-09-01-research-vnext-production-control-plane-one-shot-cleanup.md";
const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));

assert.equal(fixture.owner_tool_count, 123);
assert.equal(fixture.owner_abi_sha256, "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d");
assert.equal(exists(BRIDGE_PATH), false, "temporary one-shot bridge must remain cleaned before receipt-completeness work");
assert.equal(exists(AUTH_PATH), false, "one-shot authorization must remain cleaned before receipt-completeness work");

const cleanupNote = read(CLEANUP_NOTE);
assert.match(cleanupNote, /Research VNext Incremental Gate Run `33528997296`: `SUCCESS`/);
assert.match(cleanupNote, /Type check Run `33528997181`: `SUCCESS`/);
assert.match(cleanupNote, /Research VNext Isolation Gate Run `33528997209`: `SUCCESS`/);
assert.match(cleanupNote, /Production deploy authorized: `false`/);
assert.match(cleanupNote, /Production mutation: `NONE`/);

const apiToken = "vnext-token-leak-sentinel-20260901-do-not-serialize";
const accountId = "0123456789abcdef0123456789abcdef";
const expectedSha = "9fa1499eeaeb2ccaa7e118502f8b618c76401a31";
const deploymentId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const oauthKvId = "abcdefabcdefabcdefabcdefabcdefab";
const calls: Array<{ url: string; method: string; authorization: string }> = [];

const fetchImpl = async (url: string, init: any = {}) => {
  calls.push({
    url: String(url),
    method: String(init?.method ?? ""),
    authorization: String(init?.headers?.Authorization ?? ""),
  });

  const result = String(url).endsWith("/deployments")
    ? { deployments: [{ id: deploymentId, versions: [{ version_id: versionId, percentage: 100 }] }] }
    : String(url).endsWith("/schedules")
      ? { schedules: [{ cron: "*/5 * * * *" }] }
      : {
          bindings: [
            { name: "OAUTH_KV", type: "kv_namespace", namespace_id: oauthKvId },
            { name: "MCP_OBJECT", type: "durable_object_namespace", class_name: "MyMCP" },
            { name: "FAMILY_MCP_OBJECT", type: "durable_object_namespace", class_name: "FamilyMCP" },
          ],
        };

  return {
    ok: true,
    status: 200,
    async json() {
      return { success: true, result };
    },
  } as any;
};

const receipt: any = await collectProductionControlPlaneSnapshot({
  accountId,
  apiToken,
  expectedSha,
  fetchImpl,
});

assert.equal(calls.length, 3);
for (const call of calls) {
  assert.equal(call.method, "GET");
  assert.equal(call.authorization, `Bearer ${apiToken}`);
}

const serialized = JSON.stringify(receipt);
assert.equal(serialized.includes(apiToken), false, "receipt must never serialize the Cloudflare API token");
assert.equal(receipt.production_deploy_authorized, false);
assert.equal(receipt.production_mutation, "NONE");

console.log("PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_RED_V1",
  status: "PASS",
  mock_get_calls: calls.length,
  serialized_token_present: serialized.includes(apiToken),
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: the prior live attempt proved the receipt does not serialize
// the token, but the frozen live-receipt contract also requires explicit evidence.
assert.equal(receipt.token_leak, false, "live receipt must explicitly emit token_leak=false");
