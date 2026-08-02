import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MyMCP as BaseMCP } from "./index-v6";
import { registerEtfTools } from "./v7/etf";
import { registerGlobalIndustryTools, syncTaiwanCompanyUniverse } from "./v7/global-map";
import { registerTwchipsTools } from "./v7/twchips";
import { registerTaiwanStockAnalysis12Tools } from "./v8/fundamental-12";

export class MyMCP extends BaseMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "8.1.0" });

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
    if (url.pathname === "/mcp") return MyMCP.serve("/mcp").fetch(request, env, ctx);
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "8.1.0",
        storage: env.DB ? "Cloudflare D1 connected" : "D1 binding pending",
        official_chip_sources: ["TWSE", "TAIFEX"],
        etf_sources: ["issuer official daily portfolio", "SITCA active ETF list", "D1 official snapshots", "FinMind optional fallback"],
        global_industry_map: {
          markets: ["TWSE", "TPEX", "ESB", "NASDAQ", "NYSE", "TSE Japan", "KRX"],
          model: ["companies", "themes", "memberships", "supply_chain_edges", "evidence", "review_candidates"],
          taiwan_universe_source: ["TWSE OpenAPI", "TPEx OpenAPI"],
          seed_regions: ["TW", "US", "JP", "KR", "NL"],
        },
        taiwan_stock_analysis: {
          template_version: "TW_STOCK_ANALYSIS_12_V1",
          sections: 12,
          policy: "只呈現可追溯自動資料與人工核實內容；缺漏不得以推測補齊",
        },
        etf_core_requires_finmind_sponsor: false,
        twchips_compatibility: "0.1.0 / f91bb03a3307665faccc1369bad628237c3a268c",
        mcp_endpoint: "/mcp",
        tools: 79,
      });
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await syncTaiwanCompanyUniverse(env);
  },
};
