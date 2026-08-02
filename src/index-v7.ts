import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "./index-v6";
import { registerEtfTools } from "./v7/etf";
import { registerGlobalIndustryTools, syncTaiwanCompanyUniverse } from "./v7/global-map";
import { registerTwchipsTools } from "./v7/twchips";
import { familyOpenApiSchema, runFamilyQuery } from "./v8/family-query";
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

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

function bearerAuthorized(request: Request, secret?: string) {
  const expected = secret?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice(7), expected);
}

function familyCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "8.2.0" });

  async init() {
    await super.init();
    registerTwchipsTools(this.server, this.env);
    registerEtfTools(this.server, this.env);
    registerGlobalIndustryTools(this.server, this.env);
    registerTaiwanStockAnalysis12Tools(this.server, this.env);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const runtimeEnv = env as Env & { MCP_API_KEY?: string; MOM_GPT_API_KEY?: string };

    if (url.pathname === "/mcp") {
      if (!bearerAuthorized(request, runtimeEnv.MCP_API_KEY)) {
        return jsonResponse(
          { error: "unauthorized" },
          401,
          { "www-authenticate": 'Bearer realm="taistock-mcp"' },
        );
      }
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    if (url.pathname === "/api/family/query") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: familyCorsHeaders() });
      if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...familyCorsHeaders() });
      if (!bearerAuthorized(request, runtimeEnv.MOM_GPT_API_KEY)) {
        return jsonResponse(
          { error: "unauthorized" },
          401,
          { "www-authenticate": 'Bearer realm="taistock-family"', ...familyCorsHeaders() },
        );
      }
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 32_000) return jsonResponse({ error: "payload_too_large" }, 413, familyCorsHeaders());
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400, familyCorsHeaders());
      }
      const input = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return jsonResponse({ error: "query_required" }, 400, familyCorsHeaders());
      if (query.length > 2_000) return jsonResponse({ error: "query_too_long" }, 400, familyCorsHeaders());
      try {
        const result = await runFamilyQuery(env, {
          query,
          mode: "auto",
          as_of_date: typeof input.as_of_date === "string" ? input.as_of_date : undefined,
        });
        return jsonResponse(result, 200, familyCorsHeaders());
      } catch (error) {
        return jsonResponse({ error: "family_query_failed", message: error instanceof Error ? error.message : String(error) }, 500, familyCorsHeaders());
      }
    }

    if (url.pathname === "/family-openapi.json") {
      return jsonResponse(familyOpenApiSchema(url.origin));
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "8.2.0",
        family_read_only_api: "/api/family/query",
      });
    }

    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await syncTaiwanCompanyUniverse(env);
  },
};
