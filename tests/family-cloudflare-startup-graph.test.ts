import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("src/index-v6.ts", "utf8");
const familyMcp = fs.readFileSync("src/v6/family-mcp.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");

// Cloudflare 10021 regression guard:
// Deep Family V2/V3 modules must not be top-level static imports.
assert.doesNotMatch(index, /^import .*handleFamilySmartRest.*family-smart-rest/m);
assert.doesNotMatch(index, /^import .*registerFamilyStockSelectionToolsV2.*family-stock-selection-v2/m);
assert.match(index, /await import\("\.\/v6\/family-smart-rest"\)/);
assert.match(index, /await import\("\.\/v6\/family-stock-selection-v2"\)/);
assert.match(index, /FAMILY_SMART_REST_PATHS/);
assert.match(index, /startup_graph: "LAZY_DEEP_FAMILY_MODULES"/);

assert.doesNotMatch(familyMcp, /^import .*runSmartFamilyAnalysis.*family-analysis/m);
assert.doesNotMatch(familyMcp, /^import .*registerFamilyStockSelectionToolsV2.*family-stock-selection-v2/m);
assert.match(familyMcp, /await import\("\.\/family-analysis"\)/);
assert.match(familyMcp, /await import\("\.\/family-stock-selection-v2"\)/);
assert.match(familyMcp, /FAMILY_MCP_TOOL_NAMES = \[/);
assert.match(familyMcp, /"family_engine_status"/);
assert.match(familyMcp, /"get_family_stock_market_context"/);
assert.match(familyMcp, /"screen_family_swing_candidates"/);
assert.match(familyMcp, /"get_family_market_chip_summary"/);
assert.match(familyMcp, /"analyze_family_stock"/);
assert.match(familyMcp, /"compare_family_stocks"/);

// The startup fix must not bypass formal source identities or read-only safety.
assert.match(familyMcp, /production_writes: false/);
assert.match(familyMcp, /github_writes: false/);
assert.match(familyMcp, /formal_market_chip: "PUBLISHED_GENERATION_ONLY"/);
assert.match(familyMcp, /formal_ohlc: "EXISTING_TV_FUGLE_1D_GITHUB_CANONICAL_ONLY"/);
assert.match(familyMcp, /FUGLE_REST_READ_ONLY_WITH_FIVE_LEVEL_BOOK_AND_RECENT_TRADES/);
assert.doesNotMatch(wrangler, /"services"\s*:/);

console.log("PASS Family lazy startup graph / cross-account-safe Cloudflare regression contract");
