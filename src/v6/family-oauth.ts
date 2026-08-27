import {
  AuthorizationError,
  OAuthProvider,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { FamilyMCP } from "./family-mcp";
import { handleOwnerAuthorize, isOwnerAuthorizeRequest, OWNER_SCOPE } from "./owner-oauth";

declare global {
  interface Env {
    OAUTH_KV: KVNamespace;
    OAUTH_PROVIDER: OAuthHelpers;
    FAMILY_MCP_OBJECT: DurableObjectNamespace<FamilyMCP>;
    FAMILY_OAUTH_LOGIN_SECRET?: string;
    MOM_GPT_API_KEY?: string;
  }
}

type FamilyAuthProps = {
  userId: string;
  role: "family";
};

type ConcreteFetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

type RecoverableClientKind = "connector" | "gpt_action";

type RecoverableChatGptClient = {
  clientId: string;
  redirectUri: string;
  kind: RecoverableClientKind;
};

type StoredRecoveredClient = {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName: string;
  grantTypes: string[];
  responseTypes: string[];
  registrationDate: number;
  tokenEndpointAuthMethod: "none" | "client_secret_post" | "client_secret_basic";
  authMethodExplicit: true;
  recoveryKind?: "gpt_action";
};

type PendingActionSecretBootstrap = {
  clientId: string;
  redirectUri: string;
  authorizationCode: string;
  createdAt: number;
};

type PreparedTokenBootstrap = {
  request: Request;
  clientKey?: string;
  pendingKey?: string;
  previousClientRaw?: string;
};

const FAMILY_SCOPE = "family:read";
const LOGIN_FAIL_TTL_SECONDS = 15 * 60;
const LOGIN_FAIL_MAX = 5;
const ACTION_SECRET_BOOTSTRAP_TTL_SECONDS = 10 * 60;
const CHATGPT_CONNECTOR_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{8,256}$/;
const CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH = "/connector_platform_oauth_redirect";
const CHATGPT_ACTION_CALLBACK_PATH = /^\/aip\/[A-Za-z0-9_-]{3,256}\/oauth\/callback$/;
const OPAQUE_CLIENT_ID = /^[A-Za-z0-9._~-]{8,256}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const TRUSTED_CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
const OAUTH_SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]{1,128}$/;
const MAX_RECOVERY_SCOPE_TOKENS = 24;
const MAX_RECOVERY_SCOPE_LENGTH = 2_048;
const ACTION_RECOVERY_COMPAT_SCOPES = new Set([FAMILY_SCOPE, "offline_access"]);

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

