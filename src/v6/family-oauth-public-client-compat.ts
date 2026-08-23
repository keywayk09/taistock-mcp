type ConcreteFetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

const FAMILY_SCOPE = "family:read";
const OFFLINE_ACCESS_SCOPE = "offline_access";
const FAMILY_MCP_PATH = "/family-mcp";
const CHATGPT_CONNECTOR_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{8,256}$/;
const CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH = "/connector_platform_oauth_redirect";
const OPAQUE_CLIENT_ID = /^[A-Za-z0-9._~-]{8,256}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const TRUSTED_CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

function canonicalFamilyResource(url: URL) {
  return new URL(FAMILY_MCP_PATH, url.origin).toString();
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

function isTrustedConnectorAuthorization(url: URL) {
  if (url.pathname !== "/authorize" || url.searchParams.get("response_type") !== "code") return false;
  const clientId = String(url.searchParams.get("client_id") || "");
  if (!OPAQUE_CLIENT_ID.test(clientId)) return false;
  if (!trustedConnectorRedirect(String(url.searchParams.get("redirect_uri") || ""))) return false;
  const method = String(url.searchParams.get("code_challenge_method") || "");
  const challenge = String(url.searchParams.get("code_challenge") || "");
  if (method !== "S256" || !PKCE_S256_CHALLENGE.test(challenge)) return false;
  const state = String(url.searchParams.get("state") || "");
  return Boolean(state) && state.length <= 2_000;
}

function normalizeFamilyResource(url: URL) {
  const raw = String(url.searchParams.get("resource") || "").trim();
  const canonical = canonicalFamilyResource(url);
  if (!raw) {
    url.searchParams.set("resource", canonical);
    return true;
  }

  try {
    const resource = new URL(raw);
    if (resource.origin !== url.origin || resource.search || resource.hash) return false;
    if (resource.pathname !== "/" && resource.pathname !== FAMILY_MCP_PATH) return false;
    if (resource.toString() === canonical) return false;
    url.searchParams.set("resource", canonical);
    return true;
  } catch {
    return false;
  }
}

async function normalizeAuthorizeRequest(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/authorize") return request;

  if (request.method === "GET") {
    const normalized = new URL(url.toString());
    if (!isTrustedConnectorAuthorization(normalized)) return request;
    if (!normalizeFamilyResource(normalized)) return request;
    return new Request(normalized.toString(), request);
  }

  if (request.method !== "POST") return request;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return request;

  let bodyText: string;
  try {
    bodyText = await request.clone().text();
  } catch {
    return request;
  }
  const form = new URLSearchParams(bodyText);
  const oauthQuery = String(form.get("oauth_query") || "");
  if (!oauthQuery || oauthQuery.length > 12_000) return request;

  const synthetic = new URL("/authorize", request.url);
  synthetic.search = oauthQuery;
  if (!isTrustedConnectorAuthorization(synthetic)) return request;
  if (!normalizeFamilyResource(synthetic)) return request;

  form.set("oauth_query", synthetic.searchParams.toString());
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: form.toString(),
  });
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
    };
  } catch {
    return null;
  }
}

async function normalizePublicTokenRequest(request: Request) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/oauth/token") return request;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return request;

  let bodyText: string;
  try {
    bodyText = await request.clone().text();
  } catch {
    return request;
  }
  const params = new URLSearchParams(bodyText);
  if (params.get("grant_type") !== "authorization_code") return request;
  if (!String(params.get("code") || "")) return request;
  if (!PKCE_VERIFIER.test(String(params.get("code_verifier") || ""))) return request;
  if (!trustedConnectorRedirect(String(params.get("redirect_uri") || ""))) return request;

  const basic = decodeBasicClientAuth(request.headers.get("authorization") || "");
  const postedClientId = String(params.get("client_id") || "");
  const clientId = basic?.clientId || postedClientId;
  if (!OPAQUE_CLIENT_ID.test(clientId)) return request;

  const headers = new Headers(request.headers);
  let changed = false;

  // Some retained ChatGPT public DCR clients can serialize OAuth `none` as
  // HTTP Basic `<client_id>:`. An empty password is not a client credential.
  // Convert only that exact shape back to the standards-level public-client
  // representation before the existing Family token-recovery gate validates
  // the authorization code and the OAuth provider validates the PKCE verifier.
  if (basic && basic.clientSecret === "") {
    headers.delete("authorization");
    params.set("client_id", basic.clientId);
    params.delete("client_secret");
    changed = true;
  }

  const resourceUrl = new URL(request.url);
  const rawResource = String(params.get("resource") || "").trim();
  const canonical = canonicalFamilyResource(resourceUrl);
  if (!rawResource) {
    params.set("resource", canonical);
    changed = true;
  } else {
    try {
      const resource = new URL(rawResource);
      if (
        resource.origin === resourceUrl.origin
        && !resource.search
        && !resource.hash
        && (resource.pathname === "/" || resource.pathname === FAMILY_MCP_PATH)
        && resource.toString() !== canonical
      ) {
        params.set("resource", canonical);
        changed = true;
      }
    } catch {
      // Leave malformed resource metadata untouched so the OAuth provider
      // rejects it normally; this compatibility layer never broadens targets.
    }
  }

  if (!changed) return request;
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: params.toString(),
  });
}

function canonicalProtectedResourceMetadata(request: Request) {
  const url = new URL(request.url);
  return Response.json({
    resource: canonicalFamilyResource(url),
    authorization_servers: [url.origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [FAMILY_SCOPE],
    resource_name: "Taiwan Stock AI Family MCP",
  }, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function authorizationServerMetadataWithOfflineAccess(
  request: Request,
  provider: ConcreteFetchHandler,
  env: Env,
  ctx: ExecutionContext,
) {
  const response = await provider.fetch(request, env, ctx);
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
  if (!scopes.includes(FAMILY_SCOPE)) scopes.push(FAMILY_SCOPE);
  if (!scopes.includes(OFFLINE_ACCESS_SCOPE)) scopes.push(OFFLINE_ACCESS_SCOPE);
  body.scopes_supported = scopes;

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Compatibility layer for retained and freshly recreated ChatGPT public MCP
 * registrations.
 *
 * It does not issue tokens and it does not grant permissions. It only removes
 * transport/discovery ambiguities before the existing strict Family OAuth gates:
 * 1) every Family protected-resource identifier is canonicalized to
 *    `<worker-origin>/family-mcp`;
 * 2) HTTP Basic `<client_id>:` is normalized to OAuth public-client `none`;
 * 3) authorization-server discovery advertises `offline_access` so a newly
 *    recreated ChatGPT app can request refresh-token continuity, while the
 *    actual Family permission grant remains exactly `family:read`.
 *
 * The inner token-recovery wrapper still proves the exact authorization code,
 * trusted redirect and `family:read` grant, and the OAuth provider still proves
 * the PKCE verifier before any token can be issued.
 */
export function createFamilyOAuthPublicClientCompatWrapper(provider: ConcreteFetchHandler): ConcreteFetchHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
        return canonicalProtectedResourceMetadata(request);
      }
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
        return authorizationServerMetadataWithOfflineAccess(request, provider, env, ctx);
      }

      const authorizeNormalized = await normalizeAuthorizeRequest(request);
      const tokenNormalized = await normalizePublicTokenRequest(authorizeNormalized);
      return provider.fetch(tokenNormalized, env, ctx);
    },
  };
}
