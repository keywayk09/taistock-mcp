import assert from "node:assert/strict";
import { createFamilyOAuthTokenRecoveryWrapper } from "../src/v6/family-oauth-token-recovery.ts";

const CLIENT_ID = "41i_gRq63zL6r2tO";
const REDIRECT_URI = "https://chatgpt.com/connector/oauth/gDokJPX2DaM_";
const CODE = "family:grant-test-1:authorization-secret";
const CLIENT_SECRET = "retained-chatgpt-client-secret";
const PKCE_CHALLENGE = "A".repeat(43);

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class FakeKv {
  values = new Map<string, string>();

  async get<T = string>(key: string, options?: { type?: string }): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    if (options?.type === "json") return JSON.parse(value) as T;
    return value;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }
}

async function makeEnv() {
  const kv = new FakeKv();
  kv.values.set(`client:${CLIENT_ID}`, JSON.stringify({
    clientId: CLIENT_ID,
    redirectUris: [REDIRECT_URI],
    clientName: "ChatGPT Family Plugin / MCP App",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: Math.floor(Date.now() / 1000),
    tokenEndpointAuthMethod: "none",
    authMethodExplicit: true,
  }));
  kv.values.set("grant:family:grant-test-1", JSON.stringify({
    id: "grant-test-1",
    clientId: CLIENT_ID,
    userId: "family",
    scope: ["family:read"],
    authCodeId: await sha256Hex(CODE),
    authCodeWrappedKey: "present-unconsumed-code-key",
    codeChallenge: PKCE_CHALLENGE,
    codeChallengeMethod: "S256",
    redirectUri: REDIRECT_URI,
  }));
  return { OAUTH_KV: kv } as unknown as Env;
}

