import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TW_CHIP_INTELLIGENCE_REGISTRY,
  queryTwChipSources,
} from "../src/v6/tw-chip-intelligence-registry.ts";

const index = fs.readFileSync("src/index-v6.ts", "utf8");
const ownerContent = fs.readFileSync("src/v6/owner-content-handler.ts", "utf8");
const familyMcp = fs.readFileSync("src/v6/family-mcp.ts", "utf8");
const twMarketTools = fs.readFileSync("src/v6/tw-market-data-tools.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");

// Public ingress ABI freeze. Provider swaps must remain behind these paths.
assert.match(index, /\/my-mcp/);
assert.match(index, /\/mcp/);
assert.match(index, /\/family-mcp/);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.owner_primary, "/my-mcp");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.owner_legacy_alias, "/mcp");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.family, "/family-mcp");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.change_public_ingress, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.add_public_endpoint, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.ingress_contract.add_public_tool_name_required, false);

// On-demand registry is routing metadata, never a second market-data store or
// autonomous decision engine.
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.mode, "ON_DEMAND_ONLY");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.read_only, true);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.monitoring_enabled, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.persistence_enabled, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.bulk_capture_enabled, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.decision_logic_enabled, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.policy.previous_day_substitution_for_missing_current_day, false);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.policy.raw_response_persistence, "NONE");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.policy.normalized_response_persistence, "NONE");
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.policy.no_captcha_bypass, true);
assert.equal(TW_CHIP_INTELLIGENCE_REGISTRY.policy.no_automated_bulk_scrape_when_disallowed, true);

// No new D1/R2/second persistence plane may appear while doing the provider
// migration. Existing canonical GitHub/OHLC contracts remain separate.
assert.doesNotMatch(wrangler, /d1_databases|r2_buckets|RESEARCH_DB/);
assert.match(wrangler, /GITHUB_DATA_REPO/);

// Owner/Family integration must reuse the existing public tools rather than
// inventing a new connector surface that would require reconnecting ChatGPT.
for (const tool of TW_CHIP_INTELLIGENCE_REGISTRY.integration_contract.family_existing_tools) {
  assert.match(familyMcp, new RegExp(`registerTool\\(\\"${tool}\\"`), `Family must keep existing tool ${tool}`);
}
for (const tool of TW_CHIP_INTELLIGENCE_REGISTRY.integration_contract.owner_existing_tools) {
  assert.match(twMarketTools, new RegExp(`registerTool\\(\\"${tool}\\"`), `Owner must keep existing tool ${tool}`);
}
assert.match(ownerContent, /registerTwMarketDataTools\(this\.server, this\.env\)/);

const readySources = TW_CHIP_INTELLIGENCE_REGISTRY.sources.filter((source) => source.status === "READY");
assert.ok(readySources.length >= 9, "official on-demand baseline must cover institutional/margin/lending/SBL plus listed+OTC warrant activity");
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

// Warrant routes have now been verified as official activity datasets. Their
// safety invariant is semantic: turnover/volume is non-directional and must not
// be promoted into a buy/sell or dealer-hedging signal.
const warrantSources = queryTwChipSources({ capability: "warrant" });
assert.equal(warrantSources.length, 2, "listed + OTC official warrant activity routes must be available on demand");
assert.ok(warrantSources.some((source) => source.market === "listed" && source.source_name.includes("TWSE")));
assert.ok(warrantSources.some((source) => source.market === "otc" && source.source_name.includes("TPEx")));
for (const source of warrantSources) {
  assert.equal(source.status, "READY");
  assert.equal(source.tier, "OFFICIAL_PRIMARY");
  assert.equal(source.source_date_verification, true);
  assert.match(source.notes ?? "", /does not identify buy aggressor|does not identify.*net buying/i);
}

// True customer-account maintenance ratio is still not derivable from public
// market aggregates and therefore remains fail-closed.
assert.equal(queryTwChipSources({ capability: "maintenance_ratio" }).length, 0, "unverified maintenance-ratio source must fail closed by default");
assert.equal(queryTwChipSources({ capability: "maintenance_ratio", include_planned: true })[0]?.status, "PLANNED_FAIL_CLOSED");

console.log("Public ingress freeze + on-demand chip/warrant routing contract passed");
