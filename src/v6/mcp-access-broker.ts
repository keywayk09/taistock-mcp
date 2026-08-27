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
 * sees one broker, while authorized requests are forwarded to injected content
 * handlers. Tool implementations and market-data logic must not live here.
 */
export function createMcpAccessBroker(
  appHandler: McpRelayHandler,
  familyContentHandler: McpRelayHandler,
): McpRelayHandler {
  return createFamilyOAuthLegacyEndpointWrapper(
    createFamilyOAuthPublicClientCompatWrapper(
      createFamilyOAuthTokenRecoveryWrapper(
        createFamilyOAuthProvider(appHandler, familyContentHandler),
      ),
    ),
  );
}