function tokenRequest(options: { basic?: boolean; secret?: string; scope?: string; publicClient?: boolean } = {}) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: REDIRECT_URI,
    code_verifier: "verifier-not-used-by-wrapper",
  });
  if (options.scope !== undefined) params.set("scope", options.scope);
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (options.basic) {
    headers.set("authorization", `Basic ${btoa(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(options.secret || CLIENT_SECRET)}`)}`);
  } else {
    params.set("client_id", CLIENT_ID);
    if (!options.publicClient) params.set("client_secret", options.secret || CLIENT_SECRET);
  }
  return new Request("https://taistock-mcp.keywayk09.workers.dev/oauth/token", {
    method: "POST",
    headers,
    body: params.toString(),
  });
}

const noopCtx = {} as ExecutionContext;

// Confidential DCR recovery: learn the retained secret only after the exact
// Family grant/code is proven, normalize transport scopes, then keep the
// learned SHA-256 secret on provider success.
{
  const env = await makeEnv();
  let seen = false;
  const wrapper = createFamilyOAuthTokenRecoveryWrapper({
    async fetch(request, innerEnv) {
      seen = true;
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("scope"), "family:read");
      const raw = await (innerEnv.OAUTH_KV as unknown as FakeKv).get(`client:${CLIENT_ID}`) as string;
      const stored = JSON.parse(raw);
      assert.equal(stored.tokenEndpointAuthMethod, "client_secret_basic");
      assert.equal(stored.clientSecret, await sha256Hex(CLIENT_SECRET));
      assert.equal(stored.recoveryKind, "connector");
      return Response.json({ access_token: "synthetic", scope: "family:read" });
    },
  });
  const response = await wrapper.fetch(tokenRequest({ basic: true, scope: "openid profile email offline_access mcp:tools" }), env, noopCtx);
  assert.equal(response.status, 200);
  assert.equal(seen, true);
  const finalRaw = await (env.OAUTH_KV as unknown as FakeKv).get(`client:${CLIENT_ID}`) as string;
  const finalClient = JSON.parse(finalRaw);
  assert.equal(finalClient.tokenEndpointAuthMethod, "client_secret_basic");
  assert.equal(finalClient.clientSecret, await sha256Hex(CLIENT_SECRET));
}

// Roll back a learned secret if the underlying provider rejects the exchange
// (for example, a bad PKCE verifier). The authorization code itself remains the
// provider's responsibility and no Family permission is widened.
{
  const env = await makeEnv();
  const before = await (env.OAUTH_KV as unknown as FakeKv).get(`client:${CLIENT_ID}`) as string;
  const wrapper = createFamilyOAuthTokenRecoveryWrapper({
    async fetch() {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    },
  });
  const response = await wrapper.fetch(tokenRequest({ secret: CLIENT_SECRET, scope: "openid offline_access" }), env, noopCtx);
  assert.equal(response.status, 400);
  const after = await (env.OAUTH_KV as unknown as FakeKv).get(`client:${CLIENT_ID}`) as string;
  assert.equal(after, before);
}

// Public PKCE connectors stay public. Their token-request scope metadata is
// still normalized to Family read so an OIDC/MCP scope list cannot produce an
// empty-scope token or grant additional permissions.
{
  const env = await makeEnv();
  const before = await (env.OAUTH_KV as unknown as FakeKv).get(`client:${CLIENT_ID}`) as string;
  const wrapper = createFamilyOAuthTokenRecoveryWrapper({
    async fetch(request) {
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("scope"), "family:read");
      return Response.json({ access_token: "synthetic-public", scope: "family:read" });
    },
  });
  const response = await wrapper.fetch(tokenRequest({ publicClient: true, scope: "openid profile mcp:tools" }), env, noopCtx);
  assert.equal(response.status, 200);
  const after = await (env.OAUTH_KV as unknown as FakeKv).get(`client:${CLIENT_ID}`) as string;
  assert.equal(after, before);
}

// Malformed connector scope metadata is rejected before the provider sees the
// token exchange, even when the authorization code/grant is otherwise valid.
{
  const env = await makeEnv();
  let called = false;
  const wrapper = createFamilyOAuthTokenRecoveryWrapper({
    async fetch() {
      called = true;
      return new Response("unexpected");
    },
  });
  const invalidToken = "x".repeat(129);
  const response = await wrapper.fetch(tokenRequest({ publicClient: true, scope: invalidToken }), env, noopCtx);
  assert.equal(response.status, 400);
  assert.equal(called, false);
  const body = await response.json() as { error?: string };
  assert.equal(body.error, "invalid_scope");
}

// Existing restored clients must not fall back to the provider's strict scope
// parser on a later authorize attempt. Normalize trusted ChatGPT connector
// transport scopes on both GET and the hidden POST oauth_query.
{
  const env = await makeEnv();
  const authorize = new URL("https://taistock-mcp.keywayk09.workers.dev/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("redirect_uri", REDIRECT_URI);
  authorize.searchParams.set("code_challenge", PKCE_CHALLENGE);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("scope", "openid profile email offline_access mcp:tools");
  authorize.searchParams.set("state", "state-123");
  authorize.searchParams.set("resource", "https://taistock-mcp.keywayk09.workers.dev/family-mcp");

  let seenGet = false;
  let seenPost = false;
  const wrapper = createFamilyOAuthTokenRecoveryWrapper({
    async fetch(request) {
      if (request.method === "GET") {
        seenGet = true;
        assert.equal(new URL(request.url).searchParams.get("scope"), "family:read");
      } else {
        seenPost = true;
        const form = new URLSearchParams(await request.text());
        const hidden = new URLSearchParams(String(form.get("oauth_query") || ""));
        assert.equal(hidden.get("scope"), "family:read");
        assert.equal(form.get("login_secret"), "do-not-log-me");
      }
      return new Response("ok");
    },
  });

  await wrapper.fetch(new Request(authorize.toString()), env, noopCtx);
  assert.equal(seenGet, true);

  const postForm = new URLSearchParams({
    oauth_query: authorize.searchParams.toString(),
    login_secret: "do-not-log-me",
  });
  await wrapper.fetch(new Request("https://taistock-mcp.keywayk09.workers.dev/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: postForm.toString(),
  }), env, noopCtx);
  assert.equal(seenPost, true);
}

console.log("Family OAuth connector token recovery runtime tests passed");
