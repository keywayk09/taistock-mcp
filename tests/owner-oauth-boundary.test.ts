import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFamilyOAuthPublicClientCompatWrapper } from "../src/v6/family-oauth-public-client-compat.ts";
import { handleOwnerAuthorize } from "../src/v6/owner-oauth.ts";

const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const OWNER_AUTHORIZATION_SERVER = "https://taistock-owner-oauth.keywayk09.workers.dev";
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
  assert.deepEqual(body.authorization_servers, [OWNER_AUTHORIZATION_SERVER]);
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
  assert.deepEqual(body.authorization_servers, [OWNER_AUTHORIZATION_SERVER]);
  assert.deepEqual(body.scopes_supported, ["owner:full"]);
}

// A trusted ChatGPT Owner authorize request must reach the inner role-aware
// OAuth handler unchanged. The public adapter may not rewrite it to Family.
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
// rejected by the Family compatibility layer.
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

// Shared authorization-server discovery advertises both roles; each protected
// resource above still exposes only its own scope.
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

function runtimeEnv(options: { existingClient?: boolean } = {}) {
  const writes: Array<[string, string]> = [];
  let authorization: any = null;
  const clientRecord = JSON.stringify({
    clientId: CLIENT_ID,
    redirectUris: [REDIRECT_URI],
    clientName: "Retained ChatGPT MCP App",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: 1,
    tokenEndpointAuthMethod: "none",
    authMethodExplicit: true,
  });
  const kv = {
    async get(key: string) {
      if (key === `client:${CLIENT_ID}` && options.existingClient) return clientRecord;
      return null;
    },
    async put(key: string, value: string) {
      writes.push([key, value]);
    },
    async delete() {},
  };
  const oauthProvider = {
    async completeAuthorization(input: any) {
      authorization = input;
      return { redirectTo: `${REDIRECT_URI}?code=owner-code&state=owner-state-123` };
    },
  };
  return {
    env: {
      OAUTH_KV: kv,
      OAUTH_PROVIDER: oauthProvider,
      MCP_API_KEY: "owner-secret",
    } as unknown as Env,
    writes,
    getAuthorization: () => authorization,
  };
}

// GET is read-only and renders the dedicated Owner page. It must not silently
// create or mutate an OAuth client before the Owner secret is proven.
{
  const runtime = runtimeEnv();
  const response = await handleOwnerAuthorize(
    new Request(authorizeUrl(`${ORIGIN}/my-mcp`).toString()),
    runtime.env,
  );
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Owner \/ 鑽石引擎/);
  assert.match(page, /Owner 連線驗證碼/);
  assert.equal(runtime.writes.length, 0);
}

// POST with the existing Owner secret creates/reuses only the public connector
// registration. owner:full remains mandatory, while known ChatGPT compatibility
// scopes are round-tripped so the connector does not report partial permission.
{
  const runtime = runtimeEnv();
  const original = authorizeUrl(`${ORIGIN}/my-mcp`);
  const form = new FormData();
  form.set("oauth_query", original.searchParams.toString());
  form.set("login_secret", "owner-secret");
  const response = await handleOwnerAuthorize(new Request(`${ORIGIN}/authorize`, {
    method: "POST",
    body: form,
  }), runtime.env);
  assert.equal(response.status, 302);
  const authorization = runtime.getAuthorization();
  assert.equal(authorization.userId, "owner");
  assert.deepEqual(authorization.scope, ["owner:full", "offline_access", "mcp:tools"]);
  assert.equal(authorization.props.role, "owner");
  assert.deepEqual(authorization.request.scope, ["owner:full", "offline_access", "mcp:tools"]);
  assert.equal(authorization.request.resource, `${ORIGIN}/my-mcp`);
  assert.equal(runtime.writes.some(([key]) => key === `client:${CLIENT_ID}`), true);
}

// A retained compatible public client may be reused only after the Owner secret
// succeeds; its old display name does not grant Owner authority by itself.
{
  const runtime = runtimeEnv({ existingClient: true });
  const original = authorizeUrl(`${ORIGIN}/my-mcp`);
  const form = new FormData();
  form.set("oauth_query", original.searchParams.toString());
  form.set("login_secret", "owner-secret");
  const response = await handleOwnerAuthorize(new Request(`${ORIGIN}/authorize`, {
    method: "POST",
    body: form,
  }), runtime.env);
  assert.equal(response.status, 302);
  assert.equal(runtime.writes.some(([key]) => key === `client:${CLIENT_ID}`), false);
  assert.equal(runtime.getAuthorization().props.role, "owner");
}

// Owner authorization uses its own existing secret boundary, not the Family
// secret. Production currently has MCP_API_KEY, so no new secret is required.
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ownerSource = fs.readFileSync(path.resolve(here, "../src/v6/owner-oauth.ts"), "utf8");
  const familySource = fs.readFileSync(path.resolve(here, "../src/v6/family-oauth.ts"), "utf8");
  assert.match(ownerSource, /OWNER_SCOPE\s*=\s*["']owner:full["']/);
  assert.match(ownerSource, /OWNER_OAUTH_LOGIN_SECRET \|\| env\.MCP_API_KEY/);
  assert.match(ownerSource, /role:\s*["']owner["']/);
  assert.match(familySource, /isOwnerAuthorizeRequest/);
  assert.match(familySource, /handleOwnerAuthorize/);
  assert.match(familySource, /scopesSupported: \[FAMILY_SCOPE, OWNER_SCOPE\]/);
}

console.log("Owner OAuth boundary contract passed");
