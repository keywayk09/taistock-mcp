import assert from "node:assert/strict";
import { registerToolThroughJin10Facade } from "../src/v6/jin10-facade-middleware.ts";

const originalFetch = globalThis.fetch;
const calledTools: string[] = [];
const calledKeywords: string[] = [];
let session = 0;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330")) {
    return new Response(JSON.stringify({
      data: { symbol: "2330", name: "台積電", closePrice: 2420, previousClose: 2410 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (body?.method === "initialize") {
    session += 1;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: { protocolVersion: "2025-11-25", capabilities: {} },
    }), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": `session-${session}` },
    });
  }

  if (body?.method === "notifications/initialized") {
    return new Response("", { status: 202 });
  }

  if (body?.method === "tools/call") {
    const tool = String(body?.params?.name || "");
    const keyword = String(body?.params?.arguments?.keyword || "");
    calledTools.push(tool);
    if (keyword) calledKeywords.push(keyword);
    const items = tool === "search_news"
      ? [{ id: "n1", time: "2026-08-29T09:01:00+08:00", title: "台积电测试新闻" }]
      : [{ id: "f1", time: "2026-08-29T09:00:00+08:00", content: "台积电测试快讯" }];
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: { structuredContent: { data: { items } } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
};

try {
  let captured: { name: string; args: any[] } | null = null;
  const server = {};
  const originalRegisterTool = function (name: string, ...args: any[]) {
    captured = { name, args };
    return "registered";
  };

  const schema = {
    description: "legacy stock news",
    inputSchema: { symbol: "unchanged-schema-marker", limit: "unchanged-limit-marker" },
  };
  const legacyHandler = async () => ({
    content: [{ type: "text", text: JSON.stringify({ source: "FinMind", symbol: "2330", data: [{ title: "原新聞" }] }) }],
  });

  const registered = registerToolThroughJin10Facade(
    originalRegisterTool,
    server,
    { JIN10_MCP_TOKEN: "sk-test-never-return", FUGLE_API_KEY: "fugle-test" } as any,
    "get_stock_news",
    [schema, legacyHandler],
  );

  assert.equal(registered, "registered");
  assert.ok(captured);
  assert.equal(captured!.name, "get_stock_news");
  assert.strictEqual(captured!.args[0], schema, "existing public schema object must pass through untouched");
  assert.notStrictEqual(captured!.args[1], legacyHandler, "target handler should be wrapped internally");

  const enriched = await captured!.args[1]({ symbol: "2330", limit: 5 });
  const payload = JSON.parse(enriched.content[0].text);
  assert.equal(payload.source, "FinMind", "legacy payload must remain intact");
  assert.equal(payload.data[0].title, "原新聞");
  assert.equal(payload.jin10_context.provider, "jin10-mcp");
  assert.equal(payload.jin10_context.mode, "stock_events");
  assert.equal(payload.jin10_context.persistence, "NONE");
  assert.equal(payload.jin10_context.flash.length, 1);
  assert.equal(payload.jin10_context.news.length, 1);
  assert.deepEqual(payload.jin10_context.query_keywords, ["台积电"]);
  assert.equal(payload.jin10_context.entity_resolution.company_name, "台積電");
  assert.ok(calledTools.includes("search_flash"));
  assert.ok(calledTools.includes("search_news"));
  assert.ok(calledKeywords.includes("台积电"));
  assert.ok(!calledKeywords.includes("台積電"));
  assert.ok(!calledKeywords.includes("2330"));
  assert.doesNotMatch(JSON.stringify(payload), /sk-test-never-return/);

  // Missing Jin10 configuration is fail-open for the existing facade: the base
  // tool still succeeds and receives an explicit provider-local partial error.
  captured = null;
  registerToolThroughJin10Facade(
    originalRegisterTool,
    server,
    {} as any,
    "explain_price_move",
    [schema, async () => ({ content: [{ type: "text", text: JSON.stringify({ symbol: "2330", quote: { close: 100 } }) }] })],
  );
  const noToken = await captured!.args[1]({ symbol: "2330" });
  const noTokenPayload = JSON.parse(noToken.content[0].text);
  assert.equal(noTokenPayload.quote.close, 100);
  assert.equal(noTokenPayload.jin10_context.ok, false);
  assert.ok(noTokenPayload.jin10_context.partial_errors.includes("JIN10_MCP_TOKEN_NOT_CONFIGURED"));

  // A base-provider failure must remain an MCP error, but it must not suppress
  // independently fetched Jin10 evidence. This is the production regression
  // caught when FinMind returned HTTP 400 / Token is illegal.
  captured = null;
  const finmindErrorText = "查詢失敗：FinMind HTTP 400: Token is illegal.";
  registerToolThroughJin10Facade(
    originalRegisterTool,
    server,
    { JIN10_MCP_TOKEN: "sk-test-never-return", FUGLE_API_KEY: "fugle-test" } as any,
    "get_stock_news",
    [schema, async () => ({ isError: true, content: [{ type: "text", text: finmindErrorText }] })],
  );
  const baseFailed = await captured!.args[1]({ symbol: "2330", limit: 5 });
  assert.equal(baseFailed.isError, true, "base provider error semantics must remain authoritative");
  assert.equal(baseFailed.content[0].text, finmindErrorText, "original provider error text must be preserved exactly");
  const baseFailedContext = JSON.parse(baseFailed.content[1].text).jin10_context;
  assert.equal(baseFailedContext.provider, "jin10-mcp");
  assert.equal(baseFailedContext.mode, "stock_events");
  assert.equal(baseFailedContext.persistence, "NONE");
  assert.equal(baseFailedContext.flash.length, 1);
  assert.equal(baseFailedContext.news.length, 1);
  assert.deepEqual(baseFailedContext.query_keywords, ["台积电"]);
  assert.equal(baseFailedContext.entity_resolution.company_name, "台積電");
  assert.equal(baseFailed.structuredContent.jin10_context.provider, "jin10-mcp");
  assert.doesNotMatch(JSON.stringify(baseFailed), /sk-test-never-return/);

  // Non-target tools must be registered with the exact original handler.
  captured = null;
  const quoteHandler = async () => ({ content: [] });
  registerToolThroughJin10Facade(originalRegisterTool, server, {} as any, "get_quote", [schema, quoteHandler]);
  assert.strictEqual(captured!.args[1], quoteHandler);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("jin10-facade-middleware: PASS");
