import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import baseWorker, { MyMCP as BaseMyMCP } from "./index-v6";
import { registerSelectionTools, SELECTION_TOOLS_VERSION } from "./v6/selection-tools.ts";
import { SELECTION_SCHEDULE_VERSION } from "./v6/selection-schedule.ts";
import { runSelectionAwareScheduledController } from "./v6/selection-scheduled-dispatch.ts";
import {
  INTRADAY_REVIEW_SELECTOR_VERSION,
  NEXT_DAY_INTRADAY_SELECTOR_VERSION,
  SWING_JOURNAL_SELECTOR_VERSION,
} from "./v6/selection-engine.ts";
import { LIVE_DECISION_LEDGER_VERSION } from "./v6/live-decision-ledger.ts";

export { FamilyMCP } from "./index-v6";

export class MyMCP extends BaseMyMCP {
  server = new McpServer({ name: "Taiwan Stock AI", version: "6.19.0" });

  async init() {
    await super.init();
    registerSelectionTools(this.server, this.env);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    // Only the Owner/Diamond MCP route is replaced so the verified V6 HTTP,
    // Family OAuth, market-data and research surfaces stay untouched.
    if (url.pathname === "/my-mcp" || url.pathname === "/mcp") {
      return MyMCP.serve(url.pathname).fetch(request, env, ctx);
    }
    if (url.pathname === "/health/selection" && request.method === "GET") {
      return Response.json({
        status: "ok",
        version: SELECTION_TOOLS_VERSION,
        schedule_version: SELECTION_SCHEDULE_VERSION,
        selectors: {
          intraday_review: INTRADAY_REVIEW_SELECTOR_VERSION,
          swing: SWING_JOURNAL_SELECTOR_VERSION,
          next_day_intraday: NEXT_DAY_INTRADAY_SELECTOR_VERSION,
          live_decision: LIVE_DECISION_LEDGER_VERSION,
        },
        schedule: {
          intraday_review: "18:30-18:55 Asia/Taipei",
          swing_and_next_day_intraday: "22:30-22:55 Asia/Taipei",
          final_audit_delta: "08:55 Asia/Taipei after 08:30 final-audit window",
          live_decision: "09:00-13:30 Asia/Taipei on demand",
        },
        hard_rules: [
          "SWING_INTRADAY_REVIEW_NEXT_DAY_INTRADAY_LABELS_SEPARATE",
          "COMMON_RAW_DATA_ONLY",
          "IMMUTABLE_POINT_IN_TIME_SELECTIONS",
          "AUDIT_NEVER_REWRITES_SELECTION",
          "STRICT_COMPANY_MASTER_ETF_EXCLUSION",
          "LIVE_DECISION_SEPARATE_FROM_NIGHTLY_SELECTION",
        ],
      });
    }
    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSelectionAwareScheduledController(env, controller.scheduledTime));
  },
};
