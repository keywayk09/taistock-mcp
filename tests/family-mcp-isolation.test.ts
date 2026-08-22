import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const family = read("src/v6/family-mcp.ts");
const index = read("src/index-v6.ts");

for (const tool of [
  "family_engine_status",
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

assert.match(index, /if \(url\.pathname === "\/mcp"\) return MyMCP\.serve/);
assert.match(index, /createFamilyOAuthProvider\(appHandler\)/);
assert.match(index, /family: "FamilyMCP_READ_ONLY_ISOLATED"/);

console.log("Family MCP isolated read-only surface contract passed");
