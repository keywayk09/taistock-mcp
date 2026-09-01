import assert from "node:assert/strict";
import fs from "node:fs";

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

// A deployment run must never mutate or rebase the source branch merely to
// persist observability metadata. That race previously produced false red runs.
assert.doesNotMatch(workflow, /git push origin HEAD:main/);
assert.doesNotMatch(workflow, /git rebase origin\/main/);
assert.doesNotMatch(workflow, /git commit -m ['"]ops: record Cloudflare production deploy result/);
assert.doesNotMatch(workflow, /git add -A -- tmp\/deploy-receipts/);

// Production truth remains the actual deploy/cron/smoke gates, not whether an
// auxiliary receipt can be archived.
assert.match(workflow, /name:\s*Enforce deployment result/);
for (const step of ["oauth_kv", "deploy", "cron", "smoke"]) {
  assert.ok(workflow.includes(`steps.${step}.outcome != 'success'`), `${step} outcome must remain enforced`);
}

// Preserve immutable evidence of the writer collision that motivated this fix.
assert.match(note, /PRODUCTION_WRITER_AUTHORITY_COLLISION_MAIN_WATCHDOG_VS_UNMERGED_CUTOVER/);
assert.match(note, /watchdog Run `33534917011`/);
assert.match(note, /canonical main deploy Run `33534927601`/);
assert.match(note, /0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c/);
assert.match(note, /79c49e81-b582-43ee-883e-0d0e0b6c3d39/);
assert.match(note, /Production mutation in this design\/test phase: `NONE`/);

// Baseline proves the current watchdog still has its original recovery writer.
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

// Formal RED: the bounded authority evaluator must not exist until this RED is accepted.
assert.ok(
  fs.existsSync(authorityEvaluatorPath),
  "production authority lease evaluator must exist only after accepted RED",
);

const authorityEvaluator = fs.readFileSync(authorityEvaluatorPath, "utf8");

// The evaluator must be bounded and credential-free.
assert.match(authorityEvaluator, /TAISTOCK_MCP_PRODUCTION_AUTHORITY_V1/);
assert.match(authorityEvaluator, /EXTERNAL_CUTOVER_LEASE/);
assert.match(authorityEvaluator, /taistock-mcp/);
assert.match(authorityEvaluator, /watchdog_main_recovery_suspended/);
assert.match(authorityEvaluator, /production_deploy_authorized/);
assert.match(authorityEvaluator, /production_mutation/);
assert.match(authorityEvaluator, /6\s*\*\s*60\s*\*\s*60\s*\*\s*1000|21600000/);
assert.doesNotMatch(authorityEvaluator, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|Authorization:\s*Bearer/i);
assert.doesNotMatch(authorityEvaluator, /wrangler\s+(?:deploy|rollback)|curl\s+.*-X\s+(?:POST|PUT|PATCH|DELETE)/i);

// Watchdog must consult the lease before stale-receipt recovery and must verify
// exact source-ref ancestry before suppressing main recovery.
assert.match(watchdog, /production-authority-lease\.mjs/);
assert.match(watchdog, /runtime\/taistock-mcp-production-authority\.json/);
assert.match(watchdog, /SUPPRESS_MAIN_RECOVERY/);
assert.match(watchdog, /EVALUATE_MAIN_RECEIPT/);
assert.match(watchdog, /git merge-base --is-ancestor/);
assert.match(watchdog, /external_cutover_lease_active/);
assert.match(watchdog, /invalid_external_cutover_lease/);
assert.match(watchdog, /steps\.detect\.outputs\.dispatch == 'true'/);

console.log("deploy-cloudflare-workflow: PASS");
