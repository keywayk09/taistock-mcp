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

// RFC 9728 path-scoped metadata is the only Family protected-resource identity.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      throw new Error("Family path-scoped metadata should be handled by the adapter");
    },
  });
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource/family-mcp`),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}/family-mcp`);
  assert.deepEqual(body.authorization_servers, [ORIGIN]);
  assert.deepEqual(body.scopes_supported, ["family:read"]);
}

// Worker-root and Owner endpoint metadata must never inherit Family identity.
for (const pathname of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/my-mcp",
  "/.well-known/oauth-protected-resource/mcp",
]) {
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      throw new Error("Owner/root metadata must not reach the Family provider");
    },
  });
  const response = await wrapper.fetch(new Request(`${ORIGIN}${pathname}`), env, ctx);
  assert.equal(response.status, 404);
}

// Authorization-server discovery remains the Family authorization server only;
// clients reach it after discovering the explicit /family-mcp protected resource.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(new URL(request.url).pathname, "/.well-known/oauth-authorization-server");
      return Response.json({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/authorize`,
        token_endpoint: `${ORIGIN}/oauth/token`,
        scopes_supported: ["family:read"],
        grant_types_supported: ["authorization_code", "refresh_token"],
      });
    },
  });
  const response = await wrapper.fetch(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body.scopes_supported, ["family:read", "offline_access"]);
}

// OpenID discovery is only a compatibility mirror for the same Family auth server.
{
  let seenPath = "";
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      seenPath = new URL(request.url).pathname;
      return Response.json({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/authorize`,
        token_endpoint: `${ORIGIN}/oauth/token`,
        scopes_supported: ["family:read"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
    },
  });
  const response = await wrapper.fetch(new Request(`${ORIGIN}/.well-known/openid-configuration`), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(seenPath, "/.well-known/oauth-authorization-server");
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body.scopes_supported, ["family:read", "offline_access"]);
  assert.equal((body.scopes_supported as string[]).includes("openid"), false);
}

// Explicit Family resource may be canonicalized (trailing slash only).
{
  let seen = "";
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      seen = request.url;
      return new Response("ok");
    },
  });
  const response = await wrapper.fetch(new Request(authorizeUrl(`${ORIGIN}/family-mcp/`).toString()), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(new URL(seen).searchParams.get("resource"), `${ORIGIN}/family-mcp`);
}

// Retained Family connectors may omit resource during authorize; only at this
// trusted Family authorization boundary is omission defaulted to /family-mcp.
{
  let seen = "";
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      seen = request.url;
      return new Response("ok");
    },
  });
  const response = await wrapper.fetch(new Request(authorizeUrl().toString()), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(new URL(seen).searchParams.get("resource"), `${ORIGIN}/family-mcp`);
}

// Explicit Worker-root and Owner targets are never guessed to be Family.
for (const resource of [ORIGIN, `${ORIGIN}/my-mcp`, `${ORIGIN}/mcp`]) {
  let called = false;
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      called = true;
      return new Response("unexpected");
    },
  });
  const response = await wrapper.fetch(new Request(authorizeUrl(resource).toString()), env, ctx);
  assert.equal(response.status, 400);
  assert.equal(called, false);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.error, "invalid_family_resource");
}

// Hidden authorize POST follows the same explicit Family boundary.
{
  const original = authorizeUrl(`${ORIGIN}/family-mcp/`);
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

// Hidden authorize POST also preserves retained missing-resource compatibility.
{
  const original = authorizeUrl();
  const form = new URLSearchParams({
    oauth_query: original.searchParams.toString(),
    login_secret: "do-not-log-or-change",
  });
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      const forwarded = new URLSearchParams(await request.text());
      const hidden = new URLSearchParams(String(forwarded.get("oauth_query") || ""));
      assert.equal(hidden.get("resource"), `${ORIGIN}/family-mcp`);
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

// Public-client Basic `<client_id>:` normalization remains for explicit Family.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.has("authorization"), false);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("client_id"), CLIENT_ID);
      assert.equal(body.get("resource"), `${ORIGIN}/family-mcp`);
      assert.equal(body.get("code_verifier"), VERIFIER);
      return Response.json({ ok: true });
    },
  });
  const response = await wrapper.fetch(tokenRequest({ resource: `${ORIGIN}/family-mcp/` }), env, ctx);
  assert.equal(response.status, 200);
}

// RFC 8707 resource is optional at token exchange. Missing resource must not be
// guessed or rewritten here; the inner validated grant/provider owns that target.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.has("authorization"), false);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("client_id"), CLIENT_ID);
      assert.equal(body.get("resource"), null);
      return Response.json({ ok: true });
    },
  });
  const response = await wrapper.fetch(tokenRequest(), env, ctx);
  assert.equal(response.status, 200);
}

// Explicit Owner/root token targets fail closed before Family token recovery.
for (const resource of [ORIGIN, `${ORIGIN}/my-mcp`, `${ORIGIN}/mcp`]) {
  let called = false;
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      called = true;
      return new Response("unexpected");
    },
  });
  const response = await wrapper.fetch(tokenRequest({ resource }), env, ctx);
  assert.equal(response.status, 400);
  assert.equal(called, false);
}

// A real confidential Basic secret remains untouched for an explicit Family target.
{
  const originalAuth = tokenRequest({ basicSecret: "real-secret", resource: `${ORIGIN}/family-mcp` }).headers.get("authorization");
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.get("authorization"), originalAuth);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("client_id"), null);
      assert.equal(body.get("resource"), `${ORIGIN}/family-mcp`);
      return new Response("ok");
    },
  });
  await wrapper.fetch(tokenRequest({ basicSecret: "real-secret", resource: `${ORIGIN}/family-mcp` }), env, ctx);
}

// Never transform an untrusted callback; existing inner provider decides it.
{
  const original = tokenRequest({ redirect: "https://evil.example/callback", resource: ORIGIN });
  const originalAuth = original.headers.get("authorization");
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.get("authorization"), originalAuth);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("resource"), ORIGIN);
      return new Response("ok");
    },
  });
  await wrapper.fetch(original, env, ctx);
}

console.log("Family OAuth path-scoped public-client compatibility tests passed");
