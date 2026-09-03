import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFamilyOAuthPublicClientCompatWrapper } from "../src/v6/family-oauth-public-client-compat.ts";
import { TW_CHIP_INTELLIGENCE_REGISTRY, queryTwChipSources } from "../src/v6/tw-chip-intelligence-registry.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const indexV6 = read("src/index-v6.ts");
const broker = read("src/v6/mcp-access-broker.ts");
const familyContent = read("src/v6/family-content-handler.ts");
const familyMcp = read("src/v6/family-mcp.ts");
const twMarketTools = read("src/v6/tw-market-data-tools.ts");
const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const ctx = {} as ExecutionContext;
const env = {} as Env;

// PUBLIC_INGRESS_CONTRACT_V2
// External MCP endpoints are ABI. Runtime/tool implementations may change, but
// these public paths and their role identities may not drift.
assert.match(indexV6, /mcp_endpoint:\s*"\/my-mcp"/);
assert.match(indexV6, /legacy_mcp_endpoint:\s*"\/mcp"/);
assert.match(indexV6, /endpoint: "\/family-mcp"/);
assert.match(broker, /pathname === "\/my-mcp" \|\| pathname === "\/mcp"/);
assert.match(familyContent, /FamilyMCP\.serve\("\/family-mcp"/);

const wrapper = createFamilyOAuthPublicClientCompatWrapper({
  async fetch() {
    return new Response("inner", { status: 418 });
  },
});

// Family metadata is path-scoped to the frozen /family-mcp public ABI.
{
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource/family-mcp`),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}/family-mcp`);
  assert.deepEqual(body.scopes_supported, ["family:read"]);
}

// Owner metadata is independently path-scoped. Family changes may never claim
// /my-mcp or the retained /mcp alias.
for (const [metadataPath, resourcePath] of [
  ["/.well-known/oauth-protected-resource/my-mcp", "/my-mcp"],
  ["/.well-known/oauth-protected-resource/mcp", "/mcp"],
] as const) {
  const response = await wrapper.fetch(new Request(`${ORIGIN}${metadataPath}`), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}${resourcePath}`);
  assert.deepEqual(body.scopes_supported, ["owner:full"]);
  assert.notEqual(body.resource, `${ORIGIN}/family-mcp`);
}

// Worker-root has no implicit role. Owner is explicit; omitted-resource legacy
// compatibility belongs only to the Family authorization flow.
{
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource`),
    env,
    ctx,
  );
  assert.equal(response.status, 404);
}

// Runtime content behind /my-mcp and /family-mcp is intentionally not named in
// this contract. That is the adapter rule: implementations may change while
// public ingress remains stable.
assert.doesNotMatch(indexV6, /mcp_endpoint:\s*"\/v\d+/);
assert.doesNotMatch(indexV6, /endpoint:\s*"\/family-v\d+/);

// ON-DEMAND CHIP ROUTING CONTRACT V1
// New chip sources are internal providers only. They must never require users
// (Owner/Mom/Family) to reconnect a different URL or rescan a new public tool.
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.mode, "ON_DEMAND_ONLY");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.persistence_enabled, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.bulk_capture_enabled, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.decision_logic_enabled, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.owner_primary, "/my-mcp");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.owner_legacy_alias, "/mcp");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.family, "/family-mcp");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.change_public_ingress, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.add_public_endpoint, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.add_public_tool_name_required, false);

for (const tool of TW_CHIP_INTELLIGENCE_REGISTRY.integration_contract.family_existing_tools) {
  assert.match(familyMcp, new RegExp(`registerTool\\(\\"${tool}\\"`), `Family must keep existing tool ${tool}`);
}
for (const tool of TW_CHIP_INTELLIGENCE_REGISTRY.integration_contract.owner_existing_tools) {
  assert.match(twMarketTools, new RegExp(`registerTool\\(\\"${tool}\\"`), `Owner must keep existing tool ${tool}`);
}

const readySources = TW_CHIP_INTELLIGENCE_REGISTRY.sources.filter((source) => source.status === "READY");
assert.ok(readySources.length >= 7, "official on-demand baseline must cover institutional/margin/lending/SBL listed+OTC");
for (const source of readySources) {
  assert.equal(source.tier, "OFFICIAL_PRIMARY");
  assert.equal(source.completeness, "FULL_OFFICIAL_DATASET");
  assert.equal(source.source_date_verification, true);
  assert.ok(source.parser_contract, `${source.id} must point to an existing parser contract`);
  assert.ok(source.url_templates.length >= 1, `${source.id} must have a frozen route template`);
}

const marginSources = queryTwChipSources({ capability: "margin_short" });
assert.equal(marginSources.length, 2);
assert.ok(marginSources.some((source) => source.market === "listed" && source.source_name === "TWSE_MI_MARGN"));
assert.ok(marginSources.some((source) => source.market === "otc" && source.source_name === "TPEX_MAINBOARD_MARGIN_BALANCE"));

const brokerSources = queryTwChipSources({ capability: "broker_branch", include_experimental: true });
assert.equal(brokerSources.length, 1);
assert.equal(brokerSources[0].tier, "PUBLIC_SECONDARY");
assert.equal(brokerSources[0].completeness, "RANKED_ONLY");
assert.equal(brokerSources[0].bulk_collection_allowed, false);
assert.equal(brokerSources[0].terms_review_required, true);

assert.equal(queryTwChipSources({ capability: "warrant" }).length, 0, "unverified warrant source must fail closed by default");
assert.equal(queryTwChipSources({ capability: "maintenance_ratio" }).length, 0, "unverified maintenance-ratio source must fail closed by default");
assert.equal(queryTwChipSources({ capability: "warrant", include_planned: true })[0]?.status, "PLANNED_FAIL_CLOSED");
assert.equal(queryTwChipSources({ capability: "maintenance_ratio", include_planned: true })[0]?.status, "PLANNED_FAIL_CLOSED");

console.log("Public ingress freeze + on-demand chip routing contract passed");