function loginSecret(env: Env) {
  return String(env.FAMILY_OAUTH_LOGIN_SECRET || env.MOM_GPT_API_KEY || "").trim();
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

function html(body: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>台股引擎 Family 授權</title></head><body><main style="max-width:560px;margin:48px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.6">
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

function classifyChatGptRedirect(redirect: URL): RecoverableClientKind | null {
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash || redirect.search) return null;
  if (
    TRUSTED_CHATGPT_HOSTS.has(redirect.hostname)
    && (CHATGPT_CONNECTOR_CALLBACK_PATH.test(redirect.pathname) || redirect.pathname === CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH)
  ) {
    return "connector";
  }
  if (TRUSTED_CHATGPT_HOSTS.has(redirect.hostname) && CHATGPT_ACTION_CALLBACK_PATH.test(redirect.pathname)) {
    return "gpt_action";
  }
  return null;
}

function validConnectorRequestedScopes(rawScope: string, scopes: string[]) {
  // Incoming ChatGPT Plugin/MCP scopes are transport/request metadata,
  // never Family authorization. Keep only a bounded RFC 6749-style
  // syntax check here; recoveredAuthRequest() below normalizes every
  // accepted connector request to the single FAMILY_SCOPE.
  if (rawScope.length > MAX_RECOVERY_SCOPE_LENGTH) return false;
  if (scopes.length > MAX_RECOVERY_SCOPE_TOKENS) return false;
  return scopes.every((scope) => OAUTH_SCOPE_TOKEN.test(scope));
}

function safeAuthDiagnostic(request: Request) {
  const url = new URL(request.url);
  const responseType = url.searchParams.get("response_type") === "code" ? "code" : "other";
  const clientId = String(url.searchParams.get("client_id") || "");
  const clientMode = OPAQUE_CLIENT_ID.test(clientId) ? "opaque" : (clientId.startsWith("https://") ? "url" : "invalid");

  let redirectMode = "invalid";
  let redirectHost = "invalid";
  try {
    const redirect = new URL(String(url.searchParams.get("redirect_uri") || ""));
    redirectHost = TRUSTED_CHATGPT_HOSTS.has(redirect.hostname) ? redirect.hostname : "untrusted";
    redirectMode = classifyChatGptRedirect(redirect) || "unrecognized";
  } catch {
    // Keep the safe summary only; never echo the raw redirect URI.
  }

  const method = String(url.searchParams.get("code_challenge_method") || "");
  const challenge = String(url.searchParams.get("code_challenge") || "");
  const pkce = !method && !challenge
    ? "none"
    : (method === "S256" && PKCE_S256_CHALLENGE.test(challenge) ? "s256" : "invalid");

  const rawScope = String(url.searchParams.get("scope") || "");
  const scopes = rawScope.split(/\s+/).filter(Boolean);
  const scopeMode = scopes.length === 0
    ? "none"
    : redirectMode === "connector"
      ? (validConnectorRequestedScopes(rawScope, scopes) ? "normalized" : "malformed")
      : (scopes.every((scope) => ACTION_RECOVERY_COMPAT_SCOPES.has(scope)) ? "compatible" : "unsupported");
  const state = String(url.searchParams.get("state") || "");

  let resource = "none";
  const resourceRaw = String(url.searchParams.get("resource") || "").trim();
  if (resourceRaw) {
    try {
      resource = new URL(resourceRaw).origin === url.origin ? "same-origin" : "other-origin";
    } catch {
      resource = "invalid";
    }
  }

  return `FAM-OAUTH-DIAG response=${responseType} client=${clientMode} redirect=${redirectMode}@${redirectHost} pkce=${pkce} scope=${scopeMode} state=${state ? "present" : "missing"} resource=${resource}`;
}

function authorizationErrorResponse(error: AuthorizationError, request?: Request) {
  if (!error.redirectUri) {
    const diagnostic = request ? `<p><code>${escapeHtml(safeAuthDiagnostic(request))}</code></p>` : "";
    return html(`<h2>授權要求無效</h2><p>${escapeHtml(error.description)}</p>${diagnostic}`, 400);
  }
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect.toString(), 302);
}

function recoverableChatGptClient(request: Request): RecoverableChatGptClient | null {
  const url = new URL(request.url);
  if (url.searchParams.get("response_type") !== "code") return null;

  const clientId = String(url.searchParams.get("client_id") || "");
  if (!OPAQUE_CLIENT_ID.test(clientId)) return null;

  const redirectRaw = String(url.searchParams.get("redirect_uri") || "");
  let redirect: URL;
  try {
    redirect = new URL(redirectRaw);
  } catch {
    return null;
  }
  const kind = classifyChatGptRedirect(redirect);
  if (!kind) return null;

  const method = String(url.searchParams.get("code_challenge_method") || "");
  const challenge = String(url.searchParams.get("code_challenge") || "");
  if (kind === "connector") {
    // ChatGPT Plugin / Apps SDK MCP clients use authorization-code + PKCE S256.
    if (method !== "S256" || !PKCE_S256_CHALLENGE.test(challenge)) return null;
  } else if (method || challenge) {
    // Custom GPT Actions historically use a confidential client secret instead
    // of PKCE. If OpenAI supplies PKCE as well, accept only strict S256.
    if (method !== "S256" || !PKCE_S256_CHALLENGE.test(challenge)) return null;
  }

  const rawScope = String(url.searchParams.get("scope") || "");
  const scopes = rawScope.split(/\s+/).filter(Boolean);
  if (kind === "connector") {
    // ChatGPT may evolve the OAuth/OIDC scopes it requests. For a trusted
    // ChatGPT connector callback protected by PKCE S256, validate only a
    // bounded OAuth scope-token syntax here. These names are deliberately
    // NOT permissions: recoveredAuthRequest() always replaces them with
    // [FAMILY_SCOPE], and completeAuthorization() filters again.
    if (!validConnectorRequestedScopes(rawScope, scopes)) return null;
  } else if (scopes.some((scope) => !ACTION_RECOVERY_COMPAT_SCOPES.has(scope))) {
    // Custom GPT Action compatibility remains intentionally strict.
    return null;
  }

  const state = String(url.searchParams.get("state") || "");
  if (!state || state.length > 2_000) return null;

  const resourceRaw = String(url.searchParams.get("resource") || "").trim();
  if (resourceRaw) {
    try {
      if (new URL(resourceRaw).origin !== url.origin) return null;
    } catch {
      return null;
    }
  }

  return { clientId, redirectUri: redirect.toString(), kind };
}

