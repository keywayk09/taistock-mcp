import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "../index";
import { registerDailyReportFormatTool } from "./daily-report-format";
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
  server = new McpServer({ name: "Taiwan Stock + Crypto AI", version: "6.19.0" });

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
      const { registerFamilyStockSelectionToolsV2 } = await import("./family-stock-selection-v2");
      registerFamilyStockSelectionToolsV2(this.server, this.env);
      registerTwMarketDataTools(this.server, this.env);
    } finally {
      serverAny.registerTool = originalRegisterTool;
    }

    registerStableMarketTools(this.server, this.env);
    registerStableSwingScreenTool(this.server, this.env);
    registerSharedStockMarketContextTools(this.server, this.env);
    registerSharedCryptoMarketTools(this.server, this.env);
  }
}

export const ownerContentHandler: McpContentHandler = {
  fetch(request, env, ctx) {
    // Preserve the already-authorized public path so McpAgent keeps the exact
    // existing transport/session identity for both canonical and legacy Owner ABI.
    const pathname = new URL(request.url).pathname;
    return MyMCP.serve(pathname).fetch(request, env, ctx);
  },
};
