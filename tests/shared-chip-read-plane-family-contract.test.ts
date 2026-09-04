import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

const familyMcp = read("src/v6/family-mcp.ts");
const familyAction = read("src/v6/family-action-compat.ts");
const familySmartRest = read("src/v6/family-smart-rest.ts");
const familyOpenApi = read("src/v6/family-openapi-v2.ts");
const familyAnalysis = read("src/v6/family-analysis.ts");
const familyResearch = read("src/v6/family-research-policy.ts");
const familyShared = read("src/v6/family-shared-read-plane.ts");
const familyPlanner = read("src/v6/family-adaptive-planner.ts");
const familyEleven = read("src/v6/family-eleven-point.ts");
const unifiedEvidence = read("src/v6/family-unified-evidence.ts");
const familyCompact = read("src/v6/family-custom-gpt-compact.ts");
const marketTools = read("src/v6/tw-market-data-tools.ts");
const broker = read("src/v6/tw-broker-ranked-on-demand.ts");
const brokerRouter = read("src/v6/broker-provider-bundle-router.ts");
const legacyOwnerChipTools = read("src/v6/legacy-owner-chip-tools.ts");
const publicIngress = read("tests/public-ingress-freeze.test.ts");

// Owner, Family MCP, Family REST and the legacy Family Action must share the
// same current chip facade. Published generations remain history/replay context.
assert.match(marketTools, /getTwMarketChipSummaryOnDemand/);
for (const [name, source] of [
  ["family-mcp", familyMcp],
  ["family-action", familyAction],
  ["family-smart-rest", familySmartRest],
] as const) {
  assert.match(source, /getTwMarketChipSummaryOnDemand/, `${name} must use the shared current facade`);
  assert.doesNotMatch(source, /getTwMarketChipSummaryPublished/, `${name} must not bypass the facade to Published-only data`);
}

// Current-facing Family semantics must never regress to Published-only. The
// deterministic Published gateway itself is intentionally NOT scanned here;
// it remains valid for immutable history/replay.
for (const [name, source] of [
  ["family-mcp", familyMcp],
  ["family-action", familyAction],
  ["family-smart-rest", familySmartRest],
  ["family-openapi", familyOpenApi],
  ["family-analysis", familyAnalysis],
  ["family-research-policy", familyResearch],
  ["family-shared-read-plane", familyShared],
  ["family-adaptive-planner", familyPlanner],
  ["family-eleven-point", familyEleven],
] as const) {
  assert.doesNotMatch(source, /PUBLISHED_GENERATION_ONLY/, `${name} must not advertise Published-only current chip semantics`);
  assert.doesNotMatch(source, /正式籌碼只(?:認|採)\s*Published generation/i, `${name} contains stale Published-only wording`);
  assert.doesNotMatch(source, /直接讀取正式\s*Published generation\s*籌碼/i, `${name} contains stale Published-only current route wording`);
  assert.doesNotMatch(source, /以Published generation為(?:正式層|準)/i, `${name} contains stale Published-only decision wording`);
}

// Family policy/evidence recognizes exact-date current chip evidence while
// retaining Published only as immutable historical/replay context.
assert.match(familyShared, /current_chip/);
assert.match(familyShared, /OFFICIAL_EXACT_DATE_ON_DEMAND/);
assert.match(familyPlanner, /current_chip/);
assert.match(unifiedEvidence, /current_chip/);
assert.match(unifiedEvidence, /HISTORY_CONTEXT/);
assert.match(familyAnalysis, /on-demand|On-demand|ON_DEMAND/);
assert.match(familyResearch, /PUBLISHED_HISTORY_CONTEXT/);
assert.match(familyOpenApi, /exact-date on-demand/i);
assert.match(familyOpenApi, /Published generation[^\n]*(?:historical|history|歷史|replay)/i);
assert.match(familyEleven, /current_chip_evidence/);
assert.match(familyEleven, /exact-date on-demand/i);
assert.match(familyEleven, /Published generation只作歷史\/replay context/);

// The old Custom GPT Action is size-bounded, but it must retain a compact chip
// section. Otherwise the backend may fetch current broker/margin data correctly
// and the model still never receives it.
assert.match(familyCompact, /chip:/);
assert.match(familyCompact, /analysis\?\.chip/);

// MoneyDJ remains a dedicated ranked-only provider adapter, but canonical
// broker-window selection now goes through a provider-neutral whole-bundle
// router. The router must never introduce FinMind credentials or per-window
// cross-source backfill.
assert.match(broker, /MoneyDJ broker ranked public page/);
assert.match(broker, /RANKED_ONLY/);
assert.match(broker, /missing branches must NOT be interpreted as zero activity/i);
assert.doesNotMatch(broker, /FINMIND|FinMind|token/i);
assert.match(brokerRouter, /getTwBrokerProviderBundleOnDemand/);
assert.match(brokerRouter, /same_provider_required:\s*true/);
assert.match(brokerRouter, /cross_source_backfill_allowed:\s*false/);
assert.match(brokerRouter, /cross_provider_window_mixing:\s*false/);
assert.match(brokerRouter, /NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES/);
assert.match(familyOpenApi, /RANKED_ONLY/);
assert.match(familyEleven, /RANKED_ONLY/);

// Historical 79-tool ABI is frozen. Multi-window broker evidence may enrich the
// response, but it must never add an input field that forces old ChatGPT clients
// to refresh/reconnect their cached schema. The frozen tool must use the same
// whole-provider router as Family rather than bypassing it with MoneyDJ direct.
const brokerInput = legacyOwnerChipTools.match(
  /server\.registerTool\("get_broker_chips",[\s\S]*?inputSchema:\s*\{([\s\S]*?)\n\s*\},\n\s*annotations:/,
)?.[1];
assert.ok(brokerInput, "get_broker_chips input schema must remain discoverable");
assert.match(brokerInput, /symbol:\s*symbolSchema/);
assert.match(brokerInput, /date:\s*dateSchema/);
assert.match(brokerInput, /top_n:/);
assert.doesNotMatch(brokerInput, /window|period|days|provider/i, "multi-provider windows must not change the frozen public input schema");
assert.match(legacyOwnerChipTools, /getTwBrokerProviderBundleOnDemand/);
assert.doesNotMatch(legacyOwnerChipTools, /getTwBrokerRankedWindowBundleOnDemand/);
assert.match(legacyOwnerChipTools, /1,\s*5,\s*10,\s*20,\s*60/);
assert.match(legacyOwnerChipTools, /daily_rank_summing/);

// Warrant activity is official activity data but is not directional flow.
assert.match(familyResearch, /OFFICIAL_NON_DIRECTIONAL_ACTIVITY_ONLY/);
assert.match(familyOpenApi, /非方向性|non-directional/i);
assert.match(familyEleven, /權證僅非方向性activity/);

// Public ingress is ABI and must remain frozen while implementations change.
assert.match(publicIngress, /owner_primary, "\/my-mcp"/);
assert.match(publicIngress, /owner_legacy_alias, "\/mcp"/);
assert.match(publicIngress, /family, "\/family-mcp"/);
assert.match(familyAction, /\/api\/family\/query/);

// Family remains read-only regardless of shared market-data quality.
assert.match(familyMcp, /READ_ONLY_FAMILY_SURFACE/);
assert.match(familyMcp, /production_writes: false/);
assert.match(familyMcp, /github_writes: false/);
assert.match(familyAction, /writes_allowed:\s*false/);
assert.doesNotMatch(familyMcp, /registerTool\("save_watchlist"/);

console.log("PASS shared current chip read plane for Owner + Family with frozen ingress/read-only permissions");
