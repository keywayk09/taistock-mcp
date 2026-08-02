import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "./index-v6";
import { registerEtfTools } from "./v7/etf";
import { registerGlobalIndustryTools, syncTaiwanCompanyUniverse } from "./v7/global-map";
import { registerTwchipsTools } from "./v7/twchips";
import { registerTaiwanStockAnalysis12Tools } from "./v8/fundamental-12";

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function authorized(request: Request, env: Env) {
  const runtimeEnv = env as Env & { MCP_API_KEY?: string };
  const secret = runtimeEnv.MCP_API_KEY?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "8.1.1" });

  async init() {
    await super.init();
    registerTwchipsTools(this.server, this.env);
    registerEtfTools(this.server, this.env);
    registerGlobalIndustryTools(this.server, this.env);
    registerTaiwanStockAnalysis12Tools(this.server, this.env);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      if (!authorized(request, env)) {
        return jsonResponse(
          { error: "unauthorized" },
          401,
          { "www-authenticate": 'Bearer realm="taistock-mcp"' },
        );
      }
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "8.1.1",
      });
    }

    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await syncTaiwanCompanyUniverse(env);
  },
};
