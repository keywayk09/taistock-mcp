import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    OAUTH_KV: KVNamespace;
    OAUTH_PROVIDER: OAuthHelpers;
    OWNER_OAUTH_LOGIN_SECRET?: string;
    MCP_API_KEY?: string;
  }
}

type OwnerAuthProps = {
  userId: "owner";
  role: "owner";
};

type OwnerConnectorCandidate = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
};

type StoredOwnerConnectorClient = {
  clientId?: string;
  redirectUris?: string[];
  clientName?: string;
  grantTypes?: string[];
  responseTypes?: string[];
  registrationDate?: number;
  tokenEndpointAuthMethod?: string;
  authMethodExplicit?: true;
  clientSecret?: string;
};

export const OWNER_SCOPE = "owner:full";
const OWNER_MCP_PATHS = new Set(["/my-mcp", "/mcp"]);
const OWNER_CONNECTOR_NAME = "ChatGPT Owner / Diamond MCP App";
const CHATGPT_CONNECTOR_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{8,256}$/;
const CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH = "/connector_platform_oauth_redirect";
const OPAQUE_CLIENT_ID = /^[A-Za-z0-9._~-]{8,256}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const OAUTH_SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]{1,128}$/;
const MAX_SCOPE_TOKENS = 24;
const MAX_SCOPE_LENGTH = 2_048;
const LOGIN_FAIL_TTL_SECONDS = 15 * 60;
const LOGIN_FAIL_MAX = 5;
const TRUSTED_CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function ownerLoginSecret(env: Env) {
  return String(env.OWNER_OAUTH_LOGIN_SECRET || env.MCP_API_KEY || "").trim();
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

function html(body: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>台股引擎 Owner / 鑽石引擎授權</title></head><body><main style="max-width:560px;margin:48px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.6">
${body}</main></body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com https://chat.openai.com; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

function canonicalOwnerResource(raw: string, origin: string) {
  if (!raw) return null;
  try {
    const resource = new URL(raw);
    if (resource.origin !== origin || resource.search || resource.hash) return null;
    const pathname = resource.pathname.endsWith("/") && resource.pathname !== "/"
      ? resource.pathname.slice(0, -1)
      : resource.pathname;
    if (!OWNER_MCP_PATHS.has(pathname)) return null;
    return new URL(pathname, origin).toString();
  } catch {
    return null;
  }
}

function trustedConnectorRedirect(raw: string) {
  let redirect: URL;
  try {
    redirect = new URL(raw);
  } catch {
    return null;
  }
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.search || redirect.hash) return null;
  if (!TRUSTED_CHATGPT_HOSTS.has(redirect.hostname)) return null;
  if (
    !CHATGPT_CONNECTOR_CALLBACK_PATH.test(redirect.pathname)
    && redirect.pathname !== CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH
  ) return null;
  return redirect;
}

function validRequestedScopes(rawScope: string) {
  const scopes = rawScope.split(/\s+/).filter(Boolean);
  if (rawScope.length > MAX_SCOPE_LENGTH || scopes.length > MAX_SCOPE_TOKENS) return false;
  return scopes.every((scope) => OAUTH_SCOPE_TOKEN.test(scope));
}

function ownerConnectorCandidate(url: URL): OwnerConnectorCandidate | null {
  if (url.pathname !== "/authorize" || url.searchParams.get("response_type") !== "code") return null;

  const resource = canonicalOwnerResource(String(url.searchParams.get("resource") || "").trim(), url.origin);
  if (!resource) return null;

  const clientId = String(url.searchParams.get("client_id") || "");
  if (!OPAQUE_CLIENT_ID.test(clientId)) return null;

  const redirect = trustedConnectorRedirect(String(url.searchParams.get("redirect_uri") || ""));
  if (!redirect) return null;

  const method = String(url.searchParams.get("code_challenge_method") || "");
  const challenge = String(url.searchParams.get("code_challenge") || "");
  if (method !== "S256" || !PKCE_S256_CHALLENGE.test(challenge)) return null;

  const state = String(url.searchParams.get("state") || "");
  if (!state || state.length > 2_000) return null;

  const rawScope = String(url.searchParams.get("scope") || "");
  if (!validRequestedScopes(rawScope)) return null;

  return {
    clientId,
    redirectUri: redirect.toString(),
    state,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    resource,
  };
}

async function syntheticAuthorizeUrl(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/authorize") return null;
  if (request.method === "GET") return url;
  if (request.method !== "POST") return null;

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return null;
  try {
    const form = await request.clone().formData();
    const oauthQuery = String(form.get("oauth_query") || "");
    if (!oauthQuery || oauthQuery.length > 12_000) return null;
    const synthetic = new URL("/authorize", request.url);
    synthetic.search = oauthQuery;
    return synthetic;
  } catch {
    return null;
  }
}

export async function isOwnerAuthorizeRequest(request: Request) {
  const url = await syntheticAuthorizeUrl(request);
  if (!url) return false;
  return Boolean(canonicalOwnerResource(String(url.searchParams.get("resource") || "").trim(), url.origin));
}

function ownerClientKey(clientId: string) {
  return `client:${clientId}`;
}

function ownerClientMatches(raw: string | null, candidate: OwnerConnectorCandidate) {
  if (!raw) return false;
  try {
    const stored = JSON.parse(raw) as StoredOwnerConnectorClient;
    return stored.clientId === candidate.clientId
      && Array.isArray(stored.redirectUris)
      && stored.redirectUris.length === 1
      && stored.redirectUris[0] === candidate.redirectUri
      && Array.isArray(stored.grantTypes)
      && stored.grantTypes.includes("authorization_code")
      && Array.isArray(stored.responseTypes)
      && stored.responseTypes.includes("code")
      && stored.tokenEndpointAuthMethod === "none"
      && !stored.clientSecret;
  } catch {
    return false;
  }
}

async function ownerClientState(candidate: OwnerConnectorCandidate, env: Env) {
  const raw = await env.OAUTH_KV.get(ownerClientKey(candidate.clientId));
  if (!raw) return { exists: false as const, compatible: true as const };
  return { exists: true as const, compatible: ownerClientMatches(raw, candidate) };
}

async function registerOwnerClient(candidate: OwnerConnectorCandidate, env: Env) {
  const key = ownerClientKey(candidate.clientId);
  const existing = await env.OAUTH_KV.get(key);
  if (existing) return { ok: ownerClientMatches(existing, candidate), created: false };

  const stored = {
    clientId: candidate.clientId,
    redirectUris: [candidate.redirectUri],
    clientName: OWNER_CONNECTOR_NAME,
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: Math.floor(Date.now() / 1000),
    tokenEndpointAuthMethod: "none" as const,
    authMethodExplicit: true as const,
  };
  await env.OAUTH_KV.put(key, JSON.stringify(stored));
  return { ok: true, created: true };
}

function renderOwnerLogin(oauthQuery: string, error = "") {
  return html(`
<h1>台股引擎 Owner / 鑽石引擎</h1>
<p>此授權只用於你的 Owner MCP <strong>/my-mcp</strong>，不會轉成 Family 權限。</p>
${error ? `<p style="color:#b42318"><strong>${escapeHtml(error)}</strong></p>` : ""}
<form method="post" action="/authorize">
  <input type="hidden" name="oauth_query" value="${escapeHtml(oauthQuery)}">
  <label>Owner 連線驗證碼<br><input name="login_secret" type="password" autocomplete="current-password" required style="width:100%;padding:10px;margin:8px 0 16px"></label>
  <button type="submit" style="padding:10px 18px">授權鑽石引擎</button>
</form>`);
}

async function readOwnerLoginFailures(request: Request, env: Env) {
  const failKey = `owner-oauth:loginfail:${clientIp(request)}`;
  const failures = Number(await env.OAUTH_KV.get(failKey) || 0);
  return { failKey, failures };
}

async function validateOwnerSecret(request: Request, env: Env, supplied: string, oauthQuery: string) {
  const { failKey, failures } = await readOwnerLoginFailures(request, env);
  if (failures >= LOGIN_FAIL_MAX) {
    return { ok: false as const, response: html("<h2>暫時鎖定</h2><p>Owner 驗證失敗次數過多，請 15 分鐘後再試。</p>", 429) };
  }
  if (!constantTimeEqual(supplied, ownerLoginSecret(env))) {
    await env.OAUTH_KV.put(failKey, String(failures + 1), { expirationTtl: LOGIN_FAIL_TTL_SECONDS });
    return { ok: false as const, response: renderOwnerLogin(oauthQuery, "Owner 驗證碼錯誤") };
  }
  await env.OAUTH_KV.delete(failKey).catch(() => undefined);
  return { ok: true as const };
}

function ownerAuthRequest(candidate: OwnerConnectorCandidate, origin: string): AuthRequest {
  return {
    responseType: "code",
    clientId: candidate.clientId,
    redirectUri: candidate.redirectUri,
    scope: [OWNER_SCOPE],
    state: candidate.state,
    codeChallenge: candidate.codeChallenge,
    codeChallengeMethod: candidate.codeChallengeMethod,
    resource: candidate.resource,
    issuer: origin,
  };
}

export async function handleOwnerAuthorize(request: Request, env: Env) {
  const expected = ownerLoginSecret(env);
  if (!expected) {
    return html("<h2>Owner OAuth 尚未完成設定</h2><p>缺少 OWNER_OAUTH_LOGIN_SECRET / MCP_API_KEY。</p>", 503);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const candidate = ownerConnectorCandidate(url);
    if (!candidate) return html("<h2>Owner OAuth 授權要求無效</h2>", 400);

    const state = await ownerClientState(candidate, env);
    if (!state.compatible) return html("<h2>Owner OAuth client 不相容</h2><p>拒絕覆寫既有 OAuth client 身分。</p>", 409);

    const { failures } = await readOwnerLoginFailures(request, env);
    if (failures >= LOGIN_FAIL_MAX) {
      return html("<h2>暫時鎖定</h2><p>Owner 驗證失敗次數過多，請 15 分鐘後再試。</p>", 429);
    }
    return renderOwnerLogin(url.searchParams.toString());
  }

  if (request.method === "POST") {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return html("<h2>Bad Request</h2>", 400);
    }
    const oauthQuery = String(form.get("oauth_query") || "");
    if (!oauthQuery || oauthQuery.length > 12_000) return html("<h2>Bad Request</h2>", 400);

    const synthetic = new URL("/authorize", request.url);
    synthetic.search = oauthQuery;
    const candidate = ownerConnectorCandidate(synthetic);
    if (!candidate) return html("<h2>Owner OAuth 授權要求無效</h2>", 400);

    const checked = await validateOwnerSecret(
      request,
      env,
      String(form.get("login_secret") || ""),
      oauthQuery,
    );
    if (!checked.ok) return checked.response;

    const registered = await registerOwnerClient(candidate, env);
    if (!registered.ok) {
      return html("<h2>Owner OAuth client 不相容</h2><p>拒絕覆寫既有 OAuth client 身分。</p>", 409);
    }

    try {
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: ownerAuthRequest(candidate, synthetic.origin),
        userId: "owner",
        metadata: { clientName: OWNER_CONNECTOR_NAME },
        scope: [OWNER_SCOPE],
        props: { userId: "owner", role: "owner" } satisfies OwnerAuthProps,
      });
      return Response.redirect(redirectTo, 302);
    } catch (error) {
      if (registered.created) {
        await env.OAUTH_KV.delete(ownerClientKey(candidate.clientId)).catch(() => undefined);
      }
      throw error;
    }
  }

  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
}
