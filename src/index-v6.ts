import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { MyMCP as BaseMCP } from "./index";
import { registerDailyReportFormatTool } from "./v6/daily-report-format";
import { registerAdvancedTools } from "./v6/register";
import { registerFamilyStockSelectionTools } from "./v6/family-stock-selection";
import {
  getResearchStatus,
  isAuthorizedResearchRequest,
} from "./v6/research-pipeline";
import { registerResearchTools } from "./v6/research-tools";
import { runTwMarketDataDaily } from "./v6/tw-market-data-d1";
import { registerTwMarketDataTools } from "./v6/tw-market-data-tools";

function taipeiDateFromMs(ms: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

const MARKET_DATA_CRONS = new Set(["30 10 * * 1-5", "30 12 * * 1-5"]);

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "6.16.1" });

  async init() {
    await super.init();
    registerAdvancedTools(this.server, this.env);
    registerDailyReportFormatTool(this.server);
    registerResearchTools(this.server, this.env);
    registerFamilyStockSelectionTools(this.server, this.env);
    registerTwMarketDataTools(this.server, this.env);
  }
}

/**
 * Compatibility class for the already-provisioned FamilyMCP Durable Object namespace.
 *
 * The historical family runtime has been retired from the active production router,
 * but its Durable Object namespace must remain live so Cloudflare declarative exports
 * do not retire or delete existing namespace data. This class intentionally exposes
 * only a read-only compatibility status tool and performs no storage mutation.
 */
export class FamilyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "Taiwan Stock AI Family Namespace Compatibility",
    version: "6.16.1",
  });

  async init() {
    this.server.registerTool("familyNamespaceStatus", {
      description: "唯讀確認舊 FamilyMCP Durable Object namespace 仍被保留；不寫入、不刪除、不重設任何資料。",
      inputSchema: {},
    }, async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "PRESERVED_READ_ONLY",
          namespace: "FamilyMCP",
          storage: "sqlite",
          active_family_runtime: "MyMCP family tools",
          destructive_actions: false,
        }, null, 2),
      }],
    }));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return MyMCP.serve("/mcp").fetch(request, env, ctx);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "6.16.1",
        storage: {
          legacy_d1: env.DB ? "connected" : "pending",
          research_d1: env.RESEARCH_DB ? "connected" : "pending",
          policy: "D1_ONLY_NO_R2",
        },
        durable_objects: {
          primary: "MyMCP",
          legacy_family_namespace: "PRESERVED_READ_ONLY",
        },
        market_data: {
          version: "diamond-tw-market-data/v1.1.0-d1",
          storage: "D1_ONLY",
          policy: "official_first_layer_degradation",
          ohlc_gateway: "OHLC_MCP_ONLY",
          scheduled_capture_taipei: ["18:30", "20:30 retry/finalize"],
        },
        mcp_endpoint: "/mcp",
        research_status_endpoint: "/research/status",
        tools: 111,
      });
    }

    if (url.pathname.startsWith("/research/")) {
      if (!isAuthorizedResearchRequest(request, env)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (url.pathname === "/research/status" && request.method === "GET") {
        return Response.json(await getResearchStatus(env));
      }
      if ((url.pathname === "/research/run" && request.method === "POST") || url.pathname.startsWith("/research/candles/")) {
        return Response.json({
          error: "legacy_research_ohlc_path_disabled",
          policy: "OHLC_MCP_ONLY",
          storage_policy: "D1_ONLY_NO_R2",
          message: "舊 Fugle/R2 research candle path 已停用；正式 OHLC 請走 OHLC MCP。",
        }, { status: 410 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!MARKET_DATA_CRONS.has(controller.cron)) return;
    const tradeDate = taipeiDateFromMs(controller.scheduledTime);
    ctx.waitUntil(runTwMarketDataDaily(env, tradeDate));
  },
};
