type ConcreteFetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

type ConnectorAuthRequest = {
  clientId: string;
  redirectUri: string;
  role: "family" | "owner";
};

type StoredFamilyConnectorClient = {
  clientId?: string;
  clientSecret?: string;
  redirectUris?: string[];
  clientName?: string;
  grantTypes?: string[];
  responseTypes?: string[];
  tokenEndpointAuthMethod?: string;
  authMethodExplicit?: true;
  recoveryKind?: string;
};

type StoredGrant = {
  id?: string;
  clientId?: string;
  userId?: string;
  scope?: string[];
  authCodeId?: string;
  authCodeWrappedKey?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  redirectUri?: string;
};

type PreparedConnectorToken = {
  request: Request;
  clientKey?: string;
  previousClientRaw?: string;
  clientChanged?: boolean;
  matched?: boolean;
  earlyResponse?: Response;
};

const FAMILY_SCOPE = "family:read";
const FAMILY_CONNECTOR_NAME = "ChatGPT Family Plugin / MCP App";
const FAMILY_MCP_PATH = "/family-mcp";
const OWNER_MCP_PATHS = new Set(["/my-mcp", "/mcp"]);
const CHATGPT_CONNECTOR_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{8,256}$/;
const CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH = "/connector_platform_oauth_redirect";
const OPAQUE_CLIENT_ID = /^[A-Za-z0-9._~-]{8,256}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const OAUTH_SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]{1,128}$/;
const MAX_RECOVERY_SCOPE_TOKENS = 24;
const MAX_RECOVERY_SCOPE_LENGTH = 2_048;
const TRUSTED_CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validConnectorScopes(rawScope: string) {
  const scopes = rawScope.split(/\s+/).filter(Boolean);
  if (rawScope.length > MAX_RECOVERY_SCOPE_LENGTH) return false;
  if (scopes.length > MAX_RECOVERY_SCOPE_TOKENS) return false;
  return scopes.every((scope) => OAUTH_SCOPE_TOKEN.test(scope));
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

function connectorResourceRole(url: URL): "family" | "owner" | null {
  const raw = String(url.searchParams.get("resource") || "").trim();
  if (!raw) return "family";
  try {
    const resource = new URL(raw);
    if (resource.origin !== url.origin || resource.search || resource.hash) return null;
    const pathname = resource.pathname.endsWith("/") && resource.pathname !== "/"
      ? resource.pathname.slice(0, -1)
      : resource.pathname;
    if (pathname === FAMILY_MCP_PATH) return "family";
    if (OWNER_MCP_PATHS.has(pathname)) return "owner";
    return null;
  } catch {
    return null;
  }
}

function connectorAuthorization(url: URL): ConnectorAuthRequest | null {
  if (url.pathname !== "/authorize" || url.searchParams.get("response_type") !== "code") return null;
  const clientId = String(url.searchParams.get("client_id") || "");
  if (!OPAQUE_CLIENT_ID.test(clientId)) return null;

  const redirectRaw = String(url.searchParams.get("redirect_uri") || "");
  const redirect = trustedConnectorRedirect(redirectRaw);
  if (!redirect) return null;

  const method = String(url.searchParams.get("code_challenge_method") || "");
  const challenge = String(url.searchParams.get("code_challenge") || "");
  if (method !== "S256" || !PKCE_S256_CHALLENGE.test(challenge)) return null;

  const state = String(url.searchParams.get("state") || "");
  if (!state || state.length > 2_000) return null;

  const rawScope = String(url.searchParams.get("scope") || "");
  if (!validConnectorScopes(rawScope)) return null;

  const role = connectorResourceRole(url);
  if (!role) return null;
  return { clientId, redirectUri: redirect.toString(), role };
}

function normalizeConnectorAuthorizeUrl(url: URL) {
  const candidate = connectorAuthorization(url);
  if (!candidate) return { url, candidate: null as ConnectorAuthRequest | null };

  // This wrapper is strictly Family stale-client recovery. Explicit Owner
  // requests must cross it byte-for-byte so the role-aware provider can grant
  // owner:full only after the Owner secret is proven.
  if (candidate.role === "owner") return { url, candidate };

  const normalized = new URL(url.toString());
  normalized.searchParams.set("scope", FAMILY_SCOPE);
  return { url: normalized, candidate };
}

async function normalizeAuthorizeRequest(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/authorize") return { request, candidate: null as ConnectorAuthRequest | null };

  if (request.method === "GET") {
    const normalized = normalizeConnectorAuthorizeUrl(url);
    if (!normalized.candidate || normalized.url.toString() === url.toString()) {
      return { request, candidate: normalized.candidate };
    }
    return {
      request: new Request(normalized.url.toString(), request),
      candidate: normalized.candidate,
    };
  }

  if (request.method !== "POST") return { request, candidate: null as ConnectorAuthRequest | null };
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return { request, candidate: null as ConnectorAuthRequest | null };
  }

  let bodyText: string;
  try {
    bodyText = await request.clone().text();
  } catch {
    return { request, candidate: null as ConnectorAuthRequest | null };
  }
  const form = new URLSearchParams(bodyText);
  const oauthQuery = String(form.get("oauth_query") || "");
  if (!oauthQuery || oauthQuery.length > 12_000) return { request, candidate: null as ConnectorAuthRequest | null };

  const synthetic = new URL("/authorize", request.url);
  synthetic.search = oauthQuery;
  const normalized = normalizeConnectorAuthorizeUrl(synthetic);
  if (!normalized.candidate || normalized.url.toString() === synthetic.toString()) {
    return { request, candidate: normalized.candidate };
  }

  form.set("oauth_query", normalized.url.searchParams.toString());
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      body: form.toString(),
    }),
    candidate: normalized.candidate,
  };
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

