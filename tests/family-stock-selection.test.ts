import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const source = read("src/v6/family-stock-selection-v2.ts");
assert.match(source, /FAMILY_STOCK_SELECTION_V2_VERSION = "family-stock-selection\/v2\.0\.0"/);
assert.match(source, /server\.registerTool\("screen_family_swing_candidates"/);
assert.match(source, /z\.enum\(\["stable", "balanced", "aggressive"\]\)/);
assert.match(source, /GREEN_RESEARCH/);
assert.match(source, /YELLOW_WAIT/);
assert.match(source, /RED_SKIP/);
assert.match(source, /家用模式避免追價/);
assert.match(source, /TaiwanStockMonthRevenue/);
assert.match(source, /TaiwanStockPrice/);
assert.match(source, /TaiwanStockInfo/);
assert.match(source, /COMMONSTOCK/);
assert.match(source, /scoreFamilyCandidateV2/);
assert.match(source, /normalizeFinMindMarketSnapshotV2/);
assert.match(source, /FINMIND_FALLBACK/);
assert.match(source, /FUGLE_WITH_FINMIND_FALLBACK/);
assert.match(source, /DATA_UNAVAILABLE/);
assert.match(source, /TECHNICAL_DATA_UNAVAILABLE/);
assert.match(source, /FULL_AVAILABLE_TSE_OTC_SNAPSHOT_FAST_PREFILTER/);
assert.match(source, /BOUNDED_DIVERSIFIED_DAILY_TECHNICAL_SCAN/);
assert.match(source, /TOP_TECHNICAL_MONTHLY_REVENUE_DEEPENING/);
assert.match(source, /NO_VERIFIABLE_ENGINE_RANKING/);
assert.match(source, /Web.*不得.*引擎排名/s);
assert.match(source, /softSubrequestBudget/);
assert.match(source, /diversifiedShortlist/);
assert.match(source, /technicalScanLimit/);
assert.match(source, /revenueScanLimit/);

const index = read("src/index-v6.ts");
assert.match(index, /registerFamilyStockSelectionToolsV2\(this\.server, this\.env\)/);
assert.doesNotMatch(index, /registerFamilyStockSelectionTools\(this\.server, this\.env\)/);
assert.match(index, /handleFamilySmartRest/);
assert.match(index, /family_mcp:/);
assert.match(index, /endpoint: "\/family-mcp"/);
assert.match(index, /V3_ADAPTIVE_SHARED_READ_OPEN_WORLD/);
assert.match(index, /SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS/);
assert.match(index, /owner_market_research_reads: "SHARED_BY_DEFAULT_WHEN_AVAILABLE"/);
assert.match(index, /owner_private_context: "DENY_BY_DEFAULT_UNLESS_EXPLICITLY_SHARED"/);
assert.match(index, /OHLC_READ_SERVICE_STOCK_LIVE_PRIMARY_WITH_FIVE_LEVEL_BOOK/);
assert.match(index, /shared_read_service: "tv-fugle-1d\/OhlcFamilyReadService"/);
assert.match(index, /stock_trade_tape: "RECENT_3_MINUTES_MAX_300_NORMALIZED_PRINTS_NOT_PERSISTED"/);
assert.match(index, /tools: 115/);

const familyMcp = read("src/v6/family-mcp.ts");
assert.match(familyMcp, /registerFamilyStockSelectionToolsV2/);
assert.match(familyMcp, /get_family_stock_market_context/);
assert.match(familyMcp, /OPEN_WORLD_AUTONOMOUS_NO_FIXED_SITE_OR_KEYWORD_LIMIT/);
assert.match(familyMcp, /READ_ONLY_FAMILY_SURFACE/);
assert.match(familyMcp, /github_writes: false/);

const instructions = read("docs/family-custom-gpt-instructions.md");
assert.match(instructions, /必須優先呼叫 MCP 工具 `screen_family_swing_candidates`/);
assert.match(instructions, /好公司不等於現在就是好買點/);
assert.match(instructions, /目前沒有需要追的股票/);

console.log("Family V3 shared-read stock selection and routing contract tests passed");
