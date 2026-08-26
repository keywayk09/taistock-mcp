import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const family = read("src/v6/family-mcp.ts");
const oauth = read("src/v6/family-oauth.ts");
const index = read("src/index-v6.ts");

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
assert.match(family, /OHLC_MCP_ONLY/);
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

// Family must use the Agents SDK's explicit Durable Object binding option.
// Missing/invalid FAMILY_MCP_OBJECT fails closed; no Proxy remap and no fallback
// to the full MCP_OBJECT/MyMCP namespace is allowed.
assert.match(oauth, /FamilyMCP\.serve\("\/family-mcp", \{ binding: "FAMILY_MCP_OBJECT" \}\)/);
assert.match(oauth, /family_mcp_binding_missing/);
assert.match(oauth, /refusing to fall back to the full MCP_OBJECT namespace/);
assert.doesNotMatch(oauth, /new Proxy\(/);
assert.doesNotMatch(oauth, /if \(property === "MCP_OBJECT"\)/);
assert.doesNotMatch(oauth, /binding: "MCP_OBJECT"/);

assert.match(index, /url\.pathname === "\/my-mcp" \|\| url\.pathname === "\/mcp"/);
assert.match(index, /return MyMCP\.serve\(url\.pathname\)\.fetch/);
assert.match(index, /createFamilyOAuthProvider\(appHandler\)/);
assert.match(index, /family: "FamilyMCP_READ_ONLY_ISOLATED"/);

console.log("Family MCP native-binding isolated read-only surface contract passed");