function recoveredAuthRequest(request: Request, candidate: RecoverableChatGptClient): AuthRequest | null {
  // This path is called only after recoverableChatGptClient() has accepted the
  // request and the Family login secret has been proven. Re-check every field
  // needed by completeAuthorization so no unvalidated URL parameter crosses the
  // compatibility boundary.
  const revalidated = recoverableChatGptClient(request);
  if (
    !revalidated
    || revalidated.clientId !== candidate.clientId
    || revalidated.redirectUri !== candidate.redirectUri
    || revalidated.kind !== candidate.kind
  ) return null;
  const url = new URL(request.url);
  const state = String(url.searchParams.get("state") || "");
  const codeChallenge = String(url.searchParams.get("code_challenge") || "");
  const codeChallengeMethod = String(url.searchParams.get("code_challenge_method") || "");
  const resourceRaw = String(url.searchParams.get("resource") || "").trim();
  return {
    responseType: "code",
    clientId: candidate.clientId,
    redirectUri: candidate.redirectUri,
    scope: [FAMILY_SCOPE],
    state,
    ...(codeChallenge ? { codeChallenge, codeChallengeMethod } : {}),
    ...(resourceRaw ? { resource: resourceRaw } : {}),
    issuer: url.origin,
  };
}

function recoveredClientKey(clientId: string) {
  return `client:${clientId}`;
}

function pendingActionKey(clientId: string) {
  return `family-oauth:action-bootstrap:${clientId}`;
}

function recoveredClientName(candidate: RecoverableChatGptClient) {
  return candidate.kind === "gpt_action" ? "ChatGPT Family Action" : "ChatGPT Family Plugin / MCP App";
}

function storedClientMatches(raw: string | null, candidate: RecoverableChatGptClient) {
  if (!raw) return false;
  try {
    const stored = JSON.parse(raw) as Partial<StoredRecoveredClient>;
    const expectedMethod = candidate.kind === "gpt_action" ? "client_secret_post" : "none";
    return stored.clientId === candidate.clientId
      && Array.isArray(stored.redirectUris)
      && stored.redirectUris.length === 1
      && stored.redirectUris[0] === candidate.redirectUri
      && stored.tokenEndpointAuthMethod === expectedMethod
      && (candidate.kind !== "gpt_action" || stored.recoveryKind === "gpt_action" || Boolean(stored.clientSecret));
  } catch {
    return false;
  }
}

async function missingRecoverableChatGptClient(request: Request, env: Env) {
  const candidate = recoverableChatGptClient(request);
  if (!candidate) return null;
  const raw = await env.OAUTH_KV.get(recoveredClientKey(candidate.clientId));
  if (!raw) return candidate;
  if (candidate.kind === "gpt_action") {
    try {
      const stored = JSON.parse(raw) as Partial<StoredRecoveredClient>;
      if (stored.recoveryKind === "gpt_action" && !stored.clientSecret && storedClientMatches(raw, candidate)) return candidate;
    } catch {
      // Fail closed below: malformed existing records are not auto-replaced.
    }
  }
  return null;
}

