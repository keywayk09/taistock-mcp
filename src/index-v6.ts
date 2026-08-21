import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { MyMCP as BaseMCP } from "./index";
import { registerDailyReportFormatTool } from "./v6/daily-report-format";
import { handleFamilyActionCompat } from "./v6/family-action-compat";
import { registerAdvancedTools } from "./v6/register";
import { registerFamilyStockSelectionTools } from "./v6/family-stock-selection";
import { githubDataStoreHealth } from "./v6/github-data-store";
import { runExtendedScheduledMarketDataController } from "./v6/market-data-scheduled-dispatch";
import { getTwMarketDataDayStatus } from "./v6/market-data-day-status";
import { getResearchStatus, isAuthorizedResearchRequest } from "./v6/research-pipeline";
import { registerResearchTools } from "./v6/research-tools";
import { TW_MARKET_DATA_VERSION } from "./v6/tw-market-data-github";
import { registerTwMarketDataTools } from "./v6/tw-market-data-tools";

function taipeiDateFromMs(ms: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "6.17.0" });

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
 * The namespace remains live/read-only so declarative exports never retire existing data.
 */
export class FamilyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "Taiwan Stock AI Family Namespace Compatibility",
    version: "6.17.0",
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

    const familyCompat = await handleFamilyActionCompat(request, env, url);
    if (familyCompat) return familyCompat;

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "6.17.0",
        storage: {
          policy: "GITHUB_ONLY_NO_D1_NO_R2",
          github: githubDataStoreHealth(env),
          canonical_repository: env.GITHUB_DATA_REPO || "keywayk09/tv-papertrader",
          canonical_branch: env.GITHUB_DATA_BRANCH || "main",
          canonical_root: "data/",
        },
        durable_objects: {
          primary: "MyMCP",
          legacy_family_namespace: "PRESERVED_READ_ONLY",
          note: "Durable Object lifecycle namespaces are not application data persistence.",
        },
        market_data: {
          version: TW_MARKET_DATA_VERSION,
          storage: "GITHUB_ONLY",
          canonical_repository: env.GITHUB_DATA_REPO || "keywayk09/tv-papertrader",
          canonical_branch: env.GITHUB_DATA_BRANCH || "main",
          canonical_root: "data/market-data/",
          calendar_root: "data/market-calendar/",
          policy: "incremental_ready_monotonic_missing_only_retry",
          ohlc_gateway: "OHLC_MCP_ONLY",
          capture_owner: "CLOUDFLARE_CRON_CANONICAL_WRITER",
          execution_policy: "FIVE_MINUTE_WAKE; DUE_LAYER_ONLY; NO_PRIVATE_GITHUB_ACTIONS_DEPENDENCY; NO_2230_HARD_STOP",
          expected_layers: 8,
          kinds: ["institutional", "margin", "securities_lending", "sbl_short_sale"],
          source_lanes: {
            listed: "TWSE_OFFICIAL_DIRECT_TO_CANONICAL_GITHUB",
            otc: "TPEX_OFFICIAL_DIRECT_TO_CANONICAL_GITHUB",
          },
          retry_policy: "PENDING_OR_ERROR_ONLY; READY_NEVER_DOWNGRADES",
          trading_day_policy: "OFFICIAL_CALENDAR_PLUS_WEEKEND_GATE; NO_DATA_NEVER_IMPLIES_HOLIDAY",
          status_endpoint: "/market-data/status?trade_date=YYYY-MM-DD",
        },
        mcp_endpoint: "/mcp",
        family_read_only_action: "/api/family/query",
        family_openapi: "/family-openapi.json",
        privacy_policy: "/privacy",
        research_status_endpoint: "/research/status",
        tools: 113,
      });
    }

    if (url.pathname === "/market-data/status" && request.method === "GET") {
      const tradeDate = url.searchParams.get("trade_date")?.trim() || taipeiDateFromMs(Date.now());
      return Response.json(await getTwMarketDataDayStatus(env, tradeDate));
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
          storage_policy: "GITHUB_ONLY_NO_D1_NO_R2",
          message: "舊 research candle path 已退休；正式 OHLC 請走 OHLC MCP。",
        }, { status: 410 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runExtendedScheduledMarketDataController(env, controller.scheduledTime));
  },
};
