import {
  AuthorizationError,
  OAuthProvider,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { FamilyMCP } from "./family-mcp";

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

type RecoverableChatGptClient = {
  clientId: string;
  redirectUri: string;
};

type StoredRecoveredClient = {
  clientId: string;
  redirectUris: string[];
  clientName: string;
  grantTypes: string[];
  responseTypes: string[];
  registrationDate: number;
  tokenEndpointAuthMethod: "none";
  authMethodExplicit: true;
};

const FAMILY_SCOPE = "family:read";
const LOGIN_FAIL_TTL_SECONDS = 15 * 60;
const LOGIN_FAIL_MAX = 5;
const CHATGPT_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{8,256}$/;
const CHATGPT_LEGACY_CALLBACK_PATH = "/connector_platform_oauth_redirect";
const OPAQUE_CLIENT_ID = /^[A-Za-z0-9._~-]{8,256}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

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
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

function authorizationErrorResponse(error: AuthorizationError) {
  if (!error.redirectUri) {
    return html(`<h2>授權要求無效</h2><p>${escapeHtml(error.description)}</p>`, 400);
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
  if (redirect.protocol !== "https:" || redirect.hostname !== "chatgpt.com") return null;
  if (redirect.username || redirect.password || redirect.hash || redirect.search) return null;
  if (!CHATGPT_CALLBACK_PATH.test(redirect.pathname) && redirect.pathname !== CHATGPT_LEGACY_CALLBACK_PATH) return null;

  const method = String(url.searchParams.get("code_challenge_method") || "");
  const challenge = String(url.searchParams.get("code_challenge") || "");
  if (method !== "S256" || !PKCE_S256_CHALLENGE.test(challenge)) return null;

  const scopes = String(url.searchParams.get("scope") || "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(FAMILY_SCOPE)) return null;

  const resourceRaw = String(url.searchParams.get("resource") || "").trim();
  if (resourceRaw) {
    try {
      if (new URL(resourceRaw).origin !== url.origin) return null;
    } catch {
      return null;
    }
  }

  return { clientId, redirectUri: redirect.toString() };
}

function recoveredClientKey(clientId: string) {
  return `client:${clientId}`;
}

function storedClientMatches(raw: string | null, candidate: RecoverableChatGptClient) {
  if (!raw) return false;
  try {
    const stored = JSON.parse(raw) as Partial<StoredRecoveredClient>;
    return stored.clientId === candidate.clientId
      && Array.isArray(stored.redirectUris)
      && stored.redirectUris.length === 1
      && stored.redirectUris[0] === candidate.redirectUri
      && stored.tokenEndpointAuthMethod === "none";
  } catch {
    return false;
  }
}

async function missingRecoverableChatGptClient(request: Request, env: Env) {
  const candidate = recoverableChatGptClient(request);
  if (!candidate) return null;
  const raw = await env.OAUTH_KV.get(recoveredClientKey(candidate.clientId));
  return raw ? null : candidate;
}

async function registerRecoveredChatGptClient(candidate: RecoverableChatGptClient, env: Env) {
  const key = recoveredClientKey(candidate.clientId);
  const existing = await env.OAUTH_KV.get(key);
  if (existing) return storedClientMatches(existing, candidate);

  // Storage format is pinned to @cloudflare/workers-oauth-provider 0.10.3.
  // This record contains public OAuth client metadata only: no client secret,
  // authorization grant, access token or refresh token is created here.
  const stored: StoredRecoveredClient = {
    clientId: candidate.clientId,
    redirectUris: [candidate.redirectUri],
    clientName: "ChatGPT Family Connector",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    registrationDate: Math.floor(Date.now() / 1000),
    tokenEndpointAuthMethod: "none",
    authMethodExplicit: true,
  };
  await env.OAUTH_KV.put(key, JSON.stringify(stored));
  return true;
}

async function parseAuthorizationRequest(request: Request, env: Env) {
  try {
    return { ok: true as const, value: await env.OAUTH_PROVIDER.parseAuthRequest(request) };
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return { ok: false as const, response: authorizationErrorResponse(error) };
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
      return renderLogin(new URL(request.url).searchParams.toString(), "ChatGPT Family Connector");
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

    if (recovery) {
      const checked = await validateLoginSecret(
        request,
        env,
        String(form.get("login_secret") || ""),
        oauthQuery,
        "ChatGPT Family Connector",
      );
      if (!checked.ok) return checked.response;
      if (!(await registerRecoveredChatGptClient(recovery, env))) {
        return html("<h2>Family OAuth client 恢復失敗</h2><p>請重新啟動連線流程。</p>", 409);
      }
    }

    const parsed = await parseAuthorizationRequest(syntheticRequest, env);
    if (!parsed.ok) {
      if (recovery) {
        await env.OAUTH_KV.delete(recoveredClientKey(recovery.clientId)).catch(() => undefined);
        return html("<h2>Family OAuth client 同步失敗</h2><p>請重新按一次連線。</p>", 409);
      }
      return parsed.response;
    }

    const oauthRequest: AuthRequest = parsed.value;
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
    if (!client) return html("<h2>Unknown OAuth client</h2>", 400);

    if (!recovery) {
      const checked = await validateLoginSecret(
        request,
        env,
        String(form.get("login_secret") || ""),
        oauthQuery,
        client.clientName || "MCP Client",
      );
      if (!checked.ok) return checked.response;
    }

    const grantedScopes = oauthRequest.scope.filter((scope) => scope === FAMILY_SCOPE);
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId: "family",
      metadata: { clientName: client.clientName || "MCP Client" },
      scope: grantedScopes,
      props: { userId: "family", role: "family" } satisfies FamilyAuthProps,
    });
    return Response.redirect(redirectTo, 302);
  }

  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
}

export function createFamilyOAuthProvider(appHandler: ConcreteFetchHandler) {
  const familyApiHandler: ConcreteFetchHandler = {
    async fetch(request, env, ctx) {
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

  const defaultHandler: ConcreteFetchHandler = {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === "/authorize") return handleAuthorize(request, env);
      return appHandler.fetch(request, env, ctx);
    },
  };

  return new OAuthProvider<Env>({
    apiRoute: "/family-mcp",
    apiHandler: familyApiHandler,
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: [FAMILY_SCOPE],
    allowPlainPKCE: false,
    allowImplicitFlow: false,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      scopes_supported: [FAMILY_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Taiwan Stock AI Family MCP",
    },
  });
}
