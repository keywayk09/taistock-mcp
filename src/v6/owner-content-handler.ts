import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "../index";
import { registerDailyReportFormatTool } from "./daily-report-format";
import { tryHandleDiamondFixedFacadeCompatCall } from "./diamond-fixed-facade-compat";
import { registerFirstPartyIntelligenceSourceResource } from "./first-party-intelligence-sources";
import { registerToolThroughJin10Facade } from "./jin10-facade-middleware.ts";
import { LEGACY_OWNER_CHIP_OVERRIDE_TOOL_NAMES, registerLegacyOwnerChipTools } from "./legacy-owner-chip-tools";
import { registerResearchTools } from "./research-tools";
import { registerAdvancedTools } from "./register";
import { registerSharedCryptoMarketTools } from "./shared-crypto-market-tools";
import { registerSharedStockMarketContextTools } from "./shared-stock-market-context-tools";
import { registerStableMarketTools } from "./stable-market-tools";
import { registerStableSwingScreenTool } from "./stable-swing-screen";
import { registerTwMarketDataTools } from "./tw-market-data-tools";

const FROZEN_STABLE_MARKET_TOOL_NAMES = new Set([
  "get_quote",
  "get_daily_price",
  "get_market_rankings",
  "get_market_regime",
  "get_macro_risk_dashboard",
  "get_data_health",
  "screen_family_swing_candidates",
  ...LEGACY_OWNER_CHIP_OVERRIDE_TOOL_NAMES,
]);

export type McpContentHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

/**
 * Owner / Diamond content runtime.
 *
 * This module owns tool registration and the MyMCP runtime only. It must not
 * know OAuth clients, ChatGPT callback rules, PKCE, DCR, scopes, token storage,
 * or login compatibility. The access broker authenticates and authorizes first,
 * then delegates the already-protected MCP request here.
 */
export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock + Crypto AI", version: "6.20.0" });

  async init() {
    // Legacy generations still contain implementations that depend on provider
    // routes already proven unreliable from Cloudflare egress, old price
    // identities that are no longer canonical, or pre-migration chip providers.
    // Suppress only the frozen names during legacy registration, then register
    // their stable versions exactly once below. Every unrelated Diamond tool
    // remains unchanged.
    //
    // Jin10 follows the opposite rule: it is not surfaced as additional MCP
    // actions. Selected existing facade handlers are wrapped during registration
    // so their public names and input schemas remain frozen while Jin10 is used
    // only as an internal read-only evidence provider.
    const serverAny = this.server as any;
    const originalRegisterTool = serverAny.registerTool;
    const env = this.env;
    serverAny.registerTool = function (name: string, ...args: any[]) {
      if (FROZEN_STABLE_MARKET_TOOL_NAMES.has(name)) return undefined;
      return registerToolThroughJin10Facade(originalRegisterTool, this, env, name, args);
    };

    try {
      await super.init();
      registerAdvancedTools(this.server, this.env);
      registerDailyReportFormatTool(this.server);
      registerResearchTools(this.server, this.env);

      const { registerFamilyStockSelectionToolsV2 } = await import("./family-stock-selection-v2");
      registerFamilyStockSelectionToolsV2(this.server, this.env);
      registerTwMarketDataTools(this.server, this.env);
    } finally {
      serverAny.registerTool = originalRegisterTool;
    }

    registerStableMarketTools(this.server, this.env);
    registerLegacyOwnerChipTools(this.server, this.env);
    registerStableSwingScreenTool(this.server, this.env);
    registerSharedStockMarketContextTools(this.server, this.env);
    registerSharedCryptoMarketTools(this.server, this.env);
    registerFirstPartyIntelligenceSourceResource(this.server);

    // Deliberately do not register standalone Jin10 or legacy compatibility
    // aliases into tools/list. ChatGPT's historical 79-tool App schema is served
    // by the authenticated tools/call interceptor below, while modern tools/list
    // remains the current Owner runtime inventory. Static routing metadata such as
    // the first-party intelligence allowlist is exposed as an MCP resource instead
    // of consuming a model-invokable action slot.
  }
}

export const ownerContentHandler: McpContentHandler = {
  async fetch(request, env, ctx) {
    const compat = await tryHandleDiamondFixedFacadeCompatCall(request, env);
    if (compat) return compat;
    const pathname = new URL(request.url).pathname;
    return MyMCP.serve(pathname).fetch(request, env, ctx);
  },
};