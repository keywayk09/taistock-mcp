import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "./index-v6";
import { registerEtfTools } from "./v7/etf";
import { registerTwchipsTools } from "./v7/twchips";

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "7.1.0" });

  async init() {
    await super.init();
    registerTwchipsTools(this.server, this.env);
    registerEtfTools(this.server, this.env);
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
        version: "7.1.0",
        storage: env.DB ? "Cloudflare D1 connected" : "D1 binding pending",
        official_chip_sources: ["TWSE", "TAIFEX"],
        etf_sources: ["issuer official daily portfolio", "SITCA active ETF list", "D1 official snapshots", "FinMind optional fallback"],
        etf_core_requires_finmind_sponsor: false,
        twchips_compatibility: "0.1.0 / f91bb03a3307665faccc1369bad628237c3a268c",
        mcp_endpoint: "/mcp",
        tools: 58,
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
