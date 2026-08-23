import assert from "node:assert/strict";
import { createFamilyOAuthPublicClientCompatWrapper } from "../src/v6/family-oauth-public-client-compat.ts";

const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const CLIENT_ID = "41i_gRq63zL6r2tO";
const REDIRECT_URI = "https://chatgpt.com/connector/oauth/gDokJPX2DaM_";
const CHALLENGE = "A".repeat(43);
const VERIFIER = "v".repeat(43);
const ctx = {} as ExecutionContext;
const env = {} as Env;

function authorizeUrl(resource?: string) {
  const url = new URL(`${ORIGIN}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code_challenge", CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "state-123");
  url.searchParams.set("scope", "openid profile offline_access mcp:tools");
  if (resource !== undefined) url.searchParams.set("resource", resource);
  return url;
}

// Generic protected-resource metadata must identify the actual isolated Family
// MCP route, not the Worker root.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      throw new Error("generic metadata should be handled by compatibility wrapper");
    },
  });
  const response = await wrapper.fetch(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}/family-mcp`);
  assert.deepEqual(body.authorization_servers, [ORIGIN]);
  assert.deepEqual(body.scopes_supported, ["family:read"]);
}

// Trusted ChatGPT connector authorization normalizes both a retained Worker-root
// resource and a missing resource to the one canonical Family MCP resource.
for (const resource of [ORIGIN, undefined]) {
  let seen = "";
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      seen = request.url;
      return new Response("ok");
    },
  });
  await wrapper.fetch(new Request(authorizeUrl(resource).toString()), env, ctx);
  assert.equal(new URL(seen).searchParams.get("resource"), `${ORIGIN}/family-mcp`);
}

// The hidden authorize POST must receive the same canonical resource while the
// Family login secret field remains opaque and unchanged.
{
  const original = authorizeUrl(ORIGIN);
  const form = new URLSearchParams({
    oauth_query: original.searchParams.toString(),
    login_secret: "do-not-log-or-change",
  });
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      const forwarded = new URLSearchParams(await request.text());
      const hidden = new URLSearchParams(String(forwarded.get("oauth_query") || ""));
      assert.equal(hidden.get("resource"), `${ORIGIN}/family-mcp`);
      assert.equal(forwarded.get("login_secret"), "do-not-log-or-change");
      return new Response("ok");
    },
  });
  const response = await wrapper.fetch(new Request(`${ORIGIN}/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  }), env, ctx);
  assert.equal(response.status, 200);
}

function tokenRequest(options: { basicSecret?: string; resource?: string; redirect?: string } = {}) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: "family:grant-id:authorization-secret",
    code_verifier: VERIFIER,
    redirect_uri: options.redirect ?? REDIRECT_URI,
  });
  if (options.resource !== undefined) params.set("resource", options.resource);
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  const secret = options.basicSecret ?? "";
  headers.set("authorization", `Basic ${btoa(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(secret)}`)}`);
  return new Request(`${ORIGIN}/oauth/token`, {
    method: "POST",
    headers,
    body: params.toString(),
  });
}

// A retained public client serialized as Basic `<client_id>:` is equivalent to
// token_endpoint_auth_method=none. Strip the empty Basic credential, restore
// body client_id, and canonicalize the Family resource. Code/verifier values are
// preserved for the inner strict validation/provider PKCE check.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.has("authorization"), false);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("client_id"), CLIENT_ID);
      assert.equal(body.get("client_secret"), null);
      assert.equal(body.get("resource"), `${ORIGIN}/family-mcp`);
      assert.equal(body.get("code"), "family:grant-id:authorization-secret");
      assert.equal(body.get("code_verifier"), VERIFIER);
      return Response.json({ ok: true });
    },
  });
  const response = await wrapper.fetch(tokenRequest({ resource: ORIGIN }), env, ctx);
  assert.equal(response.status, 200);
}

// A real confidential Basic secret is not converted into a public client. The
// resource identifier may still be canonicalized, but the credential remains
// untouched for the existing token-recovery gate.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.has("authorization"), true);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("client_id"), null);
      assert.equal(body.get("resource"), `${ORIGIN}/family-mcp`);
      return new Response("ok");
    },
  });
  await wrapper.fetch(tokenRequest({ basicSecret: "real-secret", resource: ORIGIN }), env, ctx);
}

// Never rewrite an untrusted callback. This layer is connector compatibility,
// not a generic OAuth request transformer.
{
  const original = tokenRequest({ redirect: "https://evil.example/callback", resource: ORIGIN });
  const originalAuth = original.headers.get("authorization");
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.get("authorization"), originalAuth);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("client_id"), null);
      assert.equal(body.get("resource"), ORIGIN);
      return new Response("ok");
    },
  });
  await wrapper.fetch(original, env, ctx);
}

console.log("Family OAuth public-client compatibility tests passed");
