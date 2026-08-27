import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

/**
 * Dedicated Owner/Diamond OAuth authorization-server plane.
 *
 * Important boundary:
 * - The canonical MCP resource stays on taistock-mcp /my-mcp.
 * - This Worker owns only OAuth issuer/DCR/token identity.
 * - Production Owner password verification remains on the canonical taistock-mcp
 *   /authorize handler; this Worker proxies the authorization UI there.
 * - OAUTH_KV is intentionally shared with taistock-mcp so opaque tokens issued
 *   by this isolated issuer are verifiable by the canonical MCP resource server.
 */

const OWNER_SCOPE = "owner:full";
const OFFLINE_ACCESS_SCOPE = "offline_access";
const DEFAULT_OWNER_MCP_ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const OWNER_MCP_PATHS = new Set(["/my-mcp", "/mcp"]);
const TOKEN_ENDPOINT = "/oauth/token";
const REGISTER_ENDPOINT = "/oauth/register";

type OwnerOAuthWorkerEnv = Env & {
  OWNER_MCP_ORIGIN?: string;
  OWNER_OAUTH_STAGING_SECRET?: string;
};

type ConcreteFetchHandler = {
  fetch(request: Request, env: OwnerOAuthWorkerEnv, ctx: ExecutionContext): Response | Promise<Response>;
};

function ownerMcpOrigin(env: OwnerOAuthWorkerEnv) {
  const raw = String(env.OWNER_MCP_ORIGIN || DEFAULT_OWNER_MCP_ORIGIN).trim();
  const url = new URL(raw);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("OWNER_MCP_ORIGIN must be HTTPS outside local development");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function parseOwnerResource(raw: string, env: OwnerOAuthWorkerEnv) {
  if (!raw) return null;
  try {
    const candidate = new URL(raw);
    if (candidate.origin !== ownerMcpOrigin(env) || candidate.search || candidate.hash) return null;
    const pathname = candidate.pathname.endsWith("/") && candidate.pathname !== "/"
      ? candidate.pathname.slice(0, -1)
      : candidate.pathname;
    if (!OWNER_MCP_PATHS.has(pathname)) return null;
    return new URL(pathname, ownerMcpOrigin(env)).toString();
  } catch {
    return null;
  }
}

async function requestBodyText(request: Request) {
  try {
    return await request.clone().text();
  } catch {
    return "";
  }
}

/**
 * Fail closed if an authorization request does not explicitly target the frozen
 * Owner MCP resource. Owner is never inferred from issuer root or omission.
 */
async function ownerAuthorizeTargetIsValid(request: Request, env: OwnerOAuthWorkerEnv) {
  const url = new URL(request.url);
  if (url.pathname !== "/authorize") return false;

  if (request.method === "GET") {
    return Boolean(parseOwnerResource(String(url.searchParams.get("resource") || "").trim(), env));
  }

  if (request.method !== "POST") return false;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return false;
  const body = new URLSearchParams(await requestBodyText(request));
  const oauthQuery = String(body.get("oauth_query") || "");
  if (!oauthQuery || oauthQuery.length > 12_000) return false;
  const synthetic = new URL("/authorize", request.url);
  synthetic.search = oauthQuery;
  return Boolean(parseOwnerResource(String(synthetic.searchParams.get("resource") || "").trim(), env));
}

/** Token and refresh requests may omit RFC 8707 resource and inherit the grant. */
async function ownerTokenTargetIsValid(request: Request, env: OwnerOAuthWorkerEnv) {
  const url = new URL(request.url);
  if (url.pathname !== TOKEN_ENDPOINT || request.method !== "POST") return true;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return true;
  const body = new URLSearchParams(await requestBodyText(request));
  const raw = String(body.get("resource") || "").trim();
  return !raw || Boolean(parseOwnerResource(raw, env));
}

function invalidOwnerTarget() {
  return Response.json({
    error: "invalid_target",
    error_description: "Owner OAuth may issue tokens only for the canonical /my-mcp or legacy /mcp Owner resource.",
  }, {
    status: 400,
    headers: { "cache-control": "no-store" },
  });
}

function timingSafeEqualText(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const width = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let i = 0; i < width; i += 1) diff |= (a[i % Math.max(a.length, 1)] || 0) ^ (b[i % Math.max(b.length, 1)] || 0);
  return diff === 0;
}

/**
 * Branch-only staging hook. Production never configures this secret, so the
 * production /authorize path always proxies to the canonical password verifier.
 * It exists solely to prove that a token issued on this second OAuth origin can
 * be consumed by the existing production /my-mcp resource before discovery is cut over.
 */
