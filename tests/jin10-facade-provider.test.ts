import assert from "node:assert/strict";
import fs from "node:fs";
import { loadJin10MarketBriefContext, loadJin10StockEventContext } from "../src/v6/jin10-facade-provider.ts";

const legacySource = fs.readFileSync("src/index.ts", "utf8");
const advancedSource = fs.readFileSync("src/v6/register.ts", "utf8");
const providerSource = fs.readFileSync("src/v6/jin10-facade-provider.ts", "utf8");
const ownerContent = fs.readFileSync("src/v6/owner-content-handler.ts", "utf8");

// Public ABI stays on already-existing tool names and input schemas.
assert.match(legacySource, /registerTool\(\"get_stock_news\"/);
assert.match(legacySource, /inputSchema:\s*\{\s*symbol:\s*stockSymbol,\s*date:\s*isoDate\.optional\(\),\s*limit:/s);
assert.match(legacySource, /registerTool\(\"explain_price_move\"/);
assert.match(legacySource, /inputSchema:\s*\{\s*symbol:\s*stockSymbol,\s*date:\s*isoDate\.optional\(\),\s*market:\s*marketChoice\.optional\(\)\.default\(\"auto\"\)/s);
assert.match(advancedSource, /registerTool\(\"get_daily_market_brief\"/);
assert.match(advancedSource, /phase:\s*z\.enum\(\[\"pre_market\",\s*\"intraday\",\s*\"post_market\"\]\)/s);

// Internal provider must not register a new MCP action, and Owner must not
// expose the old standalone Jin10 action set.
assert.doesNotMatch(providerSource, /registerTool\(/);
assert.doesNotMatch(providerSource, /JIN10_MCP_TOKEN/);
assert.doesNotMatch(ownerContent, /registerJin10OwnerTools\(this\.server, this\.env\)/);
assert.match(ownerContent, /registerToolThroughJin10Facade/);
assert.match(providerSource, /numeric_symbol_suppressed/);
assert.match(providerSource, /fugle\(/);

const originalFetch = globalThis.fetch;
const calledTools: string[] = [];
const calledKeywords: string[] = [];
let session = 0;
let fugleFailure = false;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330")) {
    if (fugleFailure) {
      return new Response(JSON.stringify({ message: "quote unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      data: {
        symbol: "2330",
        name: "台積電",
        closePrice: 2420,
        previousClose: 2410,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (body?.method === "initialize") {
    session += 1;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-11-25", capabilities: {} } }), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": `session-${session}` },
    });
  }

  if (body?.method === "notifications/initialized") return new Response("", { status: 202 });

  if (body?.method === "tools/call") {
    const tool = String(body?.params?.name || "");
    const keyword = String(body?.params?.arguments?.keyword || "");
    calledTools.push(tool);
    if (keyword) calledKeywords.push(keyword);
    const items = tool === "list_calendar"
      ? [{ pub_time: "2026-08-29T10:00:00+08:00", title: "測試財經日曆", star: 3 }]
      : tool.includes("news")
        ? [{ id: "n1", time: "2026-08-29T09:01:00+08:00", title: "台積電測試新聞" }]
        : [
            { id: "f-old", time: "2026-08-29T08:00:00+08:00", content: "台積電較舊快訊" },
            { id: "f-new", time: "2026-08-29T09:00:00+08:00", content: "台積電較新快訊" },
          ];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { data: { items } } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
};

try {
  const env = { JIN10_MCP_TOKEN: "sk-test-never-return", FUGLE_API_KEY: "fugle-test" } as any;

  const market = await loadJin10MarketBriefContext(env, 5);
  assert.equal(market.ok, true);
  assert.equal(market.mode, "market_brief");
  assert.ok(market.flash.length >= 1);
  assert.equal(market.calendar.length, 1);
  assert.equal(market.persistence, "NONE");

  // A pure numeric Taiwan stock code must be resolved to the company name
  // before Jin10 search. The raw number 2330 must never be used as a keyword.
  const stock = await loadJin10StockEventContext(env, ["2330"], 5);
  assert.equal(stock.ok, true);
  assert.equal(stock.mode, "stock_events");
  assert.ok(stock.flash.length >= 1);
  assert.ok(stock.news.length >= 1);
  assert.equal(stock.persistence, "NONE");
  assert.deepEqual(stock.query_keywords, ["台積電"]);
  assert.equal(stock.entity_resolution?.source, "fugle-quote");
  assert.equal(stock.entity_resolution?.symbol, "2330");
  assert.equal(stock.entity_resolution?.company_name, "台積電");
  assert.equal(stock.entity_resolution?.numeric_symbol_suppressed, true);
  assert.ok(calledKeywords.includes("台積電"));
  assert.ok(!calledKeywords.includes("2330"), "numeric stock code must never be sent to Jin10 search");
  assert.equal((stock.flash[0] as any)?.id, "f-new", "stock flash must be sorted newest first");
  assert.doesNotMatch(JSON.stringify({ market, stock }), /sk-test-never-return/);

  assert.ok(calledTools.includes("list_flash"));
  assert.ok(calledTools.includes("list_calendar"));
  assert.ok(calledTools.includes("search_flash"));
  assert.ok(calledTools.includes("search_news"));

  // If entity resolution fails, fail closed on matching quality: return an
  // explicit partial error and never fall back to the dangerous numeric query.
  const keywordCountBeforeFailure = calledKeywords.length;
  fugleFailure = true;
  const unresolved = await loadJin10StockEventContext(env, ["2330"], 5);
  assert.equal(unresolved.ok, false);
  assert.deepEqual(unresolved.flash, []);
  assert.deepEqual(unresolved.news, []);
  assert.deepEqual(unresolved.query_keywords, []);
  assert.equal(unresolved.entity_resolution?.source, "unresolved");
  assert.equal(unresolved.entity_resolution?.numeric_symbol_suppressed, true);
  assert.match(unresolved.partial_errors[0] ?? "", /^JIN10_ENTITY_NAME_UNRESOLVED/);
  assert.equal(calledKeywords.length, keywordCountBeforeFailure, "unresolved numeric symbol must not trigger Jin10 search");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("jin10-facade-provider: PASS");
