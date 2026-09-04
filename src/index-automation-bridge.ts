import app from "./index-v6.ts";
import { handleAutomationMarketExportRoute } from "./v6/automation-market-export-route.ts";
import { handleAutomationOhlc1dRoute } from "./v6/automation-ohlc-1d-route.ts";
import { handleAutomationResearchRest } from "./v6/automation-research-rest.ts";

// Preserve the exact Durable Object exports and public fetch paths used by the
// current Production Worker. Owner `/my-mcp`, legacy `/mcp`, and Family
// `/family-mcp` remain ABI-stable. This wrapper is also the final safety fence
// for the retired non-OHLC market-data scheduler: current chip data is now
// fetched on demand and must never restart bulk capture because of a stale cron.
export { FamilyMCP, MyMCP } from "./index-v6.ts";

async function withOnDemandHealthMetadata(response: Response) {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return response;

  try {
    const body = await response.clone().json() as Record<string, any>;
    const marketData = body.market_data && typeof body.market_data === "object"
      ? body.market_data as Record<string, any>
      : {};
    body.market_data = {
      ...marketData,
      current_chip_read_mode: "OFFICIAL_EXACT_DATE_ON_DEMAND",
      current_chip_persistence: "NONE",
      legacy_chip_archive: "READ_ONLY_HISTORY_CONTEXT",
      scheduled_chip_capture: "DISABLED",
      capture_owner: "NONE_ON_DEMAND_ONLY",
      execution_policy: "NO_AUTOMATIC_NON_OHLC_MARKET_DATA_CRON",
      ohlc_gateway: marketData.ohlc_gateway || "OHLC_MCP_CANONICAL_GITHUB_READ_ONLY",
      ohlc_policy: "UNCHANGED_CANONICAL_PIPELINE",
    };
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(JSON.stringify(body), { status: response.status, headers });
  } catch {
    return response;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // URLSearchParams.get() returns null when an optional parameter is omitted.
    // The legacy clamp helper inside the compatibility handler treats
    // Number(null) as zero, so normalize the documented formal-Blind default at
    // the ingress boundary instead of silently truncating a 300-bar request to
    // one bar. Explicit caller-provided limits remain untouched.
    if (url.pathname === "/research/automation/formal-blind" && !url.searchParams.has("limit")) {
      url.searchParams.set("limit", "300");
    }

    if (url.pathname === "/research/automation/market-export") {
      const response = await handleAutomationMarketExportRoute(request, env, url);
      if (response) return response;
    }
    if (url.pathname === "/research/automation/ohlc-1d") {
      const response = await handleAutomationOhlc1dRoute(request, env, url);
      if (response) return response;
    }
    if (url.pathname.startsWith("/research/automation")) {
      const response = await handleAutomationResearchRest(request, env, url);
      if (response) return response;
    }

    const response = await app.fetch(request, env, ctx);
    if ((url.pathname === "/" || url.pathname === "/health") && request.method === "GET") {
      return withOnDemandHealthMetadata(response);
    }
    return response;
  },

  // Defensive no-op in addition to removing `triggers.crons` from wrangler.
  // OHLC is owned by tv-fugle-1d and is not scheduled through this Worker, so
  // retiring this handler cannot stop the canonical OHLC pipeline.
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    return {
      ok: true,
      status: "RETIRED_NOOP",
      reason: "NON_OHLC_CHIP_DATA_MOVED_TO_ON_DEMAND",
      persistence: "NONE",
      ohlc: "UNAFFECTED",
    };
  },
};
