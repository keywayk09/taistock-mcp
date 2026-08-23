import assert from "node:assert/strict";
import { createFamilyOAuthLegacyEndpointWrapper } from "../src/v6/family-oauth-legacy-endpoints.ts";

const ctx = {} as ExecutionContext;
const env = {} as Env;

async function capture(request: Request) {
  let seenUrl = "";
  let seenMethod = "";
  let seenBody = "";
  const wrapped = createFamilyOAuthLegacyEndpointWrapper({
    async fetch(inner) {
      seenUrl = inner.url;
      seenMethod = inner.method;
      seenBody = inner.method === "POST" ? await inner.text() : "";
      return Response.json({ ok: true });
    },
  });
  const response = await wrapped.fetch(request, env, ctx);
  assert.equal(response.status, 200);
  return { seenUrl, seenMethod, seenBody };
}

{
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "not-a-real-code",
    code_verifier: "not-a-real-verifier",
  }).toString();
  const result = await capture(new Request("https://example.test/token?compat=1", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }));
  const url = new URL(result.seenUrl);
  assert.equal(url.pathname, "/oauth/token");
  assert.equal(url.searchParams.get("compat"), "1");
  assert.equal(result.seenMethod, "POST");
  assert.equal(result.seenBody, body);
}

{
  const result = await capture(new Request("https://example.test/register", {
    method: "OPTIONS",
  }));
  assert.equal(new URL(result.seenUrl).pathname, "/oauth/register");
  assert.equal(result.seenMethod, "OPTIONS");
}

{
  const result = await capture(new Request("https://example.test/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=authorization_code",
  }));
  assert.equal(new URL(result.seenUrl).pathname, "/oauth/token");
}

{
  const result = await capture(new Request("https://example.test/family-mcp", {
    method: "POST",
    body: "{}",
  }));
  assert.equal(new URL(result.seenUrl).pathname, "/family-mcp");
}

console.log("Family legacy OAuth endpoint alias tests passed");
