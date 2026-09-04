import assert from "node:assert/strict";
import fs from "node:fs";

const tools = fs.readFileSync("src/v6/tw-market-data-tools.ts", "utf8");
const ownerContent = fs.readFileSync("src/v6/owner-content-handler.ts", "utf8");
const familyInstructions = fs.readFileSync("docs/family-custom-gpt-instructions.md", "utf8");
const onDemandFacade = fs.readFileSync("src/v6/tw-market-chip-on-demand-facade.ts", "utf8");

assert.match(tools, /server\.registerTool\("get_family_market_chip_summary"/);
// Frozen metadata label is retained for old clients; the explicit provider field
// and actual tool implementation define current behavior.
assert.match(tools, /family_access:\s*"READ_ONLY_PUBLISHED_GENERATION"/);
assert.match(tools, /family_current_provider:\s*"EXACT_DATE_OFFICIAL_ON_DEMAND_READ_ONLY"/);
assert.match(tools, /family_market_data_write:\s*"FORBIDDEN"/);
assert.match(tools, /history_window_calendar_days:\s*180/);
assert.match(tools, /calendar_days:[\s\S]*max\(180\)/);
assert.match(tools, /get_family_market_chip_summary[\s\S]*最多180自然日/);
assert.match(tools, /get_family_market_chip_summary[\s\S]*getTwMarketChipSummaryOnDemand\(env, input\)/);
assert.match(onDemandFacade, /getTwMarketChipSummaryPublished as getLegacyPublishedSummary/);
assert.match(onDemandFacade, /formal `market-data-published-gateway` remains untouched/);
assert.match(onDemandFacade, /HISTORY_CONTEXT_ONLY/);
assert.doesNotMatch(tools.match(/server\.registerTool\("get_family_market_chip_summary"[\s\S]*?\n\s*server\.registerTool/)?.[0] ?? "", /getTwMarketChipSummaryFast/);
assert.match(ownerContent, /registerTwMarketDataTools\(this\.server, this\.env\)/);
assert.match(familyInstructions, /get_family_market_chip_summary/);
assert.match(familyInstructions, /TWSE \/ TPEx exact-date on-demand/);
assert.match(familyInstructions, /Published generation[^\n]*(?:歷史|history|replay)/i);
assert.match(familyInstructions, /MoneyDJ[^\n]*RANKED_ONLY|RANKED_ONLY[^\n]*MoneyDJ/i);
assert.match(familyInstructions, /FinMind Token[^\n]*(?:不得|不是|不依賴)/i);
assert.match(familyInstructions, /最多\s*180\s*自然日/);
assert.match(familyInstructions, /Family[^\n]*(?:READ-ONLY|唯讀)/i);
assert.match(familyInstructions, /OHLC[^\n]*OHLC MCP/);

console.log("PASS family GPT read-only current on-demand + Published-history 180d compatibility contract");
