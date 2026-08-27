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
 * Public protocol compatibility lives here. The broker composes OAuth and
 * retained ChatGPT compatibility adapters, then forwards an authorized request
 * to injected content handlers. It must never import Diamond/Family tool
 * implementations directly.
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
