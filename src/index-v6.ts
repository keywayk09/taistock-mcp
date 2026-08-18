import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "./index";
import { registerDailyReportFormatTool } from "./v6/daily-report-format";
import { registerAdvancedTools } from "./v6/register";
import { registerFamilyStockSelectionTools } from "./v6/family-stock-selection";
import {
  getMarketDataStatus,
  marketDataPhaseForCron,
  runMarketDataPipeline,
  type MarketDataPhase,
} from "./v6/market-data-pipeline";
import {
  getResearchStatus,
  getStoredCandles,
  isAuthorizedResearchRequest,
  runResearchPipeline,
} from "./v6/research-pipeline";
import { registerResearchTools } from "./v6/research-tools";

const MARKET_DATA_PHASES = new Set<MarketDataPhase>([
  "fundamentals",
  "institutional_prelim",
  "institutional_final",
  "margin",
  "finalize",
]);

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "6.15.1" });

  async init() {
    await super.init();
    registerAdvancedTools(this.server, this.env);
    registerDailyReportFormatTool(this.server);
    registerResearchTools(this.server, this.env);
    registerFamilyStockSelectionTools(this.server, this.env);
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
        version: "6.15.1",
        storage: {
          legacy_d1: env.DB ? "connected" : "pending",
          research_d1: env.RESEARCH_DB ? "connected" : "pending",
          research_r2: env.RESEARCH_BUCKET ? "connected" : "pending",
        },
        mcp_endpoint: "/mcp",
        research_status_endpoint: "/research/status",
        market_data_status_endpoint: "/market-data/status",
        tools: 106,
      });
    }

    if (url.pathname.startsWith("/market-data/")) {
      if (!isAuthorizedResearchRequest(request, env)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (url.pathname === "/market-data/status" && request.method === "GET") {
        const date = url.searchParams.get("date") ?? undefined;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return Response.json({ error: "invalid date" }, { status: 400 });
        }
        return Response.json(await getMarketDataStatus(env, date));
      }
      if (url.pathname === "/market-data/run" && request.method === "POST") {
        const requested = url.searchParams.get("phase") as MarketDataPhase | null;
        if (!requested || !MARKET_DATA_PHASES.has(requested)) {
          return Response.json({
            error: "invalid phase",
            allowed: [...MARKET_DATA_PHASES],
          }, { status: 400 });
        }
        return Response.json(await runMarketDataPipeline(env, requested));
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }

    if (url.pathname.startsWith("/research/")) {
      if (!isAuthorizedResearchRequest(request, env)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (url.pathname === "/research/status" && request.method === "GET") {
        return Response.json(await getResearchStatus(env));
      }
      if (url.pathname === "/research/run" && request.method === "POST") {
        const mode = url.searchParams.get("mode") === "repair" ? "repair" : "close";
        return Response.json(await runResearchPipeline(env, mode));
      }
      if (url.pathname.startsWith("/research/candles/") && request.method === "GET") {
        const symbol = url.pathname.split("/").at(-1) ?? "";
        const date = url.searchParams.get("date") ?? "";
        const timeframe = url.searchParams.get("timeframe") === "1m" ? "1m" : "5m";
        if (!/^\d{4,6}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return Response.json({ error: "invalid symbol or date" }, { status: 400 });
        }
        return Response.json(await getStoredCandles(env, date, symbol, timeframe));
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const marketPhase = marketDataPhaseForCron(controller.cron);
    if (marketPhase) {
      ctx.waitUntil(runMarketDataPipeline(env, marketPhase, new Date(controller.scheduledTime)));
      return;
    }

    const mode = controller.cron === "55 5 * * 1-5" ? "repair" : "close";
    ctx.waitUntil(runResearchPipeline(env, mode, new Date(controller.scheduledTime)));
  },
};
