import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("src/index-v6.ts", "utf8");
const familyMcp = fs.readFileSync("src/v6/family-mcp.ts", "utf8");

// Cloudflare 10021 regression guard:
// PR #99 LKG deploys successfully with the same current npm dependency resolution.
// Deep Family V2/V3 modules introduced later must not be top-level static imports.
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
assert.match(familyMcp, /"screen_family_swing_candidates"/);
assert.match(familyMcp, /"get_family_market_chip_summary"/);
assert.match(familyMcp, /"analyze_family_stock"/);
assert.match(familyMcp, /"compare_family_stocks"/);

// The startup fix must not bypass formal source identities or read-only safety.
assert.match(familyMcp, /production_writes: false/);
assert.match(familyMcp, /github_writes: false/);
assert.match(familyMcp, /formal_market_chip: "PUBLISHED_GENERATION_ONLY"/);
assert.match(familyMcp, /formal_ohlc: "OHLC_MCP_ONLY"/);

console.log("PASS Family lazy startup graph / Cloudflare 10021 regression contract");
