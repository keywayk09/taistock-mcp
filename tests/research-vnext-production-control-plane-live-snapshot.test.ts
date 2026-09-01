import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const snapshotNote = read("docs/change-notes/2026-09-01-research-vnext-production-control-plane-snapshot.md");
assert.match(
  snapshotNote,
  /PASS_PRODUCTION_CONTROL_PLANE_SNAPSHOT_CORE_READ_ONLY_PRODUCTION_UNCHANGED/,
);

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(
  fixture.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
);

const blockedExecution = read(".github/workflows/research-vnext-atomic-production-execution.yml");
assert.match(blockedExecution, /ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION/);
assert.match(blockedExecution, /production_deploy_authorized=false/);
assert.match(blockedExecution, /production_mutation=NONE/);
assert.doesNotMatch(blockedExecution, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|\bwrangler\b|\bcurl\b|api\.cloudflare\.com/i);

console.log("PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  snapshot_core: "SEALED",
  blocked_execution_workflow: "SEALED",
  live_capture_mode: "GET_ONLY_MANUAL_NOT_EXECUTED",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: only after all safety premises above pass once in CI may
// the GET-only client and manual workflow be added atomically.
const live = await import("../scripts/research-vnext-production-control-plane-live-snapshot.mjs");

assert.equal(
  live.RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_VERSION,
  "research-vnext-production-control-plane-live-snapshot/v1.0.0",
);
assert.equal(typeof live.collectProductionControlPlaneSnapshot, "function");

const accountId = "0123456789abcdef0123456789abcdef";
const apiToken = "test-read-only-cloudflare-token";
const sourceSha = "1234567890abcdef1234567890abcdef12345678";
const deploymentId = "11111111-2222-4333-8444-555555555555";
const versionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const oauthKvId = "fedcba9876543210fedcba9876543210";

const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
const mockFetch = async (url: string | URL, init: RequestInit = {}) => {
  const href = String(url);
  requests.push({
    url: href,
    method: String(init.method ?? "GET").toUpperCase(),
    authorization: new Headers(init.headers).get("authorization"),
  });

  let body: unknown;
  if (href.endsWith("/deployments")) {
    body = {
      success: true,
      result: {
        deployments: [
          {
            id: deploymentId,
            created_on: "2026-09-01T12:00:00Z",
            source: "wrangler",
            strategy: "percentage",
            versions: [{ version_id: versionId, percentage: 100 }],
          },
        ],
      },
    };
  } else if (href.endsWith("/schedules")) {
    body = { success: true, result: { schedules: [{ cron: "*/5 * * * *" }] } };
  } else if (href.endsWith("/settings")) {
    body = {
      success: true,
      result: {
        bindings: [
          { name: "OAUTH_KV", type: "kv_namespace", namespace_id: oauthKvId },
          { name: "MCP_OBJECT", type: "durable_object_namespace", class_name: "MyMCP" },
          { name: "FAMILY_MCP_OBJECT", type: "durable_object_namespace", class_name: "FamilyMCP" },
          { name: "GITHUB_OWNER", type: "plain_text", text: "keywayk09" },
        ],
      },
    };
  } else {
    return new Response(JSON.stringify({ success: false, errors: [{ message: "unexpected path" }] }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const receipt = await live.collectProductionControlPlaneSnapshot({
  accountId,
  apiToken,
  expectedSha: sourceSha,
  fetchImpl: mockFetch,
});
assert.equal(receipt.schema, "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_V1");
assert.equal(receipt.status, "READ_ONLY_SNAPSHOT_VALID");
assert.equal(receipt.active_deployment_id, deploymentId);
assert.equal(receipt.active_version_id, versionId);
assert.equal(receipt.active_version_percentage, 100);
assert.deepEqual(receipt.cron_schedules, ["*/5 * * * *"]);
assert.equal(receipt.oauth_kv_id, oauthKvId);
assert.deepEqual(receipt.protected_exports, ["MyMCP", "FamilyMCP"]);
assert.deepEqual(receipt.durable_object_bindings, [
  { name: "MCP_OBJECT", className: "MyMCP" },
  { name: "FAMILY_MCP_OBJECT", className: "FamilyMCP" },
]);
assert.equal(receipt.rollback_target_version_id, versionId);
assert.match(receipt.binding_fingerprint, /^[0-9a-f]{64}$/);
assert.equal(receipt.production_deploy_authorized, false);
assert.equal(receipt.production_mutation, "NONE");
assert.equal(JSON.stringify(receipt).includes(apiToken), false, "receipt must never leak API token");

assert.equal(requests.length, 3);
for (const request of requests) {
  assert.equal(request.method, "GET", `only GET is allowed: ${request.url}`);
  assert.equal(request.authorization, `Bearer ${apiToken}`);
  assert.match(request.url, new RegExp(`/accounts/${accountId}/workers/scripts/taistock-mcp/(deployments|schedules|settings)$`));
}

await assert.rejects(
  () => live.collectProductionControlPlaneSnapshot({
    accountId,
    apiToken,
    expectedSha: sourceSha,
    fetchImpl: async () => new Response(JSON.stringify({ success: false, errors: [{ message: "denied" }] }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  }),
  /403|denied|cloudflare/i,
);

const clientSource = read("scripts/research-vnext-production-control-plane-live-snapshot.mjs");
assert.match(clientSource, /api\.cloudflare\.com\/client\/v4/);
assert.match(clientSource, /method:\s*["']GET["']/);
assert.doesNotMatch(clientSource, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
assert.doesNotMatch(clientSource, /child_process|exec\(|spawn\(|\bwrangler\b|\bcurl\b/i);
assert.doesNotMatch(clientSource, /workers\.dev|\/my-mcp|\/health/i);

const workflow = read(".github/workflows/research-vnext-production-control-plane-live-snapshot.yml");
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m, "live snapshot workflow must be manual-only");
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
assert.match(workflow, /research-vnext-production-control-plane-live-snapshot\.mjs/);
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.doesNotMatch(workflow, /\bwrangler\b|\bcurl\b/i);
assert.doesNotMatch(workflow, /-X\s+(?:POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(workflow, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
assert.doesNotMatch(workflow, /workers\.dev|\/my-mcp|\/health/i);
assert.doesNotMatch(workflow, /deploy-cloudflare-production\.yml|research-vnext-atomic-production-execution\.yml/);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_TEST_V1",
  status: "PASS",
  mock_get_calls: requests.length,
  deployment_shape: "PASS",
  schedules_shape: "PASS",
  settings_bindings_shape: "PASS",
  token_leak: false,
  workflow_mode: "MANUAL_GET_ONLY",
  live_dispatch_executed: false,
  production_mutation: "NONE",
}, null, 2));
