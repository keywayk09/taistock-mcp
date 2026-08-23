type ConcreteFetchHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

const LEGACY_FAMILY_OAUTH_ENDPOINTS = new Map<string, string>([
  ["/token", "/oauth/token"],
  ["/register", "/oauth/register"],
]);

/**
 * Compatibility bridge for ChatGPT installations that retained OAuth server
 * metadata from the original taistock-mcp DCR registration.
 *
 * The historical successful client predates the current `/oauth/*` route names.
 * Rewriting is intentionally narrow: only the legacy token and registration
 * paths are mapped into the existing OAuth provider. Authorization, scopes,
 * PKCE, token issuance, and the protected Family MCP surface remain owned by
 * the current provider and therefore retain the `family:read` boundary.
 */
export function createFamilyOAuthLegacyEndpointWrapper(provider: ConcreteFetchHandler): ConcreteFetchHandler {
  return {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const url = new URL(request.url);
      const canonicalPath = LEGACY_FAMILY_OAUTH_ENDPOINTS.get(url.pathname);
      if (!canonicalPath) return provider.fetch(request, env, ctx);

      const canonicalUrl = new URL(url.toString());
      canonicalUrl.pathname = canonicalPath;
      return provider.fetch(new Request(canonicalUrl.toString(), request), env, ctx);
    },
  };
}
