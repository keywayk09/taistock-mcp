import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/v6/shared-stock-market-context-tools.ts", "utf8");
const ownerContent = fs.readFileSync("src/v6/owner-content-handler.ts", "utf8");

for (const tool of [
  "get_stock_market_context",
  "get_stock_trade_tape",
  "get_intraday_trades",
  "get_quote",
]) {
  assert.match(source, new RegExp(`registerTool\\(\\"${tool}\\"`), `${tool} must stay exposed on Owner MCP`);
}

assert.match(source, /readOwnerStockTradeTape/);
assert.match(source, /readFamilyStockMarketContext/);
assert.match(source, /\/intraday\/trades\/\{symbol\}/);
assert.match(source, /不開放原始WebSocket/);
assert.match(source, /persistence:\s*"none"/);
assert.match(ownerContent, /registerSharedStockMarketContextTools\(this\.server, this\.env\)/);

// The compatibility alias must reuse the canonical owner tape reader rather
// than introduce a second Fugle implementation that can drift.
const aliasBlock = source.match(/server\.registerTool\("get_intraday_trades"[\s\S]*?readOwnerStockTradeTape\(env, symbol\)\)\);/)?.[0] ?? "";
assert.ok(aliasBlock.length > 0, "get_intraday_trades must delegate to readOwnerStockTradeTape");
assert.doesNotMatch(aliasBlock, /fetch\(/);

// Live context stays read-only and is never promoted to canonical OHLC.
assert.doesNotMatch(source, /updateGitHubJson|putImmutableGitHubJson|placeOrder|submitOrder|order_placement/);
assert.match(source, /EPHEMERAL_READ_ONLY_CONTEXT_NOT_FORMAL_OHLC/);
assert.match(source, /EPHEMERAL_NORMALIZED_FUGLE_REST_TRADES_NOT_PERSISTED/);

console.log("owner-live-tool-exposure: PASS");