async function registerRecoveredChatGptClient(candidate: RecoverableChatGptClient, env: Env) {
  const key = recoveredClientKey(candidate.clientId);
  const existing = await env.OAUTH_KV.get(key);
  if (existing) return storedClientMatches(existing, candidate);

  // Storage format is pinned to @cloudflare/workers-oauth-provider 0.10.3.
  // Connector/Plugin recovery is a public PKCE client. Custom GPT Action
  // recovery is temporarily secretless and is upgraded to the exact secret
  // presented by ChatGPT only during the matching one-time authorization-code
  // exchange.
  const stored: StoredRecoveredClient = {
    clientId: candidate.clientId,
    redirectUris: [candidate.redirectUri],
    clientName: recoveredClientName(candidate),
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: Math.floor(Date.now() / 1000),
    tokenEndpointAuthMethod: candidate.kind === "gpt_action" ? "client_secret_post" : "none",
    authMethodExplicit: true,
    ...(candidate.kind === "gpt_action" ? { recoveryKind: "gpt_action" as const } : {}),
  };
  await env.OAUTH_KV.put(key, JSON.stringify(stored));
  return true;
}

async function parseAuthorizationRequest(request: Request, env: Env) {
  try {
    return { ok: true as const, value: await env.OAUTH_PROVIDER.parseAuthRequest(request) };
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return { ok: false as const, response: authorizationErrorResponse(error, request) };
  }
}

function renderLogin(oauthQuery: string, clientName: string, error = "") {
  return html(`
<h1>台股引擎 Family</h1>
<p>連線來源：<strong>${escapeHtml(clientName || "MCP Client")}</strong></p>
<p>此授權只開放家人版唯讀股票查詢，不允許修改策略、GitHub、Diamond 記憶或 Production。</p>
${error ? `<p style="color:#b42318"><strong>${escapeHtml(error)}</strong></p>` : ""}
<form method="post" action="/authorize">
  <input type="hidden" name="oauth_query" value="${escapeHtml(oauthQuery)}">
  <label>家人連線驗證碼<br><input name="login_secret" type="password" autocomplete="current-password" required style="width:100%;padding:10px;margin:8px 0 16px"></label>
  <button type="submit" style="padding:10px 18px">授權連線</button>
</form>`);
}

async function readLoginFailures(request: Request, env: Env) {
  const failKey = `family-oauth:loginfail:${clientIp(request)}`;
  const failures = Number(await env.OAUTH_KV.get(failKey) || 0);
  return { failKey, failures };
}

async function validateLoginSecret(
  request: Request,
  env: Env,
  supplied: string,
  oauthQuery: string,
  clientName: string,
) {
  const { failKey, failures } = await readLoginFailures(request, env);
  if (failures >= LOGIN_FAIL_MAX) {
    return { ok: false as const, response: html("<h2>暫時鎖定</h2><p>驗證失敗次數過多，請 15 分鐘後再試。</p>", 429) };
  }
  if (!constantTimeEqual(supplied, loginSecret(env))) {
    await env.OAUTH_KV.put(failKey, String(failures + 1), { expirationTtl: LOGIN_FAIL_TTL_SECONDS });
    return { ok: false as const, response: renderLogin(oauthQuery, clientName, "驗證碼錯誤") };
  }
  await env.OAUTH_KV.delete(failKey).catch(() => undefined);
  return { ok: true as const };
}

