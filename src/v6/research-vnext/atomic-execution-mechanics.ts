export const RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_VERSION =
  "research-vnext-atomic-execution-mechanics/v1.0.0";

const EXPECTED_CONFIRMATION = "EXECUTE_ATOMIC_VNEXT_PRODUCTION";
const EXPECTED_CRON = "*/5 * * * *";
const HEX40 = /^[0-9a-f]{40}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(reason: string): never {
  throw new Error(`atomic_execution_mechanics_invalid:${reason}`);
}

function validateVersionId(value: unknown): string {
  const version = String(value ?? "").trim();
  if (!UUID.test(version)) fail("predeploy_version_id_must_be_uuid");
  return version.toLowerCase();
}

export function buildAtomicProductionExecutionMechanics(input: {
  confirmation: unknown;
  expectedSha: unknown;
  actualSha: unknown;
  oauthKvId: unknown;
  predeployVersionId: unknown;
  predeployCrons: unknown;
  protectedExports: unknown;
  bindingFingerprint: unknown;
  hardBlockerActive: unknown;
  productionAuthorizationIssued: unknown;
}) {
  if (input.confirmation !== EXPECTED_CONFIRMATION) fail("confirmation_mismatch");

  const expectedSha = String(input.expectedSha ?? "").trim().toLowerCase();
  const actualSha = String(input.actualSha ?? "").trim().toLowerCase();
  if (!HEX40.test(expectedSha)) fail("expected_sha_must_be_40_hex");
  if (!HEX40.test(actualSha) || actualSha !== expectedSha) fail("source_sha_mismatch");

  const oauthKvId = String(input.oauthKvId ?? "").trim().toLowerCase();
  if (!HEX32.test(oauthKvId)) fail("oauth_kv_id_must_be_32_hex");

  const predeployVersionId = validateVersionId(input.predeployVersionId);

  if (
    !Array.isArray(input.predeployCrons) ||
    input.predeployCrons.length !== 1 ||
    input.predeployCrons[0] !== EXPECTED_CRON
  ) {
    fail("predeploy_cron_contract_mismatch");
  }

  if (
    !Array.isArray(input.protectedExports) ||
    input.protectedExports.length !== 2 ||
    input.protectedExports[0] !== "MyMCP" ||
    input.protectedExports[1] !== "FamilyMCP"
  ) {
    fail("protected_exports_mismatch");
  }

  const bindingFingerprint = String(input.bindingFingerprint ?? "").trim().toLowerCase();
  if (!HEX64.test(bindingFingerprint)) fail("binding_fingerprint_must_be_64_hex");
  if (input.hardBlockerActive !== true) fail("hard_blocker_must_remain_active");
  if (input.productionAuthorizationIssued !== false) {
    fail("production_authorization_must_remain_false_in_design_phase");
  }

  const operationGraph = Object.freeze([
    Object.freeze({ order: 1, operation: "VERIFY_EXACT_SHA_AND_CONFIRMATION", execution_class: "LOCAL_ONLY" }),
    Object.freeze({ order: 2, operation: "SNAPSHOT_ACTIVE_DEPLOYMENT_VERSION", execution_class: "FUTURE_READ_ONLY_CONTROL_PLANE" }),
    Object.freeze({ order: 3, operation: "SNAPSHOT_CRON_PRE", execution_class: "FUTURE_READ_ONLY_CONTROL_PLANE" }),
    Object.freeze({ order: 4, operation: "BUILD_ATOMIC_CONFIG", execution_class: "LOCAL_ONLY" }),
    Object.freeze({ order: 5, operation: "VERIFY_EXPORTS_AND_BINDING_FINGERPRINT", execution_class: "LOCAL_ONLY" }),
    Object.freeze({ order: 6, operation: "EXECUTE_ATOMIC_DEPLOY", execution_class: "FUTURE_MUTATION_BLOCKED" }),
    Object.freeze({ order: 7, operation: "RUN_READ_ONLY_PRODUCTION_PROBE", execution_class: "FUTURE_READ_ONLY_PRODUCTION" }),
    Object.freeze({ order: 8, operation: "SNAPSHOT_CRON_POST", execution_class: "FUTURE_READ_ONLY_CONTROL_PLANE" }),
    Object.freeze({ order: 9, operation: "COMPARE_POSTDEPLOY_ABI_AND_CRON", execution_class: "LOCAL_ONLY" }),
    Object.freeze({ order: 10, operation: "ASSESS_MANUAL_ROLLBACK_ELIGIBILITY", execution_class: "LOCAL_ONLY" }),
    Object.freeze({ order: 11, operation: "MANUAL_ROLLBACK_EXACT_VERSION", execution_class: "FUTURE_MUTATION_CONDITIONAL_BLOCKED" }),
  ]);

  return Object.freeze({
    schema: "RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_PLAN_V1",
    version: RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_VERSION,
    status: "READY_BEHIND_HARD_BLOCKER",
    source_sha: actualSha,
    predeploy_version_id: predeployVersionId,
    predeploy_crons: Object.freeze([EXPECTED_CRON]),
    protected_exports: Object.freeze(["MyMCP", "FamilyMCP"]),
    binding_fingerprint: bindingFingerprint,
    oauth_kv_validated: true,
    hard_blocker: "REQUIRED_ACTIVE",
    production_deploy_authorized: false,
    production_mutation: "NONE",
    operation_graph: operationGraph,
  } as const);
}

export function assessAtomicRollbackEligibility(input: {
  predeployVersionId: unknown;
  doLifecycleChanged: unknown;
  bindingsValid: unknown;
  targetVersionAvailable: unknown;
  cronSnapshotMatches: unknown;
}) {
  const targetVersionId = validateVersionId(input.predeployVersionId);

  let reason: string | null = null;
  if (input.doLifecycleChanged === true) reason = "DO_LIFECYCLE_CHANGED";
  else if (input.bindingsValid !== true) reason = "BINDINGS_NOT_VALID";
  else if (input.targetVersionAvailable !== true) reason = "TARGET_VERSION_NOT_AVAILABLE";
  else if (input.cronSnapshotMatches !== true) reason = "CRON_SNAPSHOT_DRIFT";

  if (reason) {
    return Object.freeze({
      schema: "RESEARCH_VNEXT_ATOMIC_ROLLBACK_ELIGIBILITY_V1",
      eligible: false,
      target_version_id: targetVersionId,
      automatic: false,
      action: "FAIL_CLOSED_MANUAL_INTERVENTION",
      reason,
    } as const);
  }

  return Object.freeze({
    schema: "RESEARCH_VNEXT_ATOMIC_ROLLBACK_ELIGIBILITY_V1",
    eligible: true,
    target_version_id: targetVersionId,
    automatic: false,
    action: "MANUAL_ROLLBACK_ELIGIBLE",
    reason: "NO_DO_LIFECYCLE_CHANGE_AND_BINDINGS_STILL_VALID",
  } as const);
}
