import assert from "node:assert/strict";
import { handleOwnerAuthorize } from "../src/v6/owner-oauth.ts";

const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const CLIENT_ID = "owner-scope-client-12345";
const REDIRECT_URI = "https://chatgpt.com/connector/oauth/OwnerScopeRoundtrip123";
const CHALLENGE = "A".repeat(43);

function authorizeUrl(scope: string) {
  const url = new URL(`${ORIGIN}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code_challenge", CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "owner-scope-state-123");
  url.searchParams.set("scope", scope);
  url.searchParams.set("resource", `${ORIGIN}/my-mcp`);
  return url;
}

function runtimeEnv() {
  let authorization: any = null;
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  const oauthProvider = {
    async completeAuthorization(input: any) {
      authorization = input;
      return { redirectTo: `${REDIRECT_URI}?code=owner-code&state=owner-scope-state-123` };
    },
  };
  return {
    env: {
      OAUTH_KV: kv,
      OAUTH_PROVIDER: oauthProvider,
      MCP_API_KEY: "owner-secret",
    } as unknown as Env,
    getAuthorization: () => authorization,
  };
}

// Retained ChatGPT Apps may still request the historical OIDC-style transport
// scopes in addition to MCP compatibility scopes. These labels are round-tripped
// for connector compatibility only; owner:full remains the mandatory internal
// authorization scope enforced by /my-mcp.
{
  const runtime = runtimeEnv();
  const original = authorizeUrl("openid profile offline_access mcp:tools");
  const form = new FormData();
  form.set("oauth_query", original.searchParams.toString());
  form.set("login_secret", "owner-secret");

  const response = await handleOwnerAuthorize(new Request(`${ORIGIN}/authorize`, {
    method: "POST",
    body: form,
  }), runtime.env);

  assert.equal(response.status, 302);
  const authorization = runtime.getAuthorization();
  assert.deepEqual(authorization.scope, ["owner:full", "openid", "profile", "offline_access", "mcp:tools"]);
  assert.deepEqual(authorization.request.scope, ["owner:full", "openid", "profile", "offline_access", "mcp:tools"]);
  assert.equal(authorization.props.role, "owner");
  assert.equal(authorization.request.resource, `${ORIGIN}/my-mcp`);
}

// Current MCP-only ChatGPT requests remain supported as before.
{
  const runtime = runtimeEnv();
  const original = authorizeUrl("offline_access mcp:tools");
  const form = new FormData();
  form.set("oauth_query", original.searchParams.toString());
  form.set("login_secret", "owner-secret");

  const response = await handleOwnerAuthorize(new Request(`${ORIGIN}/authorize`, {
    method: "POST",
    body: form,
  }), runtime.env);

  assert.equal(response.status, 302);
  const authorization = runtime.getAuthorization();
  assert.deepEqual(authorization.scope, ["owner:full", "offline_access", "mcp:tools"]);
}

// Do not reflect arbitrary scope labels into a token. Compatibility is an
// explicit Owner-only allowlist, not a generic scope echo mechanism.
for (const scope of [
  "offline_access mcp:tools unexpected:admin",
  "openid profile email offline_access mcp:tools",
  "family:read offline_access mcp:tools",
]) {
  const runtime = runtimeEnv();
  const response = await handleOwnerAuthorize(new Request(authorizeUrl(scope).toString()), runtime.env);
  assert.equal(response.status, 400, `unsupported Owner scope must fail closed: ${scope}`);
}

console.log("Owner OAuth ChatGPT scope round-trip contract passed");