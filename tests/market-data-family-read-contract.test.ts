import assert from "node:assert/strict";
import fs from "node:fs";

const tools = fs.readFileSync("src/v6/tw-market-data-tools.ts", "utf8");
const ownerContent = fs.readFileSync("src/v6/owner-content-handler.ts", "utf8");
const familyInstructions = fs.readFileSync("docs/family-custom-gpt-instructions.md", "utf8");

assert.match(tools, /server\.registerTool\("get_family_market_chip_summary"/);
assert.match(tools, /family_access:\s*"READ_ONLY_PUBLISHED_GENERATION"/);
assert.match(tools, /family_market_data_write:\s*"FORBIDDEN"/);
assert.match(tools, /history_window_calendar_days:\s*180/);
assert.match(tools, /calendar_days:[\s\S]*max\(180\)/);
assert.match(tools, /get_family_market_chip_summary[\s\S]*最多180自然日/);
assert.match(tools, /get_family_market_chip_summary[\s\S]*getTwMarketChipSummaryPublished\(env, input\)/);
assert.doesNotMatch(tools.match(/server\.registerTool\("get_family_market_chip_summary"[\s\S]*?\n\s*server\.registerTool/)?.[0] ?? "", /getTwMarketChipSummaryFast/);
assert.match(ownerContent, /registerTwMarketDataTools\(this\.server, this\.env\)/);
assert.match(familyInstructions, /get_family_market_chip_summary/);
assert.match(familyInstructions, /正式[^\n]*Published generation/i);
assert.match(familyInstructions, /Published generation[^\n]*(?:只認|只讀|正式)/i);
assert.match(familyInstructions, /最多\s*180\s*自然日/);
assert.match(familyInstructions, /Family[^\n]*(?:READ-ONLY|唯讀)/i);
assert.match(familyInstructions, /OHLC[^\n]*OHLC MCP/);

console.log("PASS family GPT read-only Published market-data 180d identity/retention contract");
