import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import legacyHandler, { FamilyMCP, MyMCP } from "./index-v7";

type OAuthRole = "owner" | "family";

type OAuthGrantProps = {
  role: OAuthRole;
  permissions: string[];
  issued_at: string;
};

type OAuthRuntimeEnv = Env & {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  OWNER_OAUTH_LOGIN_SECRET?: string;
  MOM_OAUTH_LOGIN_SECRET?: string;
};

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeRequestedScopes(request: AuthRequest): string[] {
  const value: unknown = request.scope;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

function authorizationPage(options: {
  action: string;
  clientName: string;
  requestedScopes: string[];
  error?: string;
}) {
  const requested = options.requestedScopes.length
    ? options.requestedScopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("")
    : "<li>台股資料查詢</li>";
  const error = options.error
    ? `<div class="error">${escapeHtml(options.error)}</div>`
    : "";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>台股 AI 授權</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f6f8;color:#171717;margin:0;padding:24px}
main{max-width:520px;margin:6vh auto;background:#fff;border:1px solid #ddd;border-radius:18px;padding:28px;box-shadow:0 10px 35px rgba(0,0,0,.08)}
h1{font-size:25px;margin:0 0 12px}p,li{line-height:1.6}.client{font-weight:700}.error{background:#fff0f0;color:#9b1c1c;border:1px solid #f1b4b4;border-radius:10px;padding:12px;margin:16px 0}
label{display:block;font-weight:700;margin:20px 0 8px}input{box-sizing:border-box;width:100%;font-size:18px;padding:13px;border:1px solid #aaa;border-radius:10px}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#111;color:#fff;font-size:17px;font-weight:700;cursor:pointer}.note{font-size:13px;color:#666;margin-top:16px}
</style>
</head>
<body>
<main>
<h1>台股 AI OAuth 授權</h1>
<p><span class="client">${escapeHtml(options.clientName)}</span> 要連接你的台股 AI。</p>
<p>授權後可使用：</p>
<ul>${requested}</ul>
${error}
<form method="post" action="${escapeHtml(options.action)}" autocomplete="off">
<label for="secret">登入密碼</label>
<input id="secret" name="secret" type="password" required minlength="20" maxlength="256" autocomplete="current-password" autofocus>
<button type="submit">確認並授權</button>
</form>
<p class="note">請輸入你自己的 OWNER OAuth 密碼，或媽媽專用 OAuth 密碼。此頁不會顯示或回傳密碼。</p>
</main>
</body>
</html>`;
}

async function authFailureLimited(env: OAuthRuntimeEnv, request: Request) {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `login-fail:${ip}`;
  const current = Number(await env.OAUTH_KV.get(key)) || 0;
  return { key, blocked: current >= 10, current };
}

async function recordAuthFailure(env: OAuthRuntimeEnv, key: string, current: number) {
  await env.OAUTH_KV.put(key, String(current + 1), { expirationTtl: 600 });
}

function resolveRole(secret: string, env: OAuthRuntimeEnv): OAuthRole | null {
  const owner = env.OWNER_OAUTH_LOGIN_SECRET?.trim() ?? "";
  const family = env.MOM_OAUTH_LOGIN_SECRET?.trim() ?? "";
  const ownerMatch = owner.length > 0 && constantTimeEqual(secret, owner);
  const familyMatch = family.length > 0 && constantTimeEqual(secret, family);
  if (ownerMatch) return "owner";
  if (familyMatch) return "family";
  return null;
}

const authAndLegacyHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname !== "/authorize") return legacyHandler.fetch(request, env, ctx);

    const runtimeEnv = env as OAuthRuntimeEnv;
    if (!runtimeEnv.OWNER_OAUTH_LOGIN_SECRET || !runtimeEnv.MOM_OAUTH_LOGIN_SECRET) {
      return jsonResponse({ error: "oauth_login_secrets_missing" }, 503);
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
    }

    let oauthRequest: AuthRequest;
    try {
      oauthRequest = await runtimeEnv.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch {
      return jsonResponse({ error: "invalid_oauth_request" }, 400);
    }

    const client = await runtimeEnv.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
    const clientRecord = (client ?? {}) as Record<string, unknown>;
    const clientName = String(clientRecord.client_name ?? clientRecord.clientName ?? "ChatGPT MCP Client");
    const requestedScopes = normalizeRequestedScopes(oauthRequest);
    const action = `${url.pathname}${url.search}`;

    if (request.method === "GET") {
      return htmlResponse(authorizationPage({ action, clientName, requestedScopes }));
    }

    const limit = await authFailureLimited(runtimeEnv, request);
    if (limit.blocked) {
      return htmlResponse(authorizationPage({
        action,
        clientName,
        requestedScopes,
        error: "錯誤次數過多，請 10 分鐘後再試。",
      }), 429);
    }

    const form = await request.formData();
    const secret = String(form.get("secret") ?? "");
    const role = resolveRole(secret, runtimeEnv);
    if (!role) {
      await recordAuthFailure(runtimeEnv, limit.key, limit.current);
      return htmlResponse(authorizationPage({
        action,
        clientName,
        requestedScopes,
        error: "登入密碼錯誤。",
      }), 401);
    }
    await runtimeEnv.OAUTH_KV.delete(limit.key);

    const allowedScopes: string[] = role === "owner"
      ? ["taistock.read", "taistock.admin"]
      : ["taistock.read"];
    const requestedAllowed = requestedScopes.filter((scope: string) => allowedScopes.includes(scope));
    const grantedScopes = requestedAllowed.length > 0
      ? requestedAllowed
      : role === "owner" ? ["taistock.admin", "taistock.read"] : ["taistock.read"];
    const props: OAuthGrantProps = {
      role,
      permissions: role === "owner" ? ["read", "admin"] : ["read"],
      issued_at: new Date().toISOString(),
    };

    const { redirectTo } = await runtimeEnv.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId: role === "owner" ? "taistock-owner" : "taistock-family",
      metadata: { role },
      scope: grantedScopes,
      props,
    });
    return Response.redirect(redirectTo, 302);
  },
};

const oauthProvider = new OAuthProvider({
  apiHandlers: {
    "/my-mcp": MyMCP.serve("/my-mcp", { binding: "MCP_OBJECT" }),
    "/family-mcp": FamilyMCP.serve("/family-mcp", { binding: "FAMILY_MCP_OBJECT" }),
  },
  defaultHandler: authAndLegacyHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["taistock.read", "taistock.admin"],
  allowImplicitFlow: false,
  allowPlainPKCE: false,
  disallowPublicClientRegistration: false,
  accessTokenTTL: 3_600,
  refreshTokenTTL: 2_592_000,
  clientRegistrationTTL: 7_776_000,
  onError({ status, code, description }) {
    console.warn(`OAuth error response: ${status} ${code} - ${description}`);
  },
});

export { FamilyMCP, MyMCP } from "./index-v7";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return oauthProvider.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await Promise.all([
      legacyHandler.scheduled(controller, env, ctx),
      oauthProvider.purgeExpiredData(env, { batchSize: 100 }),
    ]);
  },
};