async function handleAuthorize(request: Request, env: Env) {
  const expected = loginSecret(env);
  if (!expected) {
    return html("<h2>Family OAuth 尚未完成設定</h2><p>缺少 FAMILY_OAUTH_LOGIN_SECRET / MOM_GPT_API_KEY。</p>", 503);
  }

  if (request.method === "GET") {
    const recovery = await missingRecoverableChatGptClient(request, env);
    if (recovery) {
      const { failures } = await readLoginFailures(request, env);
      if (failures >= LOGIN_FAIL_MAX) {
        return html("<h2>暫時鎖定</h2><p>驗證失敗次數過多，請 15 分鐘後再試。</p>", 429);
      }
      // Do not mutate OAuth client state on an unauthenticated GET. We only
      // restore the stale ChatGPT client after the family secret is proven.
      return renderLogin(new URL(request.url).searchParams.toString(), recoveredClientName(recovery));
    }

    const parsed = await parseAuthorizationRequest(request, env);
    if (!parsed.ok) return parsed.response;
    const client = await env.OAUTH_PROVIDER.lookupClient(parsed.value.clientId);
    if (!client) return html("<h2>Unknown OAuth client</h2>", 400);
    const { failures } = await readLoginFailures(request, env);
    if (failures >= LOGIN_FAIL_MAX) {
      return html("<h2>暫時鎖定</h2><p>驗證失敗次數過多，請 15 分鐘後再試。</p>", 429);
    }
    return renderLogin(new URL(request.url).searchParams.toString(), client.clientName || "MCP Client");
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

    const syntheticUrl = new URL("/authorize", request.url);
    syntheticUrl.search = oauthQuery;
    const syntheticRequest = new Request(syntheticUrl.toString(), { method: "GET", headers: request.headers });
    const recovery = await missingRecoverableChatGptClient(syntheticRequest, env);

    let oauthRequest: AuthRequest;
    let clientName: string;

    if (recovery) {
      clientName = recoveredClientName(recovery);
      const checked = await validateLoginSecret(
        request,
        env,
        String(form.get("login_secret") || ""),
        oauthQuery,
        clientName,
      );
      if (!checked.ok) return checked.response;
      if (!(await registerRecoveredChatGptClient(recovery, env))) {
        return html("<h2>Family OAuth client 恢復失敗</h2><p>請重新啟動連線流程。</p>", 409);
      }
      const reconstructed = recoveredAuthRequest(syntheticRequest, recovery);
      if (!reconstructed) {
        await env.OAUTH_KV.delete(recoveredClientKey(recovery.clientId)).catch(() => undefined);
        return html("<h2>Family OAuth request 驗證失敗</h2><p>請重新啟動連線流程。</p>", 409);
      }
      oauthRequest = reconstructed;
    } else {
      const parsed = await parseAuthorizationRequest(syntheticRequest, env);
      if (!parsed.ok) return parsed.response;
      oauthRequest = parsed.value;
      const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
      if (!client) return html("<h2>Unknown OAuth client</h2>", 400);
      clientName = client.clientName || "MCP Client";
      const checked = await validateLoginSecret(
        request,
        env,
        String(form.get("login_secret") || ""),
        oauthQuery,
        clientName,
      );
      if (!checked.ok) return checked.response;
    }

    const grantedScopes = oauthRequest.scope.filter((scope) => scope === FAMILY_SCOPE);
    try {
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthRequest,
        userId: "family",
        metadata: { clientName },
        scope: grantedScopes,
        props: { userId: "family", role: "family" } satisfies FamilyAuthProps,
      });
      if (recovery?.kind === "gpt_action") {
        const authorizationCode = new URL(redirectTo).searchParams.get("code") || "";
        if (!authorizationCode) {
          await env.OAUTH_KV.delete(recoveredClientKey(recovery.clientId)).catch(() => undefined);
          return html("<h2>Family OAuth code 建立失敗</h2><p>請重新啟動連線流程。</p>", 409);
        }
        const pending: PendingActionSecretBootstrap = {
          clientId: recovery.clientId,
          redirectUri: recovery.redirectUri,
          authorizationCode,
          createdAt: Date.now(),
        };
        await env.OAUTH_KV.put(pendingActionKey(recovery.clientId), JSON.stringify(pending), {
          expirationTtl: ACTION_SECRET_BOOTSTRAP_TTL_SECONDS,
        });
      }
      return Response.redirect(redirectTo, 302);
    } catch (error) {
      if (recovery) {
        await env.OAUTH_KV.delete(recoveredClientKey(recovery.clientId)).catch(() => undefined);
        await env.OAUTH_KV.delete(pendingActionKey(recovery.clientId)).catch(() => undefined);
      }
      throw error;
    }
  }

  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
}

