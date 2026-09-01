import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RESEARCH_VNEXT_AUTHORITY,
  RESEARCH_VNEXT_CONTRACT_VERSION,
  RESEARCH_VNEXT_EVIDENCE_VERSION,
  createResearchEvidenceEnvelope,
  parseResearchVNextRequest,
} from "../src/v6/research-vnext/contracts/research-contract.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const vnextRoot = path.join(repoRoot, "src/v6/research-vnext");

function listTsFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

assert.equal(RESEARCH_VNEXT_CONTRACT_VERSION, "RESEARCH_VNEXT_CONTRACT_V1");
assert.equal(RESEARCH_VNEXT_EVIDENCE_VERSION, "RESEARCH_VNEXT_EVIDENCE_V1");
assert.deepEqual(RESEARCH_VNEXT_AUTHORITY, {
  reasoning_owner: "GPT",
  backend_authority: ["DATA", "DETERMINISTIC_COMPUTE", "REPLAY", "EVIDENCE", "MEMORY"],
  direct_market_provider_access: false,
  ohlc_write: false,
  automatic_strategy_promotion: false,
  production_registration: "DISABLED_UNTIL_SHADOW_PASS",
});

const parsed = parseResearchVNextRequest({
  schema: RESEARCH_VNEXT_CONTRACT_VERSION,
  request_id: "foundation-case-1",
  operation: "DETERMINISTIC_COMPUTE",
  payload: { symbol: "2426", timeframe: "5m" },
});
assert.equal(parsed.request_id, "foundation-case-1");
assert.equal(parsed.operation, "DETERMINISTIC_COMPUTE");

assert.throws(
  () => parseResearchVNextRequest({ schema: "WRONG", request_id: "x", operation: "EVIDENCE_QUERY", payload: {} }),
  /schema/i,
);
assert.throws(
  () => parseResearchVNextRequest({ schema: RESEARCH_VNEXT_CONTRACT_VERSION, request_id: "", operation: "EVIDENCE_QUERY", payload: {} }),
  /request_id/i,
);
assert.throws(
  () => parseResearchVNextRequest({ schema: RESEARCH_VNEXT_CONTRACT_VERSION, request_id: "x", operation: "THINK", payload: {} }),
  /operation/i,
);

const envelope = createResearchEvidenceEnvelope({
  request_id: "foundation-case-1",
  dataset_identity: "sha256:test-dataset",
  evidence: { sample_count: 60, pf: 1.23 },
});
assert.equal(envelope.schema, RESEARCH_VNEXT_EVIDENCE_VERSION);
assert.equal(envelope.reasoning_owner, "GPT");
assert.equal(envelope.backend_role, "EVIDENCE_ONLY");
assert.equal(envelope.dataset_identity, "sha256:test-dataset");

assert.equal(fs.existsSync(vnextRoot), true, "Research VNext root must exist before implementation is accepted");
const vnextFiles = listTsFiles(vnextRoot);
assert.ok(vnextFiles.length > 0, "Research VNext foundation must contain TypeScript source");

const forbiddenPatterns = [
  /from\s+["'][^"']*tw-market-data-github[^"']*["']/i,
  /from\s+["'][^"']*fugle[^"']*["']/i,
  /from\s+["'][^"']*finmind[^"']*["']/i,
  /fetch\s*\([^)]*(fugle|twse|tpex|finmind)/i,
];

for (const file of vnextFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(source), false, `Forbidden direct market-provider dependency in ${path.relative(repoRoot, file)}: ${pattern}`);
  }
}

const ownerSource = fs.readFileSync(path.join(repoRoot, "src/v6/owner-content-handler.ts"), "utf8");
const researchToolsSource = fs.readFileSync(path.join(repoRoot, "src/v6/research-tools.ts"), "utf8");
assert.equal(ownerSource.includes("research-vnext"), false, "Foundation phase must not register VNext in Owner MCP");
assert.equal(researchToolsSource.includes("research-vnext"), false, "Foundation phase must not register VNext through legacy research-tools");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_FOUNDATION_TEST_V1",
  status: "PASS",
  contract: RESEARCH_VNEXT_CONTRACT_VERSION,
  evidence: RESEARCH_VNEXT_EVIDENCE_VERSION,
  source_files_scanned: vnextFiles.length,
  production_registration: "UNCHANGED",
}, null, 2));
