import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workflow = fs.readFileSync(".github/workflows/deploy-cloudflare-production.yml", "utf8");
const watchdog = fs.readFileSync(".github/workflows/deploy-cloudflare-watchdog.yml", "utf8");
const note = fs.readFileSync("docs/change-notes/2026-09-02-production-watchdog-authority-handoff.md", "utf8");
const authorityEvaluatorPath = "scripts/production-authority-lease.mjs";

assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.match(workflow, /taistock-mcp-cloudflare-receipt-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
assert.match(workflow, /if-no-files-found:\s*warn/);
assert.match(workflow, /retention-days:\s*30/);
assert.match(workflow, /Build per-run deployment receipt/);
assert.match(workflow, /continue-on-error:\s*true[\s\S]*Upload per-run deployment receipt/);

assert.doesNotMatch(workflow, /git push origin HEAD:main/);
assert.doesNotMatch(workflow, /git rebase origin\/main/);
assert.doesNotMatch(workflow, /git commit -m ['"]ops: record Cloudflare production deploy result/);
assert.doesNotMatch(workflow, /git add -A -- tmp\/deploy-receipts/);

assert.match(workflow, /name:\s*Enforce deployment result/);
for (const step of ["oauth_kv", "deploy", "cron", "smoke"]) {
  assert.ok(workflow.includes(`steps.${step}.outcome != 'success'`), `${step} outcome must remain enforced`);
}

// The non-OHLC chip scheduler is retired. Production deploy must actively clear
// persisted Cloudflare schedules because removing `triggers.crons` from Wrangler
// does not by itself guarantee an old remote schedule disappears.
assert.match(workflow, /Remove and verify all Worker Cron Triggers/);
assert.match(workflow, /workers\/scripts\/taistock-mcp\/schedules/);
assert.match(workflow, /--data '\[\]'/);
assert.match(workflow, /cron_retirement_verify_failed/);
assert.match(workflow, /CRON_TRIGGER_RETIREMENT_FAILED/);
assert.match(workflow, /DEPLOYED_NO_CRON_AND_FULL_MARKET_SMOKE_VERIFIED/);
assert.match(workflow, /"scheduled_chip_capture": "DISABLED"/);
assert.match(workflow, /"worker_cron_schedules": \[\]/);
assert.doesNotMatch(workflow, /Install and verify five-minute Cron Trigger/);
assert.doesNotMatch(workflow, /--data '\[\{"cron"/);
assert.match(workflow, /scheduled_chip_capture'\) != 'DISABLED'/);
assert.match(workflow, /current_chip_persistence'\) != 'NONE'/);
assert.match(workflow, /ohlc_policy'\) != 'UNCHANGED_CANONICAL_PIPELINE'/);

// Degraded Production health responses must retain their JSON body in the
// diagnostic artifact. `--fail-with-body` keeps HTTP failure semantics while
// preserving the endpoint's source/coverage errors for root-cause analysis.
assert.match(workflow, /curl --fail-with-body --silent --show-error --max-time 20 "\$\{WORKER_BASE_URL\}\/health"/);
assert.match(workflow, /curl --fail-with-body --silent --show-error --max-time 45 "\$\{WORKER_BASE_URL\}\/health\/full-market"/);
assert.doesNotMatch(workflow, /curl --fail --silent --show-error --max-time 45 "\$\{WORKER_BASE_URL\}\/health\/full-market"/);
assert.match(workflow, /cat \/tmp\/smoke-full-market\.json/);

assert.match(note, /PRODUCTION_WRITER_AUTHORITY_COLLISION_MAIN_WATCHDOG_VS_UNMERGED_CUTOVER/);
assert.match(note, /watchdog Run `33534917011`/);
assert.match(note, /canonical main deploy Run `33534927601`/);
assert.match(note, /0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c/);
assert.match(note, /79c49e81-b582-43ee-883e-0d0e0b6c3d39/);
assert.match(note, /Production mutation in this design\/test phase: `NONE`/);

assert.match(watchdog, /cron:\s*['"]\*\/5 \* \* \* \*['"]/);
assert.match(watchdog, /reason='production_source_stale'/);
assert.match(watchdog, /gh workflow run deploy-cloudflare-production\.yml --ref main/);

console.log("PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "TAISTOCK_MCP_PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_RED_V1",
  status: "PASS",
  watchdog_recovery_writer: "PRESENT",
  authority_evaluator: fs.existsSync(authorityEvaluatorPath) ? "PRESENT" : "ABSENT",
  production_deploy_authorized: false,
  production_mutation: "NONE",
}, null, 2));

assert.ok(
  fs.existsSync(authorityEvaluatorPath),
  "production authority lease evaluator must exist only after accepted RED",
);

const authorityEvaluator = fs.readFileSync(authorityEvaluatorPath, "utf8");
assert.match(authorityEvaluator, /TAISTOCK_MCP_PRODUCTION_AUTHORITY_V1/);
assert.match(authorityEvaluator, /EXTERNAL_CUTOVER_LEASE/);
assert.match(authorityEvaluator, /taistock-mcp/);
assert.match(authorityEvaluator, /watchdog_main_recovery_suspended/);
assert.match(authorityEvaluator, /production_deploy_authorized/);
assert.match(authorityEvaluator, /production_mutation/);
assert.match(authorityEvaluator, /6\s*\*\s*60\s*\*\s*60\s*\*\s*1000|21600000/);
assert.doesNotMatch(authorityEvaluator, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|Authorization:\s*Bearer/i);
assert.doesNotMatch(authorityEvaluator, /wrangler\s+(?:deploy|rollback)|curl\s+.*-X\s+(?:POST|PUT|PATCH|DELETE)/i);

assert.match(watchdog, /production-authority-lease\.mjs/);
assert.match(watchdog, /runtime\/taistock-mcp-production-authority\.json/);
assert.match(watchdog, /SUPPRESS_MAIN_RECOVERY/);
assert.match(watchdog, /EVALUATE_MAIN_RECEIPT/);
assert.match(watchdog, /git merge-base --is-ancestor/);
assert.match(watchdog, /external_cutover_lease_active/);
assert.match(watchdog, /invalid_external_cutover_lease/);
assert.match(watchdog, /steps\.detect\.outputs\.dispatch == 'true'/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "authority-lease-test-"));
const leasePath = path.join(tmp, "authority.json");
const evaluator = path.resolve(authorityEvaluatorPath);

function runEvaluator(now: string, lease?: unknown) {
  if (lease === undefined) {
    fs.rmSync(leasePath, { force: true });
  } else {
    fs.writeFileSync(leasePath, JSON.stringify(lease));
  }
  return spawnSync(process.execPath, [evaluator, leasePath], {
    encoding: "utf8",
    env: { ...process.env, PRODUCTION_AUTHORITY_NOW: now },
  });
}

const commonLease = {
  schema: "TAISTOCK_MCP_PRODUCTION_AUTHORITY_V1",
  mode: "EXTERNAL_CUTOVER_LEASE",
  worker: "taistock-mcp",
  source_ref: "refactor/research-vnext-foundation-20260901",
  source_sha: "6dc5beb02c168ad6c7c74c314fc9cf704253391a",
  issued_at: "2026-09-01T18:00:00Z",
  expires_at: "2026-09-01T23:59:00Z",
  watchdog_main_recovery_suspended: true,
  production_deploy_authorized: false,
  production_mutation: "NONE",
  handoff_id: "test-vnext-cutover",
};

const absent = runEvaluator("2026-09-01T18:30:00Z");
assert.equal(absent.status, 0);
assert.match(absent.stdout, /"state": "ABSENT"/);
assert.match(absent.stdout, /"policy": "EVALUATE_MAIN_RECEIPT"/);

const active = runEvaluator("2026-09-01T18:30:00Z", commonLease);
assert.equal(active.status, 0);
assert.match(active.stdout, /"state": "ACTIVE"/);
assert.match(active.stdout, /"policy": "SUPPRESS_MAIN_RECOVERY"/);
assert.match(active.stdout, /"production_deploy_authorized": false/);
assert.match(active.stdout, /"production_mutation": "NONE"/);

const expired = runEvaluator("2026-09-02T00:01:00Z", commonLease);
assert.equal(expired.status, 0);
assert.match(expired.stdout, /"state": "EXPIRED"/);
assert.match(expired.stdout, /"policy": "EVALUATE_MAIN_RECEIPT"/);

const invalid = runEvaluator("2026-09-01T18:30:00Z", {
  ...commonLease,
  expires_at: "2026-09-02T00:30:01Z",
});
assert.equal(invalid.status, 78);
assert.match(invalid.stdout, /"state": "INVALID"/);
assert.match(invalid.stdout, /"policy": "FAIL_CLOSED"/);
assert.match(invalid.stderr, /invalid_external_cutover_lease:lease_duration_exceeds_six_hours/);

fs.rmSync(tmp, { recursive: true, force: true });

console.log("PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_EXECUTABLE_GREEN=PASS");
console.log("PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "TAISTOCK_MCP_PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_RED_V1",
  status: "PASS",
  committed_receipt_authority: /tmp\/deploy-receipts\/taistock-mcp-cloudflare\.json/.test(watchdog) ? "PRESENT" : "ABSENT",
  desired_authority: "LATEST_CANONICAL_DEPLOY_ACTIONS_EVIDENCE",
  production_mutation: "NONE",
}, null, 2));

// Formal second RED: the watchdog must stop treating a stale committed receipt
// as live deployment authority. Canonical deployment truth is the latest GitHub
// Actions deployment run for main; its per-run receipt remains an artifact.
assert.doesNotMatch(
  watchdog,
  /tmp\/deploy-receipts\/taistock-mcp-cloudflare\.json/,
  "watchdog must not use the stale committed deploy receipt as live Production authority",
);

assert.match(watchdog, /gh run list --workflow deploy-cloudflare-production\.yml --branch main/);
assert.match(watchdog, /databaseId,headSha,status,conclusion,createdAt,event/);
assert.match(watchdog, /canonical_deploy_in_progress/);
assert.match(watchdog, /latest_successful_deploy/);
assert.match(watchdog, /failed_deploy_retry_due/);

console.log("PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_GREEN=PASS");
console.log("deploy-cloudflare-workflow: PASS");
