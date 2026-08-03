import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { MyMCP as BaseMCP } from "./index-v6";
import { registerEtfTools } from "./v7/etf";
import { registerGlobalIndustryTools, syncTaiwanCompanyUniverse } from "./v7/global-map";
import { registerTwchipsTools } from "./v7/twchips";
import { familyOpenApiSchema, runFamilyQuery } from "./v8/family-query";
import { registerTaiwanStockAnalysis12Tools } from "./v8/fundamental-12";

type OAuthGrantProps = {
  role?: "owner" | "family";
  permissions?: string[];
};

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
  server = new McpServer({ name: "Taiwan Stock AI", version: "8.4.0" });

  async init() {
    const role = (this.props as OAuthGrantProps | undefined)?.role;
    if (role && role !== "owner") {
      this.server.registerTool("accessDenied", {
        description: "此 OAuth 帳號沒有完整台股 MCP 權限。",
        inputSchema: {},
      }, async () => ({
        isError: true,
        content: [{ type: "text" as const, text: "權限不足：此入口僅限擁有者。" }],
      }));
      return;
    }
    await super.init();
    registerTwchipsTools(this.server, this.env);
    registerEtfTools(this.server, this.env);
    registerGlobalIndustryTools(this.server, this.env);
    registerTaiwanStockAnalysis12Tools(this.server, this.env);
  }
}

export class FamilyMCP extends McpAgent<Env> {
  server = new McpServer({ name: "Taiwan Stock AI Family Read-Only", version: "8.4.0" });

  async init() {
    const role = (this.props as OAuthGrantProps | undefined)?.role;
    if (role && role !== "family" && role !== "owner") {
      this.server.registerTool("accessDenied", {
        description: "此 OAuth 帳號沒有家人版台股 MCP 權限。",
        inputSchema: {},
      }, async () => ({
        isError: true,
        content: [{ type: "text" as const, text: "權限不足。" }],
      }));
      return;
    }

    this.server.registerTool("queryTaiwanStockSystem", {
      description: "媽媽／家人專用的單一台股智慧查詢工具。可查個股完整分析、股票比較、基本面、財務、籌碼、題材、同業與全球供應鏈；只讀取資料，不能新增、修改、刪除、匯入或核准任何內容。",
      inputSchema: {
        query: z.string().trim().min(1).max(2_000).describe("使用者的完整原始問題；保留股票代號、公司名稱、比較條件與分析需求。"),
        as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("選填資料截止日，格式 YYYY-MM-DD；未填則使用台北當日。"),
      },
    }, async ({ query, as_of_date }) => {
      try {
        const result = await runFamilyQuery(this.env, {
          query,
          mode: "auto",
          as_of_date,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    });
  }
}

const familyMcpHandler = FamilyMCP.serve("/family-mcp", { binding: "FAMILY_MCP_OBJECT" });

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

    if (url.pathname === "/family-mcp") {
      if (!bearerAuthorized(request, runtimeEnv.MOM_GPT_API_KEY)) {
        return jsonResponse(
          { error: "unauthorized" },
          401,
          { "www-authenticate": 'Bearer realm="taistock-family-mcp"' },
        );
      }
      return familyMcpHandler.fetch(request, env, ctx);
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
        version: "8.4.0",
        data_policy: "official-first: TWSE/TPEx/MOPS/TDCC; FinMind optional fallback",
        bearer_mcp: "/mcp",
        owner_oauth_mcp: "/my-mcp",
        family_read_only_api: "/api/family/query",
        family_oauth_mcp: "/family-mcp",
        oauth_authorize: "/authorize",
      });
    }

    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await syncTaiwanCompanyUniverse(env);
  },
};
