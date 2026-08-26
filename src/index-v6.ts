import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "./index";
import { registerDailyReportFormatTool } from "./v6/daily-report-format";
import { handleFamilyActionCompat } from "./v6/family-action-compat";
import { createFamilyOAuthProvider } from "./v6/family-oauth";
import { createFamilyOAuthLegacyEndpointWrapper } from "./v6/family-oauth-legacy-endpoints";
import { createFamilyOAuthPublicClientCompatWrapper } from "./v6/family-oauth-public-client-compat";
import { createFamilyOAuthTokenRecoveryWrapper } from "./v6/family-oauth-token-recovery";
import { FAMILY_MCP_TOOL_NAMES } from "./v6/family-mcp";
import { githubDataStoreHealth } from "./v6/github-data-store";
import { runExtendedScheduledMarketDataController } from "./v6/market-data-scheduled-dispatch";
import { getTwMarketDataDayStatus } from "./v6/market-data-day-status";
import { getResearchStatus, isAuthorizedResearchRequest } from "./v6/research-pipeline";
import { registerResearchTools } from "./v6/research-tools";
import { registerAdvancedTools } from "./v6/register";
import { registerSharedStockMarketContextTools } from "./v6/shared-stock-market-context-tools";
import { registerStableMarketTools } from "./v6/stable-market-tools";
import { registerStableSwingScreenTool } from "./v6/stable-swing-screen";
import { TW_MARKET_DATA_VERSION } from "./v6/tw-market-data-github";
import { registerTwMarketDataTools } from "./v6/tw-market-data-tools";

export { FamilyMCP } from "./v6/family-mcp";

const FAMILY_SMART_REST_PATHS = new Set([
  "/family-openapi.json",
  "/api/family/query",
  "/api/family/analyze",
  "/api/family/compare",
  "/api/family/screen",
  "/api/family/status",
]);

const FROZEN_STABLE_MARKET_TOOL_NAMES = new Set([
  "get_quote",
  "get_daily_price",
  "get_market_rankings",
  "get_market_regime",
  "get_macro_risk_dashboard",
  "get_data_health",
  "screen_family_swing_candidates",
]);

function taipeiDateFromMs(ms: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "6.18.1" });

  async init() {
    // Legacy generations still contain implementations that depend on provider
    // routes already proven unreliable from Cloudflare egress, or old price
    // identities that are no longer canonical. Suppress only the frozen names
    // during legacy registration, then register their stable versions exactly once
    // below. Every unrelated Diamond tool remains unchanged.
    const serverAny = this.server as any;
    const originalRegisterTool = serverAny.registerTool;
    serverAny.registerTool = function (name: string, ...args: any[]) {
      if (FROZEN_STABLE_MARKET_TOOL_NAMES.has(name)) return undefined;
      return originalRegisterTool.call(this, name, ...args);
    };

    try {
      await super.init();
      registerAdvancedTools(this.server, this.env);
      registerDailyReportFormatTool(this.server);
      registerResearchTools(this.server, this.env);

      // Keep the legacy module available for its non-frozen internals, but its
      // screen_family_swing_candidates registration is suppressed above.
      const { registerFamilyStockSelectionToolsV2 } = await import("./v6/family-stock-selection-v2");
      registerFamilyStockSelectionToolsV2(this.server, this.env);
      registerTwMarketDataTools(this.server, this.env);
    } finally {
      serverAny.registerTool = originalRegisterTool;
    }

    registerStableMarketTools(this.server, this.env);
    registerStableSwingScreenTool(this.server, this.env);
    registerSharedStockMarketContextTools(this.server, this.env);
  }
}

const appHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Owner / Diamond full MCP is canonical on /my-mcp. Keep /mcp as a legacy alias.
    // These routes must never be remapped to the Family OAuth-protected surface.
    if (url.pathname === "/my-mcp" || url.pathname === "/mcp") {
      return MyMCP.serve(url.pathname).fetch(request, env, ctx);
    }

    // Family V3 smart REST is intentionally lazy-loaded only for Family routes.
    // The route contract remains identical; only Worker startup evaluation changes.
    if (FAMILY_SMART_REST_PATHS.has(url.pathname)) {
      const { handleFamilySmartRest } = await import("./v6/family-smart-rest");
      const familySmart = await handleFamilySmartRest(request, env, url);
      if (familySmart) return familySmart;
    }

    const familyCompat = await handleFamilyActionCompat(request, env, url);
    if (familyCompat) return familyCompat;

    if (url.pathname === "/" || url.pathname === "/health") {
      const familyLoginConfigured = Boolean(String(env.FAMILY_OAUTH_LOGIN_SECRET || env.MOM_GPT_API_KEY || "").trim());
      return Response.json({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "6.18.1",
        storage: {
          policy: "GITHUB_ONLY_NO_D1_NO_R2",
          github: githubDataStoreHealth(env),
          canonical_repository: env.GITHUB_DATA_REPO || "keywayk09/tv-papertrader",
          canonical_branch: env.GITHUB_DATA_BRANCH || "main",
          canonical_root: "data/",
        },
        durable_objects: {
          primary: "MyMCP",
          family: "FamilyMCP_READ_ONLY_ISOLATED",
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
          ohlc_gateway: "OHLC_MCP_CANONICAL_GITHUB_READ_ONLY",
          cross_account_read: "FUGLE_REST_PLUS_GITHUB_CANONICAL_NO_SERVICE_BINDING",
          stock_live_context: "EPHEMERAL_FUGLE_REST_QUOTE_TRADES_FIVE_LEVEL_BOOK_RECENT_TAPE",
          stock_trade_tape: "RECENT_3_MINUTES_MAX_300_NORMALIZED_PRINTS_NOT_PERSISTED",
          stock_live_persistence: "NONE",
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
          full_market_status_endpoint: "/health/full-market",
          full_market_scan_contract: "tw-full-market-source-contract/v1.0.0",
          full_market_scan_policy: "FROZEN_TWSE_OPENAPI_PLUS_MOPSFIN_TWSE_MIS; NO_FUGLE_RANKING; NO_FINMIND_REQUIRED; NO_DIRECT_TPEX_QUOTES",
          swing_screen_policy: "FROZEN_FULL_MARKET_PREFILTER_PLUS_FUGLE_PER_SYMBOL_HISTORY; NO_FINMIND_REQUIRED",
        },
        mcp_endpoint: "/my-mcp",
        legacy_mcp_endpoint: "/mcp",
        family_mcp: {
          endpoint: "/family-mcp",
          oauth_required: true,
          oauth_kv_bound: Boolean(env.OAUTH_KV),
          login_secret_configured: familyLoginConfigured,
          access: "READ_ONLY_ALLOWLIST",
          tools: FAMILY_MCP_TOOL_NAMES,
          intelligence: "V3_ADAPTIVE_SHARED_READ_OPEN_WORLD",
          permission_model: "SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS",
          owner_market_research_reads: "SHARED_BY_DEFAULT_WHEN_AVAILABLE",
          owner_private_context: "DENY_BY_DEFAULT_UNLESS_EXPLICITLY_SHARED",
          realtime: "FUGLE_REST_READ_ONLY_WITH_FIVE_LEVEL_BOOK_AND_RECENT_TRADES",
          web_research: "OPEN_WORLD_AUTONOMOUS_ALLOWED",
          swing_screen: "STABLE_FULL_MARKET_CONTRACT_BOUNDED_FUGLE_HISTORY",
          startup_graph: "LAZY_DEEP_FAMILY_MODULES",
        },
        family_read_only_action: "/api/family/query",
        family_read_only_actions: {
          adaptive_query: "/api/family/query",
          analyze_11_point: "/api/family/analyze",
          compare_11_point: "/api/family/compare",
          swing_screen_v2: "/api/family/screen",
          status: "/api/family/status",
        },
        family_openapi: "/family-openapi.json",
        privacy_policy: "/privacy",
        research_status_endpoint: "/research/status",
        tools: 115,
      });
    }

    if (url.pathname === "/health/full-market" && request.method === "GET") {
      const { loadStableMarketUniverse, STABLE_MARKET_SOURCE_CONTRACT, STABLE_MARKET_TOOLS_VERSION } = await import("./v6/stable-market-tools");
      const result = await loadStableMarketUniverse(true);
      return Response.json({
        status: result.usable ? "ok" : "degraded",
        usable: result.usable,
        version: STABLE_MARKET_TOOLS_VERSION,
        source_contract: STABLE_MARKET_SOURCE_CONTRACT,
        retrieved_at: result.retrieved_at,
        listed: {
          provider: result.TWSE.provider,
          rows: result.TWSE.normalized_count,
          errors: result.TWSE.errors,
        },
        otc: {
          provider: result.TPEx.provider,
          rows: result.TPEx.normalized_count,
          errors: result.TPEx.errors,
        },
        optional_metadata_errors: result.optional_metadata_errors,
      }, { status: result.usable ? 200 : 503 });
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
          message: "舊 research candle path 已退休；正式 OHLC 請走 OHLC canonical GitHub read。",
        }, { status: 410 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },
};

const familyOAuthProvider = createFamilyOAuthLegacyEndpointWrapper(
  createFamilyOAuthPublicClientCompatWrapper(
    createFamilyOAuthTokenRecoveryWrapper(createFamilyOAuthProvider(appHandler)),
  ),
);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return familyOAuthProvider.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runExtendedScheduledMarketDataController(env, controller.scheduledTime));
  },
};