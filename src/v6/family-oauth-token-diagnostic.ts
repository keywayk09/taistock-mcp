type ConcreteFetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

export type FamilyTokenDiagnostic = {
  isTokenEndpoint: boolean;
  formEncoded?: boolean;
  grantType?: string;
  authMethod?: "client_secret_basic" | "client_secret_post" | "none" | "unknown";
  hasBodyClientId?: boolean;
  hasBodyClientSecret?: boolean;
  hasRedirectUri?: boolean;
  hasScope?: boolean;
  hasResource?: boolean;
  hasCode?: boolean;
  hasCodeVerifier?: boolean;
};

const DIAG_KEY = "diag:family-token:last";
const DIAG_TTL_SECONDS = 10 * 60;

function detectAuthMethod(request: Request, form: URLSearchParams): FamilyTokenDiagnostic["authMethod"] {
  const auth = request.headers.get("authorization") || "";
  if (/^basic\s+/i.test(auth)) return "client_secret_basic";
  if (form.has("client_secret")) return "client_secret_post";
  if (form.has("client_id")) return "none";
  return "unknown";
}

export async function getFamilyTokenDiagnostic(request: Request): Promise<FamilyTokenDiagnostic> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/oauth/token") {
    return { isTokenEndpoint: false };
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return { isTokenEndpoint: true, formEncoded: false, authMethod: "unknown" };
  }

  let text = "";
  try {
    text = await request.clone().text();
  } catch {
    return { isTokenEndpoint: true, formEncoded: true, authMethod: "unknown" };
  }

  const form = new URLSearchParams(text);
  return {
    isTokenEndpoint: true,
    formEncoded: true,
    grantType: String(form.get("grant_type") || ""),
    authMethod: detectAuthMethod(request, form),
    hasBodyClientId: form.has("client_id"),
    hasBodyClientSecret: form.has("client_secret"),
    hasRedirectUri: form.has("redirect_uri"),
    hasScope: form.has("scope"),
    hasResource: form.has("resource"),
    hasCode: form.has("code"),
    hasCodeVerifier: form.has("code_verifier"),
  };
}

function safeRecord(diag: FamilyTokenDiagnostic, status?: number) {
  return {
    event: "FAMILY_OAUTH_TOKEN_DIAG",
    observed_at: new Date().toISOString(),
    form_encoded: Boolean(diag.formEncoded),
    grant_type_is_authorization_code: diag.grantType === "authorization_code",
    auth_method: diag.authMethod || "unknown",
    has_body_client_id: Boolean(diag.hasBodyClientId),
    has_body_client_secret: Boolean(diag.hasBodyClientSecret),
    has_redirect_uri: Boolean(diag.hasRedirectUri),
    has_scope: Boolean(diag.hasScope),
    has_resource: Boolean(diag.hasResource),
    has_code: Boolean(diag.hasCode),
    has_code_verifier: Boolean(diag.hasCodeVerifier),
    ...(typeof status === "number" ? { response_status: status } : {}),
  };
}

async function persistFamilyTokenDiagnostic(env: Env, diag: FamilyTokenDiagnostic, status?: number) {
  if (!diag.isTokenEndpoint) return;
  const record = safeRecord(diag, status);
  // SECURITY: this record contains only booleans/categories and HTTP status.
  // It never stores request values, secrets, authorization codes, verifiers,
  // client IDs, tokens, redirect values, scopes, or the Family verification code.
  await env.OAUTH_KV.put(DIAG_KEY, JSON.stringify(record), { expirationTtl: DIAG_TTL_SECONDS }).catch(() => undefined);
}

export function logFamilyTokenDiagnostic(diag: FamilyTokenDiagnostic, status?: number) {
  if (!diag.isTokenEndpoint) return;
  console.log(JSON.stringify(safeRecord(diag, status)));
}

export function createFamilyOAuthTokenDiagnosticWrapper(provider: ConcreteFetchHandler): ConcreteFetchHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const diag = await getFamilyTokenDiagnostic(request);
      if (!diag.isTokenEndpoint) return provider.fetch(request, env, ctx);

      // Persist a pre-provider observation so even an exception or transport
      // failure leaves a safe indication that /oauth/token was actually reached.
      await persistFamilyTokenDiagnostic(env, diag);

      try {
        const response = await provider.fetch(request, env, ctx);
        await persistFamilyTokenDiagnostic(env, diag, response.status);
        logFamilyTokenDiagnostic(diag, response.status);
        return response;
      } catch (error) {
        await persistFamilyTokenDiagnostic(env, diag, 599);
        logFamilyTokenDiagnostic(diag, 599);
        throw error;
      }
    },
  };
}
