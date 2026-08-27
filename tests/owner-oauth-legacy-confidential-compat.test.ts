import assert from "node:assert/strict";
import { handleOwnerAuthorize } from "../src/v6/owner-oauth.ts";

const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const REDIRECT = "https://chatgpt.com/connector/oauth/LegacyOwnerCompat123";
const PUBLIC_CLIENT = "publicowner12345";
const BASIC_CLIENT = "basicowner123456";
const POST_CLIENT = "postowner1234567";
const NEW_CLIENT = "newowner12345678";
const UNMARKED_BASIC_CLIENT = "unmarkedbasic123";
const CHALLENGE = "A".repeat(43);

function clientRecord(clientId: string, method: "none" | "client_secret_basic" | "client_secret_post") {
  return JSON.stringify({
    clientId,
    redirectUris: [REDIRECT],
    clientName: `Stored ${method}`,
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: 1,
    tokenEndpointAuthMethod: method,
    authMethodExplicit: true,
    ...(method === "none" ? {} : { clientSecret: "stored-secret-hash" }),
  });
}

function runtimeEnv() {
  let authorization: any = null;
  const writes: Array<[string, string]> = [];
  const records = new Map<string, string>([
    [`client:${PUBLIC_CLIENT}`, clientRecord(PUBLIC_CLIENT, "none")],
    [`client:${BASIC_CLIENT}`, clientRecord(BASIC_CLIENT, "client_secret_basic")],
    [`client:${POST_CLIENT}`, clientRecord(POST_CLIENT, "client_secret_post")],
    [`client:${UNMARKED_BASIC_CLIENT}`, clientRecord(UNMARKED_BASIC_CLIENT, "client_secret_basic")],
  ]);
  const kv = {
    async get(key: string) {
    if (key === `owner-oauth:legacy-confidential:${BASIC_CLIENT}`) return "v1";
    if (key === `owner-oauth:legacy-confidential:${POST_CLIENT}`) return "v1";
    return records.get(key) ?? null;
  },
    async put(key: string, value: string) {
      writes.push([key, value]);
      records.set(key, value);
    },
    async delete(key: string) {
      records.delete(key);
    },
  };
  return {
    env: {
      OAUTH_KV: kv,
      MCP_API_KEY: "owner-secret",
      OAUTH_PROVIDER: {
        async completeAuthorization(input: any) {
          authorization = input;
          return { redirectTo: `${REDIRECT}?code=owner-code&state=owner-state` };
        },
      },
    } as unknown as Env,
    writes,
    getAuthorization: () => authorization,
  };
}

function authorizeUrl(clientId: string, options: { pkce?: boolean; redirect?: string; scope?: string } = {}) {
  const url = new URL(`${ORIGIN}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", options.redirect ?? REDIRECT);
  url.searchParams.set("state", "owner-state");
  url.searchParams.set("scope", options.scope ?? "offline_access mcp:tools");
  url.searchParams.set("resource", `${ORIGIN}/my-mcp`);
  if (options.pkce) {
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", CHALLENGE);
  }
  return url;
}

async function postAuthorize(url: URL, runtime: ReturnType<typeof runtimeEnv>) {
  const form = new FormData();
  form.set("oauth_query", url.searchParams.toString());
  form.set("login_secret", "owner-secret");
  return handleOwnerAuthorize(new Request(`${ORIGIN}/authorize`, { method: "POST", body: form }), runtime.env);
}

// Existing confidential ChatGPT clients are authenticated at the token endpoint
// by their stored client secret. Reconnect must not require PKCE if the exact
// client_id + redirect URI already exist and are confidential.
for (const clientId of [BASIC_CLIENT, POST_CLIENT]) {
  const runtime = runtimeEnv();
  const url = authorizeUrl(clientId);
  const get = await handleOwnerAuthorize(new Request(url), runtime.env);
  assert.equal(get.status, 200, `existing confidential ${clientId} should reach Owner login without PKCE`);
  assert.match(await get.text(), /Owner \/ 鑽石引擎/);

  const post = await postAuthorize(url, runtime);
  assert.equal(post.status, 302, `existing confidential ${clientId} should complete authorization without PKCE`);
  const authorization = runtime.getAuthorization();
  assert.equal(authorization.userId, "owner");
  assert.equal(authorization.props.role, "owner");
  assert.deepEqual(authorization.scope, ["owner:full", "offline_access", "mcp:tools"]);
  assert.equal(authorization.request.resource, `${ORIGIN}/my-mcp`);
  assert.equal(authorization.request.codeChallenge, undefined);
  assert.equal(authorization.request.codeChallengeMethod, undefined);
  assert.equal(runtime.writes.length, 0, "existing confidential client must never be overwritten");
}

// Existing public clients must still use strict PKCE S256.
{
  const runtime = runtimeEnv();
  const get = await handleOwnerAuthorize(new Request(authorizeUrl(PUBLIC_CLIENT)), runtime.env);
  assert.equal(get.status, 400, "public client without PKCE must remain rejected");
}

// Merely existing as a confidential DCR client is not enough. Only clients
// explicitly marked by the pre-deployment Owner-grant migration may use
// the legacy no-PKCE compatibility path.
{
  const runtime = runtimeEnv();
  const get = await handleOwnerAuthorize(new Request(authorizeUrl(UNMARKED_BASIC_CLIENT)), runtime.env);
  assert.equal(get.status, 400, "unmarked confidential client without PKCE must be rejected");
}

// Unknown/new clients may not use the confidential-client compatibility path.
{
  const runtime = runtimeEnv();
  const get = await handleOwnerAuthorize(new Request(authorizeUrl(NEW_CLIENT)), runtime.env);
  assert.equal(get.status, 400, "unknown client without PKCE must be rejected");
  assert.equal(runtime.writes.length, 0);
}

// Public PKCE path remains the preferred modern path.
{
  const runtime = runtimeEnv();
  const get = await handleOwnerAuthorize(new Request(authorizeUrl(PUBLIC_CLIENT, { pkce: true })), runtime.env);
  assert.equal(get.status, 200);
}

// Exact stored redirect identity remains mandatory even for confidential clients.
{
  const runtime = runtimeEnv();
  const different = "https://chatgpt.com/connector/oauth/DifferentOwnerCompat123";
  const get = await handleOwnerAuthorize(new Request(authorizeUrl(BASIC_CLIENT, { redirect: different })), runtime.env);
  assert.notEqual(get.status, 200, "confidential compatibility must not accept redirect drift");
}

// Unknown scope labels remain fail-closed.
{
  const runtime = runtimeEnv();
  const get = await handleOwnerAuthorize(new Request(authorizeUrl(BASIC_CLIENT, { scope: "offline_access mcp:tools family:read" })), runtime.env);
  assert.equal(get.status, 400, "Owner confidential compatibility must never absorb Family scope");
}

console.log("Owner legacy confidential-client compatibility matrix passed");