async function handleStagingAuthorization(request: Request, env: OwnerOAuthWorkerEnv) {
  const stagingSecret = String(env.OWNER_OAUTH_STAGING_SECRET || "");
  if (!stagingSecret) return null;

  if (request.method === "GET") {
    let oauthRequest;
    try {
      oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const query = new URL(request.url).searchParams.toString();
    return new Response(`<!doctype html><meta charset="utf-8"><title>Owner OAuth staging</title><form method="post" action="/authorize"><input type="hidden" name="oauth_query" value="${query.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"><input type="password" name="login_secret"><button type="submit">Continue</button></form><!-- client:${String(oauthRequest.clientId || "").length} -->`, {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'",
      },
    });
  }

  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const form = new URLSearchParams(await requestBodyText(request));
  if (!timingSafeEqualText(String(form.get("login_secret") || ""), stagingSecret)) {
    return Response.json({ error: "access_denied" }, { status: 403 });
  }
  const oauthQuery = String(form.get("oauth_query") || "");
  const synthetic = new Request(new URL(`/authorize?${oauthQuery}`, request.url));
  let oauthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(synthetic);
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: "owner",
    metadata: { role: "owner", staging: true },
    scope: [OWNER_SCOPE],
    props: { userId: "owner", role: "owner" },
  });
  return Response.redirect(redirectTo, 302);
}

async function proxyOwnerAuthorization(request: Request, env: OwnerOAuthWorkerEnv) {
  const source = new URL(request.url);
  const target = new URL("/authorize", ownerMcpOrigin(env));
  target.search = source.search;
  const upstream = new Request(target.toString(), request);
  return fetch(upstream, { redirect: "manual" });
}

const defaultHandler: ConcreteFetchHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, role: "owner-oauth", mcp_resource: new URL("/my-mcp", ownerMcpOrigin(env)).toString() }, {
        headers: { "cache-control": "no-store" },
      });
    }
    if (url.pathname !== "/authorize") return new Response("Not Found", { status: 404 });
    if (!await ownerAuthorizeTargetIsValid(request, env)) return invalidOwnerTarget();
    const staged = await handleStagingAuthorization(request, env);
    if (staged) return staged;
    return proxyOwnerAuthorization(request, env);
  },
};

const neverApiHandler: ConcreteFetchHandler = {
  async fetch() {
    return new Response("Not Found", { status: 404 });
  },
};

const provider = new OAuthProvider<OwnerOAuthWorkerEnv>({
  apiRoute: "/__owner-oauth-protected-never",
  apiHandler: neverApiHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: TOKEN_ENDPOINT,
  clientRegistrationEndpoint: REGISTER_ENDPOINT,
  scopesSupported: [OWNER_SCOPE],
  allowPlainPKCE: false,
  allowImplicitFlow: false,
  clientIdMetadataDocumentEnabled: true,
}) as unknown as ConcreteFetchHandler;

async function authorizationServerMetadata(request: Request, env: OwnerOAuthWorkerEnv, ctx: ExecutionContext) {
  const source = new URL(request.url);
  if (source.pathname === "/.well-known/openid-configuration") {
    source.pathname = "/.well-known/oauth-authorization-server";
    source.search = "";
    source.hash = "";
  }
  const response = await provider.fetch(source.toString() === request.url ? request : new Request(source.toString(), request), env, ctx);
  if (!response.ok) return response;
  let body: Record<string, unknown>;
  try {
    body = await response.clone().json() as Record<string, unknown>;
  } catch {
    return response;
  }
  const scopes = Array.isArray(body.scopes_supported)
    ? body.scopes_supported.filter((scope): scope is string => typeof scope === "string")
    : [];
  if (!scopes.includes(OWNER_SCOPE)) scopes.push(OWNER_SCOPE);
  if (!scopes.includes(OFFLINE_ACCESS_SCOPE)) scopes.push(OFFLINE_ACCESS_SCOPE);
  body.scopes_supported = scopes;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: OwnerOAuthWorkerEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") {
      return authorizationServerMetadata(request, env, ctx);
    }

    // Retain the legacy endpoint spellings that older ChatGPT OAuth clients may cache.
    if (url.pathname === "/register") {
      const target = new URL(request.url);
      target.pathname = REGISTER_ENDPOINT;
      return provider.fetch(new Request(target.toString(), request), env, ctx);
    }
    if (url.pathname === "/token") {
      const target = new URL(request.url);
      target.pathname = TOKEN_ENDPOINT;
      const rewritten = new Request(target.toString(), request);
      if (!await ownerTokenTargetIsValid(rewritten, env)) return invalidOwnerTarget();
      return provider.fetch(rewritten, env, ctx);
    }

    if (!await ownerTokenTargetIsValid(request, env)) return invalidOwnerTarget();
    return provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<OwnerOAuthWorkerEnv>;
