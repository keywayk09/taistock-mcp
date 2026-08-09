import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const source = read("src/v6/family-stock-selection.ts");
assert.match(source, /FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection\/v1\.0\.0"/);
assert.match(source, /server\.registerTool\("screen_family_swing_candidates"/);
assert.match(source, /z\.enum\(\["stable", "balanced", "aggressive"\]\)/);
assert.match(source, /GREEN_RESEARCH/);
assert.match(source, /YELLOW_WAIT/);
assert.match(source, /RED_SKIP/);
assert.match(source, /家用模式避免追價/);
assert.match(source, /此家用選股結果不寫入Diamond GPT Judgment\/Trading Knowledge/);
assert.match(source, /snapshotShortlist/);
assert.match(source, /technicalShortlist/);
assert.match(source, /TaiwanStockMonthRevenue/);
assert.match(source, /TaiwanStockPrice/);
assert.match(source, /COMMONSTOCK/);
assert.match(source, /scoreFamilyCandidate/);

const index = read("src/index-v6.ts");
assert.match(index, /registerFamilyStockSelectionTools\(this\.server, this\.env\)/);
assert.match(index, /version: "6\.15\.0"/);
assert.match(index, /tools: 106/);

const instructions = read("docs/family-custom-gpt-instructions.md");
assert.match(instructions, /必須優先呼叫 MCP 工具 `screen_family_swing_candidates`/);
assert.match(instructions, /好公司不等於現在就是好買點/);
assert.match(instructions, /目前沒有需要追的股票/);

console.log("P17 family stock selection contract/regression tests passed");
