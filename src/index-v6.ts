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
import { runTpexMarketDataBackfill } from "./v6/tpex-market-data-backfill";
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
const BACKFILL_20260819_CRON = "*/5 17-18 19 8 *";
const BACKFILL_20260819_DATE = "2026-08-19";

async function getTwMarketDataStatus(env: Env, tradeDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return { ok: false, error: "invalid_trade_date", trade_date: tradeDate };
  }
  if (!env.RESEARCH_DB) {
    return { ok: false, error: "RESEARCH_DB_binding_required", trade_date: tradeDate };
  }
  try {
    const result = await env.RESEARCH_DB.prepare(`
      SELECT dataset_version,trade_date,market,kind,source,row_count,status,captured_at,error
      FROM tw_market_data_snapshot_d1
      WHERE trade_date=?
      ORDER BY captured_at DESC
    `).bind(tradeDate).all<any>();
    const latest = new Map<string, any>();
    for (const row of result.results ?? []) {
      const key = `${row.kind}|${row.market}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const expected = [
      ["institutional", "listed"],
      ["institutional", "otc"],
      ["margin", "listed"],
      ["margin", "otc"],
    ] as const;
    const layers = expected.map(([kind, market]) => {
      const row = latest.get(`${kind}|${market}`);
      return row ? {
        kind,
        market,
        status: row.status,
        rows: row.row_count,
        source: row.source,
        captured_at: row.captured_at,
        dataset_version: row.dataset_version,
        error: row.error ?? null,
      } : {
        kind,
        market,
        status: "MISSING",
        rows: 0,
        source: null,
        captured_at: null,
        dataset_version: null,
        error: null,
      };
    });
    const ready = layers.filter((layer) => layer.status === "READY").length;
    return {
      ok: true,
      trade_date: tradeDate,
      storage: "D1_ONLY",
      status: ready === 4 ? "READY" : ready ? "DEGRADED" : "MISSING",
      ready_count: ready,
      total_count: 4,
      blocking: false,
      market_data_failure_blocks_ohlc: false,
      layers,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table/i.test(message)) {
      return {
        ok: true,
        trade_date: tradeDate,
        storage: "D1_ONLY",
        status: "MISSING",
        ready_count: 0,
        total_count: 4,
        blocking: false,
        market_data_failure_blocks_ohlc: false,
        layers: [],
      };
    }
    return { ok: false, trade_date: tradeDate, error: message };
  }
}

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
          version: "diamond-tw-market-data/v1.1.1-d1",
          storage: "D1_ONLY",
          policy: "official_first_layer_degradation",
          ohlc_gateway: "OHLC_MCP_ONLY",
          scheduled_capture_taipei: ["18:30", "20:30 retry/finalize"],
          status_endpoint: "/market-data/status?trade_date=YYYY-MM-DD",
          temporary_backfill: "2026-08-19 TPEx-only with timeout/error receipt",
        },
        mcp_endpoint: "/mcp",
        research_status_endpoint: "/research/status",
        tools: 111,
      });
    }

    if (url.pathname === "/market-data/status" && request.method === "GET") {
      const tradeDate = url.searchParams.get("trade_date")?.trim() || taipeiDateFromMs(Date.now());
      return Response.json(await getTwMarketDataStatus(env, tradeDate));
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
    if (controller.cron === BACKFILL_20260819_CRON) {
      ctx.waitUntil(runTpexMarketDataBackfill(env, BACKFILL_20260819_DATE));
      return;
    }
    if (!MARKET_DATA_CRONS.has(controller.cron)) return;
    const tradeDate = taipeiDateFromMs(controller.scheduledTime);
    ctx.waitUntil(runTwMarketDataDaily(env, tradeDate));
  },
};