function oauthError(code: string, description: string, status = 400) {
  return Response.json({ error: code, error_description: description }, {
    status,
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
}

function familyConnectorClientMatches(stored: StoredFamilyConnectorClient, clientId: string, redirectUri: string) {
  return stored.clientId === clientId
    && stored.clientName === FAMILY_CONNECTOR_NAME
    && Array.isArray(stored.redirectUris)
    && stored.redirectUris.length === 1
    && stored.redirectUris[0] === redirectUri
    && Array.isArray(stored.grantTypes)
    && stored.grantTypes.includes("authorization_code")
    && Array.isArray(stored.responseTypes)
    && stored.responseTypes.includes("code");
}

async function validateFamilyAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string,
  env: Env,
) {
  const parts = code.split(":");
  if (parts.length !== 3 || parts[0] !== "family" || !parts[1]) return null;
  const [userId, grantId] = parts;
  const grantKey = `grant:${userId}:${grantId}`;
  const grant = await env.OAUTH_KV.get<StoredGrant>(grantKey, { type: "json" });
  if (!grant) return null;
  if (grant.userId !== "family" || grant.clientId !== clientId) return null;
  if (!grant.authCodeId || !grant.authCodeWrappedKey) return null;
  if (!constantTimeEqual(await sha256Hex(code), grant.authCodeId)) return null;
  if (!Array.isArray(grant.scope) || grant.scope.length !== 1 || grant.scope[0] !== FAMILY_SCOPE) return null;
  if (!grant.codeChallenge || !PKCE_S256_CHALLENGE.test(grant.codeChallenge) || grant.codeChallengeMethod !== "S256") return null;
  if (grant.redirectUri !== redirectUri) return null;
  return grant;
}

async function prepareConnectorTokenExchange(request: Request, env: Env): Promise<PreparedConnectorToken> {
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
      : postedClientId
        ? { clientId: postedClientId, clientSecret: "", method: "none" as const }
        : null
  );
  if (!presented || !OPAQUE_CLIENT_ID.test(presented.clientId) || presented.clientSecret.length > 4_096) return { request };

  const redirectRaw = String(params.get("redirect_uri") || "");
  const redirect = trustedConnectorRedirect(redirectRaw);
  if (!redirect) return { request };
  const redirectUri = redirect.toString();

  const code = String(params.get("code") || "");
  if (!code) return { request };
  const grant = await validateFamilyAuthorizationCode(code, presented.clientId, redirectUri, env);
  if (!grant) return { request };

  if (params.has("scope")) {
    const rawScope = String(params.get("scope") || "");
    if (!validConnectorScopes(rawScope)) {
      return { request, matched: true, earlyResponse: oauthError("invalid_scope", "Malformed connector scope metadata") };
    }
    // Requested ChatGPT/OIDC/MCP scope names are transport metadata only.
    // The authorization grant is already proven to contain exactly family:read.
    params.set("scope", FAMILY_SCOPE);
  }

  const clientKey = `client:${presented.clientId}`;
  const previousClientRaw = await env.OAUTH_KV.get(clientKey);
  if (!previousClientRaw) return { request };

  let stored: StoredFamilyConnectorClient;
  try {
    stored = JSON.parse(previousClientRaw) as StoredFamilyConnectorClient;
  } catch {
    return { request };
  }
  if (!familyConnectorClientMatches(stored, presented.clientId, redirectUri)) return { request };

  let clientChanged = false;
  if (presented.method === "none") {
    if (stored.clientSecret || stored.tokenEndpointAuthMethod !== "none") return { request };
  } else {
    if (!presented.clientSecret) return { request };
    const presentedHash = await sha256Hex(presented.clientSecret);
    if (stored.clientSecret) {
      if (!constantTimeEqual(presentedHash, stored.clientSecret)) return { request };
      if (stored.tokenEndpointAuthMethod !== presented.method || stored.recoveryKind !== "connector") {
        stored.tokenEndpointAuthMethod = presented.method;
        stored.authMethodExplicit = true;
        stored.recoveryKind = "connector";
        await env.OAUTH_KV.put(clientKey, JSON.stringify(stored));
        clientChanged = true;
      }
    } else {
      if (stored.tokenEndpointAuthMethod !== "none") return { request };
      // Lost DCR registry recovery: learn the retained ChatGPT secret only after
      // proving the exact unconsumed Family authorization code. The provider
      // still verifies the PKCE code_verifier before issuing any token.
      stored.clientSecret = presentedHash;
      stored.tokenEndpointAuthMethod = presented.method;
      stored.authMethodExplicit = true;
      stored.recoveryKind = "connector";
      await env.OAUTH_KV.put(clientKey, JSON.stringify(stored));
      clientChanged = true;
    }
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const forwarded = new Request(request.url, {
    method: request.method,
    headers,
    body: params.toString(),
  });
  return {
    request: forwarded,
    clientKey,
    previousClientRaw,
    clientChanged,
    matched: true,
  };
}

async function rollbackConnectorClient(prepared: PreparedConnectorToken, env: Env) {
  if (!prepared.clientChanged || !prepared.clientKey || prepared.previousClientRaw === undefined) return;
  await env.OAUTH_KV.put(prepared.clientKey, prepared.previousClientRaw).catch(() => undefined);
}

export function createFamilyOAuthTokenRecoveryWrapper(provider: ConcreteFetchHandler): ConcreteFetchHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const normalized = await normalizeAuthorizeRequest(request);
      const tokenPrepared = await prepareConnectorTokenExchange(normalized.request, env);
      if (tokenPrepared.earlyResponse) return tokenPrepared.earlyResponse;

      try {
        const response = await provider.fetch(tokenPrepared.request, env, ctx);
        if (tokenPrepared.matched && !response.ok) {
          await rollbackConnectorClient(tokenPrepared, env);
        }
        return response;
      } catch (error) {
        await rollbackConnectorClient(tokenPrepared, env);
        throw error;
      }
    },
  };
}
