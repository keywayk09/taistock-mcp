import assert from "node:assert/strict";
import { finmind } from "../src/v6/common";

const originalFetch = globalThis.fetch;

try {
  const calls: Array<{ authorization: string | null; body: any }> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ authorization: headers.get("authorization"), body });
    if (calls.length === 1) return new Response("Token is illegal.", { status: 400 });
    return Response.json({ data: [{ stock_id: "2330", title: "test" }] });
  }) as typeof fetch;

  const data = await finmind({ FINMIND_TOKEN: "expired-token" } as any, "TaiwanStockNews", { data_id: "2330" });
  assert.deepEqual(data, [{ stock_id: "2330", title: "test" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, "Bearer expired-token");
  assert.equal(calls[1].authorization, null);
  assert.equal(calls[1].body.dataset, "TaiwanStockNews");

  calls.length = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ authorization: headers.get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(calls.length === 1 ? "Token is illegal." : "Permission denied", { status: calls.length === 1 ? 400 : 403 });
  }) as typeof fetch;

  let thrown = "";
  try {
    await finmind({ FINMIND_TOKEN: "expired-token" } as any, "TaiwanStockIndustryChain", {});
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  assert.match(thrown, /FinMind HTTP 403: Permission denied/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].authorization, null);

  console.log("PASS FinMind invalid Bearer falls back anonymously without changing result contract");
} finally {
  globalThis.fetch = originalFetch;
}