function decodeBasicClientAuth(header: string) {
  if (!header.toLowerCase().startsWith("basic ")) return null;
  try {
    const encoded = header.slice(6).trim();
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    const decodePart = (value: string) => decodeURIComponent(value.replace(/\+/g, " "));
    return {
      clientId: decodePart(decoded.slice(0, colon)),
      clientSecret: decodePart(decoded.slice(colon + 1)),
      method: "client_secret_basic" as const,
    };
  } catch {
    return null;
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equivalentActionRedirect(leftRaw: string, rightRaw: string) {
  try {
    const left = new URL(leftRaw);
    const right = new URL(rightRaw);
    return left.protocol === "https:"
      && right.protocol === "https:"
      && TRUSTED_CHATGPT_HOSTS.has(left.hostname)
      && TRUSTED_CHATGPT_HOSTS.has(right.hostname)
      && CHATGPT_ACTION_CALLBACK_PATH.test(left.pathname)
      && left.pathname === right.pathname
      && !left.search && !right.search
      && !left.hash && !right.hash;
  } catch {
    return false;
  }
}

async function prepareActionSecretBootstrap(request: Request, env: Env): Promise<PreparedTokenBootstrap> {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/oauth/token") return { request };

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return { request };

  let bodyText: string;
  try {
    bodyText = await request.clone().text();
  } catch {
    return { request };
  }
  const params = new URLSearchParams(bodyText);
  if (params.get("grant_type") !== "authorization_code") return { request };

  const basic = decodeBasicClientAuth(request.headers.get("authorization") || "");
  const postedClientId = String(params.get("client_id") || "");
  const postedClientSecret = String(params.get("client_secret") || "");
  const presented = basic || (
    postedClientId && postedClientSecret
      ? { clientId: postedClientId, clientSecret: postedClientSecret, method: "client_secret_post" as const }
      : null
  );
  if (!presented || !OPAQUE_CLIENT_ID.test(presented.clientId) || !presented.clientSecret || presented.clientSecret.length > 4_096) {
    return { request };
  }

  const pendingKey = pendingActionKey(presented.clientId);
  const pendingRaw = await env.OAUTH_KV.get(pendingKey);
  if (!pendingRaw) return { request };

  let pending: PendingActionSecretBootstrap;
  try {
    pending = JSON.parse(pendingRaw) as PendingActionSecretBootstrap;
  } catch {
    return { request };
  }
  const code = String(params.get("code") || "");
  const suppliedRedirect = String(params.get("redirect_uri") || "");
  if (
    pending.clientId !== presented.clientId
    || !code
    || !constantTimeEqual(code, pending.authorizationCode)
    || !suppliedRedirect
    || !(suppliedRedirect === pending.redirectUri || equivalentActionRedirect(suppliedRedirect, pending.redirectUri))
  ) {
    return { request };
  }

  const clientKey = recoveredClientKey(presented.clientId);
  const previousClientRaw = await env.OAUTH_KV.get(clientKey);
  if (!previousClientRaw) return { request };

  let stored: StoredRecoveredClient;
  try {
    stored = JSON.parse(previousClientRaw) as StoredRecoveredClient;
  } catch {
    return { request };
  }
  if (
    stored.clientId !== presented.clientId
    || stored.recoveryKind !== "gpt_action"
    || stored.clientSecret
    || !Array.isArray(stored.redirectUris)
    || stored.redirectUris.length !== 1
    || stored.redirectUris[0] !== pending.redirectUri
  ) {
    return { request };
  }

  stored.clientSecret = await sha256Hex(presented.clientSecret);
  stored.tokenEndpointAuthMethod = presented.method;
  stored.authMethodExplicit = true;
  delete stored.recoveryKind;
  await env.OAUTH_KV.put(clientKey, JSON.stringify(stored));

  let forwardedRequest = request;
  if (suppliedRedirect !== pending.redirectUri) {
    params.set("redirect_uri", pending.redirectUri);
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    forwardedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: params.toString(),
    });
  }

  return { request: forwardedRequest, clientKey, pendingKey, previousClientRaw };
}

