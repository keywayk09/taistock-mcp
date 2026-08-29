import app from "./index-v6.ts";
import { handleAutomationOhlc1dRoute } from "./v6/automation-ohlc-1d-route.ts";
import { handleAutomationResearchRest } from "./v6/automation-research-rest.ts";

// Preserve the exact Durable Object exports used by the current Production
// Worker. This wrapper only intercepts /research/automation/* read-only HTTP
// requests; every existing fetch path and the scheduled controller delegate
// unchanged to the canonical V6 entrypoint.
export { FamilyMCP, MyMCP } from "./index-v6.ts";

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

    if (url.pathname === "/research/automation/ohlc-1d") {
      const response = await handleAutomationOhlc1dRoute(request, env, url);
      if (response) return response;
    }
    if (url.pathname.startsWith("/research/automation")) {
      const response = await handleAutomationResearchRest(request, env, url);
      if (response) return response;
    }
    return app.fetch(request, env, ctx);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return app.scheduled(controller, env, ctx);
  },
};
