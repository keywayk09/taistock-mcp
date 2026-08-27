import { familyContentHandler } from "./family-content-handler";
import { createMcpAccessBroker, type McpRelayHandler } from "./mcp-access-broker";
import { ownerContentHandler } from "./owner-content-handler";

export { FamilyMCP } from "./family-mcp";
export { MyMCP } from "./owner-content-handler";

/**
 * MCP runtime composition root.
 *
 * This is the only module allowed to know both the access broker and concrete
 * Owner/Family content handlers. The public Worker entrypoint injects only the
 * non-MCP public application handler and receives one already-composed runtime.
 *
 * Keep protocol/auth compatibility in mcp-access-broker.ts and business/tool
 * implementations in the content handlers. Public endpoint ABI is unchanged.
 */
export function createComposedMcpRuntime(publicAppHandler: McpRelayHandler): McpRelayHandler {
  return createMcpAccessBroker(
    publicAppHandler,
    ownerContentHandler,
    familyContentHandler,
  );
}
