import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-cloudflare-production.yml", "utf8");

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

console.log("deploy-cloudflare-workflow: PASS");
