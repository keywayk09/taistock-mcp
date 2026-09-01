import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const researchTools = read("src/v6/research-tools.ts");
const owner = read("src/v6/owner-content-handler.ts");
const boundaryTest = read("tests/research-vnext-boundary.test.ts");
const gate = read(".github/workflows/research-vnext-foundation-gate.yml");
const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json")) as {
  owner_tool_count: number;
  owner_abi_sha256: string;
};

// Phase 10B must use one internal compatibility registration server. Owner is
// deliberately unchanged; no second MCP graph or direct VNext Owner import.
assert.match(
  researchTools,
  /from\s+["']\.\/research-vnext\/compat-cutover(?:\.ts)?["']/,
  "research-tools must import only the approved VNext compat-cutover surface",
);
assert.match(
  researchTools,
  /createResearchVNextCompatRegistrationServer/,
  "research-tools must construct the bounded compat registration server",
);
assert.ok(
  researchTools.includes("registerSelective1mReplayTool(compatServer)"),
  "Selective 1m Replay registrar must be wired through compatServer",
);
assert.ok(
  researchTools.includes("registerReviewOrchestratorTools(compatServer, env)"),
  "Review Orchestrator registrar must be wired through compatServer",
);

// All unrelated registrars must remain on the original server. This prevents a
// whole-research-surface migration from being hidden inside the compatibility PR.
for (const call of [
  "registerResearchBlindOhlcFallbackTool(server, env)",
  "registerFormalBlindOhlcReaderTool(server, env)",
  "registerDeterministicBacktestTool(server)",
  "registerBatchBacktestTool(server, env)",
  "registerSwingOutcomePathTool(server)",
  "registerResearchValidationTools(server)",
  "registerSignalEventLedgerTools(server, env)",
  "registerExperimentLedgerTools(server, env)",
  "registerTxfReviewTools(server, env)",
  "registerGptJudgmentMemoryTools(server, env)",
  "registerStrategyLabTools(server)",
  "registerSupplyChainTools(server)",
  "registerSupplyChainDataPlaneTools(server, env)",
  "registerDiamondCapabilityTools(server)",
]) {
  assert.ok(researchTools.includes(call), `unrelated registrar must stay Legacy/original server: ${call}`);
}

assert.equal(owner.includes("research-vnext"), false, "Owner must not directly import/register Research VNext");
assert.equal(owner.includes("compat-cutover"), false, "Owner must remain unchanged in Phase 10B");

// The old foundation assertion is narrowed rather than deleted: direct Owner
// registration stays forbidden, while research-tools may reference only the
// approved compat-cutover module.
assert.match(boundaryTest, /compat-cutover/, "boundary test must explicitly encode the Phase 10B compat exception");
assert.match(boundaryTest, /Owner MCP.*direct|Owner.*direct/i, "boundary test must retain the Owner direct-registration prohibition");
assert.match(boundaryTest, /research-gateway\|shadow-facade|research-gateway/, "boundary test must forbid direct gateway/facade bypass imports");

// The incremental gate exception is exact and phase-scoped. Owner and all
// other protected surfaces stay fail-closed.
assert.match(gate, /PHASE10B_HANDLER_CUTOVER_EXCEPTION/, "scope gate must identify the Phase 10B exception explicitly");
assert.match(gate, /src\/v6\/research-tools\.ts/, "scope gate must name research-tools as the only cutover protected file");
assert.match(gate, /owner-content-handler/, "Owner must remain in the protected-surface gate");
assert.match(gate, /protected_files\[@\]/, "scope gate must verify the exact protected file set");

assert.equal(fixture.owner_tool_count, 123, "Phase 10B must preserve the frozen Owner tool count");
assert.equal(
  fixture.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
  "Phase 10B must preserve the Phase 9 aggregate ABI digest",
);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_HANDLER_CUTOVER_TEST_V1",
  status: "PASS",
  migrated_registrars: ["selective_1m_replay", "review_orchestrator"],
  owner_direct_registration: "FORBIDDEN",
  unrelated_registrars: "LEGACY_UNCHANGED",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  production_deploy: "NONE",
}, null, 2));
