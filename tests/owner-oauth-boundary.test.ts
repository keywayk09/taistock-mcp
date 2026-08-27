import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFamilyOAuthPublicClientCompatWrapper } from "../src/v6/family-oauth-public-client-compat.ts";

const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const CLIENT_ID = "owner-client-12345";
const REDIRECT_URI = "https://chatgpt.com/connector/oauth/OwnerApp123";
const CHALLENGE = "A".repeat(43);
const VERIFIER = "v".repeat(43);
const ctx = {} as ExecutionContext;
const env = {} as Env;

function authorizeUrl(resource: string) {
  const url = new URL(`${ORIGIN}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code_challenge", CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "owner-state-123");
  url.searchParams.set("scope", "offline_access mcp:tools");
  url.searchParams.set("resource", resource);
  return url;
}

// OWNER_OAUTH_BOUNDARY_V1
// The frozen Owner MCP endpoint has its own RFC 9728 identity. It must never
// disappear merely because the Family OAuth implementation changes.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      throw new Error("Owner protected-resource metadata must be handled by the stable adapter");
    },
  });
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource/my-mcp`),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}/my-mcp`);
  assert.deepEqual(body.authorization_servers, [ORIGIN]);
  assert.deepEqual(body.scopes_supported, ["owner:full"]);
}

// Legacy /mcp remains an Owner alias, never a Family identity.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      throw new Error("Legacy Owner metadata must be handled by the stable adapter");
    },
  });
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(body.scopes_supported, ["owner:full"]);
}

// A trusted ChatGPT Owner authorize request must reach the inner role-aware
// OAuth handler unchanged. The public compatibility adapter may not reject it
// as `invalid_family_resource` and may not rewrite it to /family-mcp.
{
  let seen = "";
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      seen = request.url;
      return new Response("owner-authorize");
    },
  });
  const response = await wrapper.fetch(
    new Request(authorizeUrl(`${ORIGIN}/my-mcp`).toString()),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "owner-authorize");
  assert.equal(new URL(seen).searchParams.get("resource"), `${ORIGIN}/my-mcp`);
}

function tokenRequest(resource: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: "owner:grant-id:authorization-secret",
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT_URI,
    resource,
  });
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  headers.set("authorization", `Basic ${btoa(`${encodeURIComponent(CLIENT_ID)}:`)}`);
  return new Request(`${ORIGIN}/oauth/token`, {
    method: "POST",
    headers,
    body: params.toString(),
  });
}

// Owner token exchange is a valid public-client PKCE path; it must not be
// rejected by a Family-only resource gate.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch(request) {
      assert.equal(request.headers.has("authorization"), false);
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("client_id"), CLIENT_ID);
      assert.equal(body.get("resource"), `${ORIGIN}/my-mcp`);
      return Response.json({ ok: true });
    },
  });
  const response = await wrapper.fetch(tokenRequest(`${ORIGIN}/my-mcp`), env, ctx);
  assert.equal(response.status, 200);
}

// Shared authorization-server discovery may advertise both roles, but the
// protected-resource metadata above remains role-specific.
{
  const wrapper = createFamilyOAuthPublicClientCompatWrapper({
    async fetch() {
      return Response.json({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/authorize`,
        token_endpoint: `${ORIGIN}/oauth/token`,
        scopes_supported: ["family:read", "owner:full"],
      });
    },
  });
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body.scopes_supported, ["family:read", "owner:full", "offline_access"]);
}

// Owner authorization must use the existing Owner secret boundary, not the
// Family secret. MCP_API_KEY already exists in Production and is the fallback
// Owner login identity unless OWNER_OAUTH_LOGIN_SECRET is configured later.
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(here, "../src/v6/family-oauth.ts"), "utf8");
  assert.match(source, /OWNER_SCOPE\s*=\s*["']owner:full["']/);
  assert.match(source, /OWNER_OAUTH_LOGIN_SECRET/);
  assert.match(source, /MCP_API_KEY/);
  assert.match(source, /role:\s*["']owner["']/);
}

console.log("Owner OAuth boundary contract passed");
