import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProductionControlPlaneSnapshot } from "../src/v6/research-vnext/production-control-plane-snapshot.ts";

export const RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_VERSION =
  "research-vnext-production-control-plane-live-snapshot/v1.0.0";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const WORKER_NAME = "taistock-mcp";
const HEX32 = /^[0-9a-f]{32}$/;
const HEX40 = /^[0-9a-f]{40}$/;

function fail(reason) {
  throw new Error(`production_control_plane_live_snapshot_failed:${reason}`);
}

function safeCloudflareError(payload, status) {
  const messages = Array.isArray(payload?.errors)
    ? payload.errors.map((row) => String(row?.message ?? "").trim()).filter(Boolean)
    : [];
  const suffix = messages.length ? `:${messages.join("|")}` : "";
  return `cloudflare_http_${status}${suffix}`;
}

function normalizeBindingMetadata(binding) {
  const row = {
    name: String(binding?.name ?? ""),
    type: String(binding?.type ?? ""),
  };
  for (const key of [
    "namespace_id",
    "class_name",
    "script_name",
    "bucket_name",
    "database_id",
    "service",
    "environment",
    "queue_name",
    "dataset",
  ]) {
    const value = binding?.[key];
    if (value !== undefined && value !== null && String(value) !== "") row[key] = String(value);
  }
  return row;
}

function bindingFingerprint(bindings) {
  const normalized = bindings
    .map(normalizeBindingMetadata)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function parseCloudflareResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail(`cloudflare_http_${response.status}:invalid_json`);
  }
  if (!response.ok || payload?.success === false) {
    fail(safeCloudflareError(payload, response.status));
  }
  return payload?.result;
}

export async function collectProductionControlPlaneSnapshot({
  accountId,
  apiToken,
  expectedSha,
  fetchImpl = globalThis.fetch,
}) {
  const normalizedAccountId = String(accountId ?? "").trim().toLowerCase();
  const token = String(apiToken ?? "").trim();
  const sourceSha = String(expectedSha ?? "").trim().toLowerCase();

  if (!HEX32.test(normalizedAccountId)) fail("account_id_must_be_32_hex");
  if (!token) fail("api_token_required");
  if (!HEX40.test(sourceSha)) fail("expected_sha_must_be_40_hex");
  if (typeof fetchImpl !== "function") fail("fetch_impl_required");

  const base = `${API_ROOT}/accounts/${normalizedAccountId}/workers/scripts/${WORKER_NAME}`;
  const cloudflareGet = async (suffix) => {
    const response = await fetchImpl(`${base}/${suffix}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    return parseCloudflareResponse(response);
  };

  const [deploymentsResult, schedulesResult, settingsResult] = await Promise.all([
    cloudflareGet("deployments"),
    cloudflareGet("schedules"),
    cloudflareGet("settings"),
  ]);

  const deployments = Array.isArray(deploymentsResult?.deployments)
    ? deploymentsResult.deployments
    : Array.isArray(deploymentsResult)
      ? deploymentsResult
      : [];
  if (deployments.length === 0) fail("active_deployment_missing");

  const activeDeployment = deployments[0];
  const versions = Array.isArray(activeDeployment?.versions) ? activeDeployment.versions : [];
  if (versions.length !== 1 || Number(versions[0]?.percentage) !== 100) {
    fail("active_deployment_must_have_exactly_one_100_percent_version");
  }

  const schedules = Array.isArray(schedulesResult?.schedules)
    ? schedulesResult.schedules
    : Array.isArray(schedulesResult)
      ? schedulesResult
      : [];
  const cronSchedules = schedules.map((row) => String(row?.cron ?? ""));

  const bindings = Array.isArray(settingsResult?.bindings) ? settingsResult.bindings : [];
  if (bindings.length === 0) fail("settings_bindings_missing");

  const oauthKv = bindings.find(
    (row) => row?.name === "OAUTH_KV" && row?.type === "kv_namespace" && row?.namespace_id,
  );
  if (!oauthKv) fail("oauth_kv_binding_missing");

  const mcpBinding = bindings.find(
    (row) => row?.name === "MCP_OBJECT" && row?.type === "durable_object_namespace" && row?.class_name === "MyMCP",
  );
  const familyBinding = bindings.find(
    (row) => row?.name === "FAMILY_MCP_OBJECT" && row?.type === "durable_object_namespace" && row?.class_name === "FamilyMCP",
  );
  if (!mcpBinding || !familyBinding) fail("durable_object_bindings_missing_or_mismatched");

  return buildProductionControlPlaneSnapshot({
    workerName: WORKER_NAME,
    sourceSha,
    activeDeploymentId: activeDeployment?.id,
    activeVersionId: versions[0]?.version_id,
    activeVersionPercentage: Number(versions[0]?.percentage),
    cronSchedules,
    oauthKvId: oauthKv.namespace_id,
    protectedExports: ["MyMCP", "FamilyMCP"],
    durableObjectBindings: [
      { name: "MCP_OBJECT", className: "MyMCP" },
      { name: "FAMILY_MCP_OBJECT", className: "FamilyMCP" },
    ],
    bindingFingerprint: bindingFingerprint(bindings),
    hardBlockerActive: true,
    readOnlyCapture: true,
    productionAuthorizationIssued: false,
  });
}

async function main() {
  const receipt = await collectProductionControlPlaneSnapshot({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    expectedSha: process.env.RESEARCH_VNEXT_EXPECTED_SHA,
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
