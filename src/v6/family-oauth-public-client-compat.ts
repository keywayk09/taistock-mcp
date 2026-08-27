type ConcreteFetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

const FAMILY_SCOPE = "family:read";
const OWNER_SCOPE = "owner:full";
const OFFLINE_ACCESS_SCOPE = "offline_access";
const FAMILY_MCP_PATH = "/family-mcp";
const OWNER_MCP_PATHS = new Set(["/my-mcp", "/mcp"]);
const FAMILY_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/family-mcp";
const ROOT_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
const OWNER_RESOURCE_METADATA_PATHS = new Map([
  ["/.well-known/oauth-protected-resource/my-mcp", "/my-mcp"],
  ["/.well-known/oauth-protected-resource/mcp", "/mcp"],
]);
const CHATGPT_CONNECTOR_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{8,256}$/;
const CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH = "/connector_platform_oauth_redirect";
const OPAQUE_CLIENT_ID = /^[A-Za-z0-9._~-]{8,256}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const TRUSTED_CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

type OAuthResourceRole = "family" | "owner";

type ParsedOAuthResource = {
  role: OAuthResourceRole;
  canonical: string;
};

function canonicalFamilyResource(url: URL) {
  return new URL(FAMILY_MCP_PATH, url.origin).toString();
}

function canonicalOwnerResource(url: URL, pathname = "/my-mcp") {
  return new URL(pathname, url.origin).toString();
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

function parseExplicitOAuthResource(raw: string, origin: string): ParsedOAuthResource | null {
  if (!raw) return null;
  try {
    const resource = new URL(raw);
    if (resource.origin !== origin || resource.search || resource.hash) return null;
    const pathname = resource.pathname.endsWith("/") && resource.pathname !== "/"
      ? resource.pathname.slice(0, -1)
      : resource.pathname;
    if (pathname === FAMILY_MCP_PATH) {
      return { role: "family", canonical: new URL(FAMILY_MCP_PATH, origin).toString() };
    }
    if (OWNER_MCP_PATHS.has(pathname)) {
      return { role: "owner", canonical: new URL(pathname, origin).toString() };
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeAuthorizeResource(url: URL) {
  const raw = String(url.searchParams.get("resource") || "").trim();

  // Retained Family connectors may omit RFC 8707 `resource` during
  // reauthorization. Omission remains a legacy Family identity. Owner is never
  // inferred: Owner requests must explicitly identify /my-mcp or legacy /mcp.
  if (!raw) {
    url.searchParams.set("resource", canonicalFamilyResource(url));
    return true;
  }

  const parsed = parseExplicitOAuthResource(raw, url.origin);
  if (!parsed || raw === parsed.canonical) return false;
  url.searchParams.set("resource", parsed.canonical);
  return true;
}

function oauthBoundaryError() {
  return Response.json({
    error: "invalid_oauth_resource",
    message: "OAuth accepts explicit /my-mcp or /mcp for Owner, /family-mcp for Family, or an omitted legacy Family resource; Worker-root and unknown resources are rejected.",
  }, {
    status: 400,
    headers: { "cache-control": "no-store" },
  });
}

async function guardConnectorAuthorizationResource(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/authorize") return null;

  if (request.method === "GET") {
    if (!isTrustedConnectorAuthorization(url)) return null;
    const raw = String(url.searchParams.get("resource") || "").trim();
    if (raw && !parseExplicitOAuthResource(raw, url.origin)) return oauthBoundaryError();
    return null;
  }

  if (request.method !== "POST") return null;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return null;

  let bodyText: string;
  try {
    bodyText = await request.clone().text();
  } catch {
    return null;
  }
  const form = new URLSearchParams(bodyText);
  const oauthQuery = String(form.get("oauth_query") || "");
  if (!oauthQuery || oauthQuery.length > 12_000) return null;

  const synthetic = new URL("/authorize", request.url);
  synthetic.search = oauthQuery;
  if (!isTrustedConnectorAuthorization(synthetic)) return null;
  const raw = String(synthetic.searchParams.get("resource") || "").trim();
  if (raw && !parseExplicitOAuthResource(raw, synthetic.origin)) return oauthBoundaryError();
  return null;
}

async function normalizeAuthorizeRequest(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/authorize") return request;

  if (request.method === "GET") {
    const normalized = new URL(url.toString());
    if (!isTrustedConnectorAuthorization(normalized)) return request;
    if (!normalizeAuthorizeResource(normalized)) return request;
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
  if (!normalizeAuthorizeResource(synthetic)) return request;

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

async function connectorTokenTargetIsInvalid(request: Request) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/oauth/token") return false;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return false;

  let bodyText: string;
  try {
    bodyText = await request.clone().text();
  } catch {
    return false;
  }
  const params = new URLSearchParams(bodyText);
  if (params.get("grant_type") !== "authorization_code") return false;
  if (!PKCE_VERIFIER.test(String(params.get("code_verifier") || ""))) return false;
  if (!trustedConnectorRedirect(String(params.get("redirect_uri") || ""))) return false;
  const raw = String(params.get("resource") || "").trim();

  // RFC 8707 resource is optional at token exchange. If omitted, the inner
  // provider validates the authorization code and inherits its proven target.
  if (!raw) return false;
  return !parseExplicitOAuthResource(raw, url.origin);
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

  // Some retained ChatGPT public DCR clients serialize OAuth `none` as HTTP
  // Basic `<client_id>:`. An empty password is not a client credential.
  if (basic && basic.clientSecret === "") {
    headers.delete("authorization");
    params.set("client_id", basic.clientId);
    params.delete("client_secret");
    changed = true;
  }

  const rawResource = String(params.get("resource") || "").trim();
  const parsed = parseExplicitOAuthResource(rawResource, url.origin);
  if (parsed && rawResource !== parsed.canonical) {
    params.set("resource", parsed.canonical);
    changed = true;
  }

  if (!changed) return request;
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: params.toString(),
  });
}

function familyProtectedResourceMetadata(request: Request) {
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

function ownerProtectedResourceMetadata(request: Request, pathname: string) {
  const url = new URL(request.url);
  return Response.json({
    resource: canonicalOwnerResource(url, pathname),
    authorization_servers: [url.origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [OWNER_SCOPE],
    resource_name: "Taiwan Stock AI Owner / Diamond MCP",
  }, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function unprotectedIngressMetadata() {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function authorizationServerMetadataWithOfflineAccess(
  request: Request,
  provider: ConcreteFetchHandler,
  env: Env,
  ctx: ExecutionContext,
) {
  // ChatGPT probes both RFC 8414 OAuth discovery and the historical OpenID
  // discovery path. This remains one authorization server with two strictly
  // resource-scoped roles: Owner and Family.
  const sourceUrl = new URL(request.url);
  if (sourceUrl.pathname === "/.well-known/openid-configuration") {
    sourceUrl.pathname = "/.well-known/oauth-authorization-server";
    sourceUrl.search = "";
    sourceUrl.hash = "";
  }
  const metadataRequest = sourceUrl.toString() === request.url
    ? request
    : new Request(sourceUrl.toString(), request);
  const response = await provider.fetch(metadataRequest, env, ctx);
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
  if (!scopes.includes(OWNER_SCOPE)) scopes.push(OWNER_SCOPE);
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
 * Stable public-ingress OAuth adapter.
 *
 * External MCP endpoint identities are ABI:
 * - Owner/Diamond: /my-mcp (legacy /mcp alias)
 * - Family: /family-mcp
 *
 * Each endpoint owns path-scoped RFC 9728 metadata. Internal OAuth/runtime
 * implementations may evolve without moving these public identities. Omitted
 * resource remains a retained Family compatibility case; Owner is always
 * explicit and can never be inferred from root or unknown resources.
 */
export function createFamilyOAuthPublicClientCompatWrapper(provider: ConcreteFetchHandler): ConcreteFetchHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === FAMILY_RESOURCE_METADATA_PATH) {
        return familyProtectedResourceMetadata(request);
      }
      if (request.method === "GET" && OWNER_RESOURCE_METADATA_PATHS.has(url.pathname)) {
        return ownerProtectedResourceMetadata(request, OWNER_RESOURCE_METADATA_PATHS.get(url.pathname)!);
      }
      if (request.method === "GET" && url.pathname === ROOT_RESOURCE_METADATA_PATH) {
        return unprotectedIngressMetadata();
      }
      if (
        request.method === "GET"
        && (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration")
      ) {
        return authorizationServerMetadataWithOfflineAccess(request, provider, env, ctx);
      }

      const boundaryError = await guardConnectorAuthorizationResource(request);
      if (boundaryError) return boundaryError;
      if (await connectorTokenTargetIsInvalid(request)) return oauthBoundaryError();

      const authorizeNormalized = await normalizeAuthorizeRequest(request);
      const tokenNormalized = await normalizePublicTokenRequest(authorizeNormalized);
      return provider.fetch(tokenNormalized, env, ctx);
    },
  };
}
