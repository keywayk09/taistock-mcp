export const RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_VERSION =
  "research-vnext-production-control-plane-snapshot/v1.0.0";

const EXPECTED_WORKER = "taistock-mcp";
const EXPECTED_CRON = "*/5 * * * *";
const HEX40 = /^[0-9a-f]{40}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(reason: string): never {
  throw new Error(`production_control_plane_snapshot_invalid:${reason}`);
}

function normalizeUuid(value: unknown, reason: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!UUID.test(normalized)) fail(reason);
  return normalized;
}

function validateDurableObjectBindings(value: unknown) {
  if (!Array.isArray(value) || value.length !== 2) fail("durable_object_bindings_mismatch");
  const expected = [
    ["MCP_OBJECT", "MyMCP"],
    ["FAMILY_MCP_OBJECT", "FamilyMCP"],
  ];
  const normalized = value.map((row: any) => ({
    name: String(row?.name ?? ""),
    className: String(row?.className ?? ""),
  }));
  for (let i = 0; i < expected.length; i += 1) {
    if (normalized[i].name !== expected[i][0] || normalized[i].className !== expected[i][1]) {
      fail("durable_object_bindings_mismatch");
    }
  }
  return Object.freeze(normalized.map((row) => Object.freeze(row)));
}

export function buildProductionControlPlaneSnapshot(input: {
  workerName: unknown;
  sourceSha: unknown;
  activeDeploymentId: unknown;
  activeVersionId: unknown;
  activeVersionPercentage: unknown;
  cronSchedules: unknown;
  oauthKvId: unknown;
  protectedExports: unknown;
  durableObjectBindings: unknown;
  bindingFingerprint: unknown;
  hardBlockerActive: unknown;
  readOnlyCapture: unknown;
  productionAuthorizationIssued: unknown;
}) {
  if (input.workerName !== EXPECTED_WORKER) fail("worker_name_mismatch");

  const sourceSha = String(input.sourceSha ?? "").trim().toLowerCase();
  if (!HEX40.test(sourceSha)) fail("source_sha_must_be_40_hex");

  const activeDeploymentId = normalizeUuid(
    input.activeDeploymentId,
    "active_deployment_id_must_be_uuid",
  );
  const activeVersionId = normalizeUuid(
    input.activeVersionId,
    "active_version_id_must_be_uuid",
  );

  if (input.activeVersionPercentage !== 100) fail("active_version_must_be_100_percent");

  if (
    !Array.isArray(input.cronSchedules) ||
    input.cronSchedules.length !== 1 ||
    input.cronSchedules[0] !== EXPECTED_CRON
  ) {
    fail("cron_contract_mismatch");
  }

  const oauthKvId = String(input.oauthKvId ?? "").trim().toLowerCase();
  if (!HEX32.test(oauthKvId)) fail("oauth_kv_id_must_be_32_hex");

  if (
    !Array.isArray(input.protectedExports) ||
    input.protectedExports.length !== 2 ||
    input.protectedExports[0] !== "MyMCP" ||
    input.protectedExports[1] !== "FamilyMCP"
  ) {
    fail("protected_exports_mismatch");
  }

  const durableObjectBindings = validateDurableObjectBindings(input.durableObjectBindings);

  const bindingFingerprint = String(input.bindingFingerprint ?? "").trim().toLowerCase();
  if (!HEX64.test(bindingFingerprint)) fail("binding_fingerprint_must_be_64_hex");
  if (input.hardBlockerActive !== true) fail("hard_blocker_must_remain_active");
  if (input.readOnlyCapture !== true) fail("snapshot_must_be_read_only");
  if (input.productionAuthorizationIssued !== false) fail("production_authorization_must_remain_false");

  return Object.freeze({
    schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_V1",
    version: RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_VERSION,
    status: "READ_ONLY_SNAPSHOT_VALID",
    worker_name: EXPECTED_WORKER,
    source_sha: sourceSha,
    active_deployment_id: activeDeploymentId,
    active_version_id: activeVersionId,
    active_version_percentage: 100,
    cron_schedules: Object.freeze([EXPECTED_CRON]),
    oauth_kv_id: oauthKvId,
    protected_exports: Object.freeze(["MyMCP", "FamilyMCP"]),
    durable_object_bindings: durableObjectBindings,
    binding_fingerprint: bindingFingerprint,
    rollback_target_version_id: activeVersionId,
    hard_blocker: "REQUIRED_ACTIVE",
    read_only_capture: true,
    token_leak: false,
    production_deploy_authorized: false,
    production_mutation: "NONE",
  } as const);
}