async function rollbackPreparedTokenBootstrap(prepared: PreparedTokenBootstrap, env: Env) {
  if (!prepared.clientKey || prepared.previousClientRaw === undefined) return;
  await env.OAUTH_KV.put(prepared.clientKey, prepared.previousClientRaw).catch(() => undefined);
}

// OAuthProvider authenticates bearer validity and audience before API handlers.
// The application must still enforce the effective access-token permission scope.
async function requireEffectiveScope(request: Request, env: Env, requiredScope: string) {
  const authorization = String(request.headers.get("authorization") || "").trim();
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  const token = match?.[1] || "";
  if (!token) return false;

  const effectiveToken = await env.OAUTH_PROVIDER.unwrapToken(token);
  return Boolean(effectiveToken?.scope.includes(requiredScope));
}

export function createFamilyOAuthProvider(appHandler: ConcreteFetchHandler) {
  const familyApiHandler: ConcreteFetchHandler = {
    async fetch(request, env, ctx) {
      const props = (ctx as ExecutionContext & { props?: { userId?: string; role?: string } }).props;
      const { userId, role } = props || {};
      if (role !== "family" || userId !== "family") {
        return Response.json({ error: "forbidden_family_role" }, { status: 403 });
      }
      if (!(await requireEffectiveScope(request, env, FAMILY_SCOPE))) {
        return Response.json({ error: "insufficient_family_scope" }, { status: 403 });
      }
      try {
        return await FamilyMCP.serve("/family-mcp", { binding: "FAMILY_MCP_OBJECT" }).fetch(request, env, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("FAMILY_MCP_OBJECT") && message.includes("binding")) {
          return Response.json({
            error: "family_mcp_binding_missing",
            message: "FAMILY_MCP_OBJECT is required; refusing to fall back to the full MCP_OBJECT namespace.",
          }, { status: 503 });
        }
        throw error;
      }
    },
  };

  const ownerApiHandler: ConcreteFetchHandler = {
    async fetch(request, env, ctx) {
      const props = (ctx as ExecutionContext & { props?: { userId?: string; role?: string } }).props;
      const { userId, role } = props || {};
      if (role !== "owner" || userId !== "owner") {
        return Response.json({ error: "forbidden_owner_role" }, { status: 403 });
      }
      if (!(await requireEffectiveScope(request, env, OWNER_SCOPE))) {
        return Response.json({ error: "insufficient_owner_scope" }, { status: 403 });
      }
      return appHandler.fetch(request, env, ctx);
    },
  };

  const defaultHandler: ConcreteFetchHandler = {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === "/authorize") {
        if (await isOwnerAuthorizeRequest(request)) return handleOwnerAuthorize(request, env);
        return handleAuthorize(request, env);
      }
      return appHandler.fetch(request, env, ctx);
    },
  };

  const provider = new OAuthProvider<Env>({
    apiHandlers: {
      "/family-mcp": familyApiHandler,
      "/my-mcp": ownerApiHandler,
      "/mcp": ownerApiHandler,
    },
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: [FAMILY_SCOPE, OWNER_SCOPE],
    allowPlainPKCE: false,
    allowImplicitFlow: false,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      scopes_supported: [FAMILY_SCOPE, OWNER_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Taiwan Stock AI OAuth Server",
    },
  }) as unknown as ConcreteFetchHandler;

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const prepared = await prepareActionSecretBootstrap(request, env);
      try {
        const response = await provider.fetch(prepared.request, env, ctx);
        if (prepared.clientKey) {
          if (response.ok) {
            if (prepared.pendingKey) await env.OAUTH_KV.delete(prepared.pendingKey).catch(() => undefined);
          } else {
            await rollbackPreparedTokenBootstrap(prepared, env);
          }
        }
        return response;
      } catch (error) {
        await rollbackPreparedTokenBootstrap(prepared, env);
        throw error;
      }
    },
  } satisfies ConcreteFetchHandler;
}
