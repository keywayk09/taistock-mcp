import { FamilyMCP } from "./family-mcp";

declare global {
  interface Env {
    FAMILY_MCP_OBJECT: DurableObjectNamespace<FamilyMCP>;
  }
}

export type McpContentHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

/**
 * Family content adapter.
 *
 * This layer owns only the Family MCP runtime handoff. It intentionally knows
 * nothing about OAuth, ChatGPT callbacks, scopes, PKCE, DCR, or token storage.
 * The access broker authenticates/authorizes the request before invoking it.
 */
export const familyContentHandler: McpContentHandler = {
  async fetch(request, env, ctx) {
    try {
      return await FamilyMCP.serve("/family-mcp", { binding: "FAMILY_MCP_OBJECT" }).fetch(request, env, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("FAMILY_MCP_OBJECT") && message.includes("binding")) {
        return Response.json({
          error: "family_mcp_binding_missing",
          message: "FAMILY_MCP_OBJECT is required; refusing to fall back to the full MCP_OBJECT namespace.",
        }, { status: 503 });
      }
      throw error;
    }
  },
};
