import assert from "node:assert/strict";
import fs from "node:fs";
import { fetchJin10OwnerData, JIN10_OWNER_TOOL_NAMES } from "../src/v6/jin10-owner-tools.ts";

const source = fs.readFileSync("src/v6/jin10-owner-tools.ts", "utf8");
const ownerContent = fs.readFileSync("src/v6/owner-content-handler.ts", "utf8");
const familyContent = fs.readFileSync("src/v6/family-content-handler.ts", "utf8");

assert.deepEqual([...JIN10_OWNER_TOOL_NAMES], [
  "jin10_latest_flash",
  "jin10_search_flash",
  "jin10_latest_news",
  "jin10_search_news",
  "jin10_calendar",
]);

for (const tool of JIN10_OWNER_TOOL_NAMES) {
  assert.match(source, new RegExp(`registerTool\\(\\"${tool}\\"`), `${tool} must be registered`);
}

assert.match(ownerContent, /registerJin10OwnerTools\(this\.server, this\.env\)/);
assert.doesNotMatch(familyContent, /registerJin10OwnerTools|jin10_/i, "Jin10 tools must stay Owner-only");
assert.doesNotMatch(source, /registerTool\(\"(?:get_quote|get_kline)\"/, "Jin10 quote/K-line tools must not be exposed");
assert.doesNotMatch(source, /updateGitHub|putImmutable|R2|\.put\(/, "Jin10 read plane must not persist data");
assert.match(source, /JIN10_MCP_TOKEN/);
assert.match(source, /token_returned:\s*false/);
assert.match(source, /structuredContent/);

const originalFetch = globalThis.fetch;
const requests: Array<{ body: any; headers: Headers }> = [];
let call = 0;

globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
  call += 1;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const headers = new Headers(init?.headers);
  requests.push({ body, headers });

  if (call === 1) {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-11-25", capabilities: {} },
    }), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": "session-test" },
    });
  }

  if (call === 2) {
    return new Response("", { status: 202 });
  }

  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    result: {
      structuredContent: {
        data: {
          items: [
            { id: "a", time: "2026-08-29T09:00:00+08:00", title: "", content: "測試快訊一" },
            { id: "b", time: "2026-08-29T08:59:00+08:00", title: "測試二", content: "測試快訊二" },
          ],
          next_cursor: "cursor-2",
          has_more: true,
        },
      },
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const env = { JIN10_MCP_TOKEN: "sk-test-secret-never-return" } as any;
  const result = await fetchJin10OwnerData(env, {
    tool: "search_flash",
    arguments: { keyword: "美聯儲" },
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "jin10-mcp");
  assert.equal(result.returned, 1);
  assert.equal(result.token_returned, false);
  assert.equal(result.persistence, "NONE");
  assert.equal((result.items as any[])[0]?.summary, "測試快訊一", "blank title must fall back to content summary");
  assert.equal(result.next_cursor, "cursor-2");
  assert.equal(result.has_more, true);

  assert.equal(requests.length, 3, "one tool invocation should initialize, notify, then call exactly once");
  assert.equal(requests[0]?.body?.method, "initialize");
  assert.equal(requests[1]?.body?.method, "notifications/initialized");
  assert.equal(requests[2]?.body?.method, "tools/call");
  assert.equal(requests[2]?.body?.params?.name, "search_flash");
  assert.deepEqual(requests[2]?.body?.params?.arguments, { keyword: "美聯儲" });
  assert.equal(requests[2]?.headers.get("mcp-session-id"), "session-test");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer sk-test-secret-never-return");
  assert.doesNotMatch(JSON.stringify(result), /sk-test-secret-never-return/, "token must never appear in tool result");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("jin10-owner-tools: PASS");
