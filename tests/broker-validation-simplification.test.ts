import assert from "node:assert/strict";
import fs from "node:fs";

const mergeTrigger = fs.readFileSync(".github/workflows/deploy-cloudflare-merge-trigger.yml", "utf8");
const researchValidation = fs.readFileSync(".github/workflows/research-vnext-production-validation.yml", "utf8");

// Normal merged-PR deployment orchestration must stay credential-free: it only
// dispatches the canonical Production writer. The canonical deploy itself owns
// health/full-market smoke and deployment receipts.
assert.match(mergeTrigger, /gh workflow run deploy-cloudflare-production\.yml/);
assert.doesNotMatch(mergeTrigger, /RESEARCH_VNEXT_PROBE_TOKEN|BROKER_PROBE_TOKEN/);
assert.doesNotMatch(mergeTrigger, /broker-production-readonly-probe/);
assert.doesNotMatch(mergeTrigger, /Run strict post-deploy broker read-only validation/);
assert.doesNotMatch(mergeTrigger, /Wait for exact canonical Production deploy/);
assert.doesNotMatch(mergeTrigger, /actions\/setup-node|actions\/upload-artifact/);

// Authenticated MCP probing remains available only as an explicitly dispatched
// diagnostic. It must not auto-run after normal Production deploys and therefore
// must not create a standing credential requirement for deploys.
assert.doesNotMatch(researchValidation, /\n\s*workflow_run:\s*\n/);
assert.doesNotMatch(researchValidation, /AUTHORIZED_BY_SUCCESSFUL_MAIN_DEPLOY/);
assert.match(researchValidation, /workflow_dispatch:/);
assert.match(researchValidation, /RESEARCH_VNEXT_PROBE_TOKEN/);
assert.match(researchValidation, /broker-production-readonly-probe/);

console.log("broker validation simplification contract: PASS");
