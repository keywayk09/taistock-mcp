import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const family = read("src/v6/family-mcp.ts");
const oauth = read("src/v6/family-oauth.ts");
const familyContent = read("src/v6/family-content-handler.ts");
const ownerContent = read("src/v6/owner-content-handler.ts");
const broker = read("src/v6/mcp-access-broker.ts");
const index = read("src/index-v6.ts");
const wrangler = read("wrangler.jsonc");

for (const tool of [
  "family_engine_status",
  "get_family_stock_market_context",
  "screen_family_swing_candidates",
  "get_family_market_chip_summary",
  "analyze_family_stock",
  "compare_family_stocks",
]) {
  assert.match(family, new RegExp(tool));
}

assert.match(family, /READ_ONLY_FAMILY_SURFACE/);
assert.match(family, /PUBLISHED_GENERATION_ONLY/);
assert.match(family, /EXISTING_TV_FUGLE_1D_GITHUB_CANONICAL_ONLY/);
assert.match(family, /GITHUB_CANONICAL_READ_ONLY/);
assert.match(family, /FUGLE_REST_READ_ONLY_WITH_FIVE_LEVEL_BOOK_AND_RECENT_TRADES/);
assert.match(family, /LOCAL_FUGLE_REST_QUOTE_TRADES/);
assert.match(family, /FAIL_CLOSED_WHEN_CROSS_ACCOUNT_RPC_UNAVAILABLE/);
assert.match(family, /production_writes: false/);
assert.match(family, /github_writes: false/);
assert.match(family, /diamond_judgment_writes: false/);
assert.match(family, /runSmartFamilyAnalysis/);
assert.match(family, /READY_WITH_MOM_YOY/);
assert.match(family, /READY_WITH_MARGIN_EPS_CASHFLOW_RISK_FLAGS/);
assert.match(family, /TWSE_TPEX_OPENAPI_FAIL_SOFT/);

for (const forbidden of [
  "save_watchlist",
  "save_portfolio",
  "record_stock_event",
  "archive_supply_chain_snapshot",
  "sync_ohlc",
  "backfill_ohlc",
]) {
  assert.doesNotMatch(family, new RegExp(`registerTool\\(\\"${forbidden}\\"`));
}

// Cross-account Cloudflare Service Binding is intentionally absent. Family keeps
// its own MCP Durable Object namespace, while market reads remain read-only.
assert.doesNotMatch(wrangler, /OHLC_READ_SERVICE/);
assert.doesNotMatch(wrangler, /"services"\s*:/);

// The content adapter owns the Agents SDK Durable Object handoff. OAuth must
// only authorize and delegate; missing FAMILY_MCP_OBJECT still fails closed.
assert.match(familyContent, /FamilyMCP\.serve\("\/family-mcp", \{ binding: "FAMILY_MCP_OBJECT" \}\)/);
assert.match(familyContent, /family_mcp_binding_missing/);
assert.match(familyContent, /refusing to fall back to the full MCP_OBJECT namespace/);
assert.doesNotMatch(oauth, /new Proxy\(/);
assert.doesNotMatch(oauth, /if \(property === "MCP_OBJECT"\)/);
assert.doesNotMatch(oauth, /binding: "MCP_OBJECT"/);
assert.doesNotMatch(oauth, /FamilyMCP\.serve\(/);

// Owner and Family now share the same architectural shape: the broker owns
// ingress routing, while each content adapter owns its runtime implementation.
assert.match(broker, /pathname === "\/my-mcp" \|\| pathname === "\/mcp"/);
assert.match(broker, /ownerContentHandler\.fetch\(request, env, ctx\)/);
assert.match(ownerContent, /MyMCP\.serve\(pathname\)\.fetch/);
assert.match(index, /createMcpAccessBroker\([\s\S]*publicAppHandler,[\s\S]*ownerContentHandler,[\s\S]*familyContentHandler/);
assert.match(index, /family: "FamilyMCP_READ_ONLY_ISOLATED"/);

console.log("Family MCP isolated read-only cross-account-safe surface contract passed");
