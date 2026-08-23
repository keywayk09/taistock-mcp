type ConcreteFetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

export type FamilyTokenDiagnostic = {
  isTokenEndpoint: boolean;
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
    return { isTokenEndpoint: true, authMethod: "unknown" };
  }

  let text = "";
  try {
    text = await request.clone().text();
  } catch {
    return { isTokenEndpoint: true, authMethod: "unknown" };
  }

  const form = new URLSearchParams(text);
  return {
    isTokenEndpoint: true,
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

export function logFamilyTokenDiagnostic(diag: FamilyTokenDiagnostic, status?: number) {
  if (!diag.isTokenEndpoint) return;
  // SECURITY: never log request values. Only categorical presence/type metadata.
  console.log(JSON.stringify({
    event: "FAMILY_OAUTH_TOKEN_DIAG",
    grant_type: diag.grantType || null,
    auth_method: diag.authMethod || "unknown",
    has_body_client_id: Boolean(diag.hasBodyClientId),
    has_body_client_secret: Boolean(diag.hasBodyClientSecret),
    has_redirect_uri: Boolean(diag.hasRedirectUri),
    has_scope: Boolean(diag.hasScope),
    has_resource: Boolean(diag.hasResource),
    has_code: Boolean(diag.hasCode),
    has_code_verifier: Boolean(diag.hasCodeVerifier),
    ...(typeof status === "number" ? { response_status: status } : {}),
  }));
}

export function createFamilyOAuthTokenDiagnosticWrapper(provider: ConcreteFetchHandler): ConcreteFetchHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const diag = await getFamilyTokenDiagnostic(request);
      if (!diag.isTokenEndpoint) return provider.fetch(request, env, ctx);

      try {
        const response = await provider.fetch(request, env, ctx);
        logFamilyTokenDiagnostic(diag, response.status);
        return response;
      } catch (error) {
        logFamilyTokenDiagnostic(diag, 599);
        throw error;
      }
    },
  };
}
