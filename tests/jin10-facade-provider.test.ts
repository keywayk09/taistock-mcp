import assert from "node:assert/strict";
import fs from "node:fs";
import { loadJin10MarketBriefContext, loadJin10StockEventContext } from "../src/v6/jin10-facade-provider.ts";

const legacySource = fs.readFileSync("src/index.ts", "utf8");
const advancedSource = fs.readFileSync("src/v6/register.ts", "utf8");
const providerSource = fs.readFileSync("src/v6/jin10-facade-provider.ts", "utf8");

// Public ABI stays on already-existing tool names and input schemas.
assert.match(legacySource, /registerTool\(\"get_stock_news\"/);
assert.match(legacySource, /inputSchema:\s*\{\s*symbol:\s*stockSymbol,\s*date:\s*isoDate\.optional\(\),\s*limit:/s);
assert.match(legacySource, /registerTool\(\"explain_price_move\"/);
assert.match(legacySource, /inputSchema:\s*\{\s*symbol:\s*stockSymbol,\s*date:\s*isoDate\.optional\(\),\s*market:\s*marketChoice\.optional\(\)\.default\(\"auto\"\)/s);
assert.match(advancedSource, /registerTool\(\"get_daily_market_brief\"/);
assert.match(advancedSource, /phase:\s*z\.enum\(\[\"pre_market\",\s*\"intraday\",\s*\"post_market\"\]\)/s);

// Internal provider must not register a new MCP action.
assert.doesNotMatch(providerSource, /registerTool\(/);
assert.doesNotMatch(providerSource, /JIN10_MCP_TOKEN/);

const originalFetch = globalThis.fetch;
let call = 0;
const calledTools: string[] = [];

globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
  call += 1;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (body?.method === "tools/call") calledTools.push(String(body?.params?.name || ""));

  // Every Jin10 helper invocation is 3 requests: initialize, notification, tools/call.
  const phase = ((call - 1) % 3) + 1;
  if (phase === 1) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25", capabilities: {} } }), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": `session-${call}` },
    });
  }
  if (phase === 2) return new Response("", { status: 202 });

  const tool = String(body?.params?.name || "");
  const items = tool === "list_calendar"
    ? [{ pub_time: "2026-08-29T10:00:00+08:00", title: "測試財經日曆", star: 3 }]
    : tool.includes("news")
      ? [{ id: "n1", time: "2026-08-29T09:01:00+08:00", title: "台積電測試新聞" }]
      : [{ id: "f1", time: "2026-08-29T09:00:00+08:00", content: "台積電測試快訊" }];
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { structuredContent: { data: { items } } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

try {
  const env = { JIN10_MCP_TOKEN: "sk-test-never-return" } as any;

  const market = await loadJin10MarketBriefContext(env, 5);
  assert.equal(market.ok, true);
  assert.equal(market.mode, "market_brief");
  assert.equal(market.flash.length, 1);
  assert.equal(market.calendar.length, 1);
  assert.equal(market.persistence, "NONE");

  const stock = await loadJin10StockEventContext(env, ["2330", "台積電"], 5);
  assert.equal(stock.ok, true);
  assert.equal(stock.mode, "stock_events");
  assert.ok(stock.flash.length >= 1);
  assert.ok(stock.news.length >= 1);
  assert.equal(stock.persistence, "NONE");
  assert.doesNotMatch(JSON.stringify({ market, stock }), /sk-test-never-return/);

  assert.deepEqual(calledTools.slice(0, 2), ["list_flash", "list_calendar"]);
  assert.ok(calledTools.includes("search_flash"));
  assert.ok(calledTools.includes("search_news"));
} finally {
  globalThis.fetch = originalFetch;
}

console.log("jin10-facade-provider: PASS");
