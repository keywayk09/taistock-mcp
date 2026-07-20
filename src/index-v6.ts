import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "./index";
import { registerAdvancedTools } from "./v6/register";

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "6.0.0" });

  async init() {
    await super.init();
    registerAdvancedTools(this.server, this.env);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return MyMCP.serve("/mcp").fetch(request, env, ctx);
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "6.0.0",
        storage: env.DB ? "Cloudflare D1 connected" : "D1 binding pending",
        mcp_endpoint: "/mcp",
        tools: 40,
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
