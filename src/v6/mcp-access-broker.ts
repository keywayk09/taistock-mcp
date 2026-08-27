import { createFamilyOAuthProvider } from "./family-oauth";
import { createFamilyOAuthLegacyEndpointWrapper } from "./family-oauth-legacy-endpoints";
import { createFamilyOAuthPublicClientCompatWrapper } from "./family-oauth-public-client-compat";
import { createFamilyOAuthTokenRecoveryWrapper } from "./family-oauth-token-recovery";

export type McpRelayHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

/**
 * MCP Access Broker / Relay.
 *
 * Public OAuth / ChatGPT compatibility is composed here. The composition root
 * injects separate public, Owner-content, and Family-content handlers. Tool
 * implementations and market-data logic must not live here.
 */
export function createMcpAccessBroker(
  publicAppHandler: McpRelayHandler,
  ownerContentHandler: McpRelayHandler,
  familyContentHandler: McpRelayHandler,
): McpRelayHandler {
  // family-oauth intentionally sees one application handler for its Owner API
  // handoff and default non-MCP fallback. The relay, not OAuth, decides whether
  // an already-authorized Owner request enters Diamond content. Because the
  // OAuthProvider wraps this handler, direct unauthenticated requests cannot
  // bypass the provider's role/scope checks.
  const appHandler: McpRelayHandler = {
    fetch(request, env, ctx) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/my-mcp" || pathname === "/mcp") {
        return ownerContentHandler.fetch(request, env, ctx);
      }
      return publicAppHandler.fetch(request, env, ctx);
    },
  };

  return createFamilyOAuthLegacyEndpointWrapper(
    createFamilyOAuthPublicClientCompatWrapper(
      createFamilyOAuthTokenRecoveryWrapper(
        createFamilyOAuthProvider(appHandler, familyContentHandler),
      ),
    ),
  );
}
