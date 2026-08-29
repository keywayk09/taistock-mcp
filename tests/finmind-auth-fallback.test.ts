import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { finmind as v6Finmind } from "../src/v6/common.ts";

const originalFetch = globalThis.fetch;
try {
  const calls: Array<string | null> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    calls.push(auth);
    if (calls.length === 1) return Response.json({ msg: "Token is illegal." }, { status: 400 });
    return Response.json({ data: [{ stock_id: "2330", title: "test" }] });
  }) as typeof fetch;
  const data = await v6Finmind({ FINMIND_TOKEN: "expired-token" } as any, "TaiwanStockNews", { data_id: "2330" });
  assert.equal(data.length, 1);
  assert.deepEqual(calls, ["Bearer expired-token", null]);

  calls.length = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    calls.push(auth);
    if (auth) return new Response("Token is illegal.", { status: 400 });
    return new Response("Permission denied", { status: 403 });
  }) as typeof fetch;
  let thrown = "";
  try {
    await v6Finmind({ FINMIND_TOKEN: "expired-token" } as any, "TaiwanStockIndustryChain", {});
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  assert.match(thrown, /403: Permission denied/);
  assert.deepEqual(calls, ["Bearer expired-token", null]);

  const legacy = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const start = legacy.indexOf("export async function finmind(env: Env, dataset: string, params: Obj)");
  const end = legacy.indexOf("\nasync function broker", start);
  assert.ok(start >= 0 && end > start, "legacy Owner finmind function must be exportable for contract inspection");
  const block = legacy.slice(start, end);
  assert.match(block, /const token = String\(env\.FINMIND_TOKEN \?\? ""\)\.trim\(\)/);
  assert.match(block, /body = await request\(Boolean\(token\)\)/);
  assert.match(block, /body = await request\(false\)/);
  assert.match(block, /FINMIND_AUTH_FALLBACK dataset=\$\{dataset\} reason=TOKEN_INVALID/);
  assert.doesNotMatch(block, /FINMIND_TOKEN 尚未設定/);
  assert.match(block, /Permission|Backer|Sponsor|request\(false\)|throw error/);

  console.log("PASS FinMind fallback: v6 behavior + legacy Owner source contract");
} finally {
  globalThis.fetch = originalFetch;
}
