import assert from "node:assert/strict";
import fs from "node:fs";

const tools = fs.readFileSync("src/v6/tw-market-data-tools.ts", "utf8");
const entrypoint = fs.readFileSync("src/index-v6.ts", "utf8");
const familyInstructions = fs.readFileSync("docs/family-custom-gpt-instructions.md", "utf8");

assert.match(tools, /server\.registerTool\("get_family_market_chip_summary"/);
assert.match(tools, /family_access:\s*"READ_ONLY_PUBLISHED_GENERATION"/);
assert.match(tools, /family_market_data_write:\s*"FORBIDDEN"/);
assert.match(tools, /get_family_market_chip_summary[\s\S]*getTwMarketChipSummaryPublished\(env, input\)/);
assert.doesNotMatch(tools.match(/server\.registerTool\("get_family_market_chip_summary"[\s\S]*?\n\s*server\.registerTool/)?.[0] ?? "", /getTwMarketChipSummaryFast/);
assert.match(entrypoint, /registerTwMarketDataTools\(this\.server, this\.env\)/);
assert.match(familyInstructions, /get_family_market_chip_summary/);
assert.match(familyInstructions, /正式 published generation/);

console.log("PASS family GPT read-only published market-data contract");
