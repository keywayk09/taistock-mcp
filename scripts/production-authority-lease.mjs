import fs from "node:fs";

const leasePath = process.argv[2] || "runtime/taistock-mcp-production-authority.json";
const MAX_LEASE_MS = 6 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function appendOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${key}=${String(value)}\n`);
}

function emit(result) {
  for (const [key, value] of Object.entries(result)) appendOutput(key, value);
  console.log(JSON.stringify({
    schema: "TAISTOCK_MCP_PRODUCTION_AUTHORITY_EVALUATION_V1",
    ...result,
  }, null, 2));
}

function invalid(reason) {
  emit({
    state: "INVALID",
    policy: "FAIL_CLOSED",
    reason,
    source_ref: "",
    source_sha: "",
    handoff_id: "",
    production_deploy_authorized: false,
    production_mutation: "NONE",
  });
  console.error(`invalid_external_cutover_lease:${reason}`);
  process.exit(78);
}

if (!fs.existsSync(leasePath)) {
  emit({
    state: "ABSENT",
    policy: "EVALUATE_MAIN_RECEIPT",
    reason: "authority_lease_absent",
    source_ref: "",
    source_sha: "",
    handoff_id: "",
    production_deploy_authorized: false,
    production_mutation: "NONE",
  });
  process.exit(0);
}

let lease;
try {
  lease = JSON.parse(fs.readFileSync(leasePath, "utf8"));
} catch {
  invalid("invalid_json");
}

if (lease.schema !== "TAISTOCK_MCP_PRODUCTION_AUTHORITY_V1") invalid("invalid_schema");
if (lease.mode !== "EXTERNAL_CUTOVER_LEASE") invalid("invalid_mode");
if (lease.worker !== "taistock-mcp") invalid("invalid_worker");
if (lease.watchdog_main_recovery_suspended !== true) invalid("watchdog_suspend_must_be_true");
if (lease.production_deploy_authorized !== false) invalid("lease_must_not_authorize_deploy");
if (lease.production_mutation !== "NONE") invalid("lease_must_not_authorize_mutation");

const sourceRef = String(lease.source_ref || "");
const sourceSha = String(lease.source_sha || "");
const handoffId = String(lease.handoff_id || "");

if (!sourceRef || sourceRef === "main") invalid("source_ref_must_be_non_main");
if (!/^[A-Za-z0-9._/-]+$/.test(sourceRef)) invalid("invalid_source_ref_characters");
if (sourceRef.startsWith("/") || sourceRef.endsWith("/") || sourceRef.includes("//") || sourceRef.includes("..")) {
  invalid("unsafe_source_ref");
}
if (!/^[0-9a-f]{40}$/.test(sourceSha)) invalid("invalid_source_sha");
if (!handoffId || handoffId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(handoffId)) invalid("invalid_handoff_id");

const issuedMs = Date.parse(String(lease.issued_at || ""));
const expiresMs = Date.parse(String(lease.expires_at || ""));
if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) invalid("invalid_lease_time");
if (expiresMs <= issuedMs) invalid("non_positive_lease_duration");
if (expiresMs - issuedMs > MAX_LEASE_MS) invalid("lease_duration_exceeds_six_hours");

const nowOverride = process.env.PRODUCTION_AUTHORITY_NOW;
const nowMs = nowOverride ? Date.parse(nowOverride) : Date.now();
if (!Number.isFinite(nowMs)) invalid("invalid_now_override");
if (issuedMs > nowMs + FUTURE_TOLERANCE_MS) invalid("issued_at_too_far_in_future");

if (expiresMs <= nowMs) {
  emit({
    state: "EXPIRED",
    policy: "EVALUATE_MAIN_RECEIPT",
    reason: "external_cutover_lease_expired",
    source_ref: sourceRef,
    source_sha: sourceSha,
    handoff_id: handoffId,
    production_deploy_authorized: false,
    production_mutation: "NONE",
  });
  process.exit(0);
}

emit({
  state: "ACTIVE",
  policy: "SUPPRESS_MAIN_RECOVERY",
  reason: "external_cutover_lease_active",
  source_ref: sourceRef,
  source_sha: sourceSha,
  handoff_id: handoffId,
  production_deploy_authorized: false,
  production_mutation: "NONE",
});
