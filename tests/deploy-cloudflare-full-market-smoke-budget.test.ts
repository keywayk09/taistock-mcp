import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-cloudflare-production.yml", "utf8");
const fullMarket = workflow.match(/curl[\s\S]{0,260}?--max-time\s+(\d+)\s+"\$\{WORKER_BASE_URL\}\/health\/full-market"/);

assert.ok(fullMarket, "canonical Production workflow must GET /health/full-market with a bounded curl timeout");
const timeoutSeconds = Number(fullMarket?.[1] ?? 0);
assert.ok(
  timeoutSeconds >= 75,
  `full-market smoke timeout must be at least 75s after a healthy Production response was measured at 47.608s; current=${timeoutSeconds}s`,
);
assert.match(workflow, /for attempt in 1 2 3; do/);
assert.match(workflow, /steps\.smoke\.outcome != 'success'/);
assert.match(workflow, /reason='PRODUCTION_SMOKE_FAILED'/);

console.log(`PASS canonical full-market smoke budget=${timeoutSeconds}s`);
