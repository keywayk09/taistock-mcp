import productionEntry from "./production-entry";
import {
  getMarketDataStatus,
  marketDataPhaseForCron,
  runMarketDataPipeline,
  type MarketDataPhase,
} from "./v6/market-data-runtime";
import { familyReadOpenApiSchema, handleFamilyReadApi } from "./v10/family-read-api-v1";

export { FamilyMCP, MyMCP } from "./production-entry";

const MARKET_DATA_PHASES = new Set<MarketDataPhase>([
  "fundamentals",
  "institutional_prelim",
  "institutional_final",
  "margin",
  "finalize",
]);

type MarketDataEnv = Env & {
  MCP_API_KEY?: string;
};

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function marketDataAuthorized(request: Request, env: MarketDataEnv) {
  const expected = env.MCP_API_KEY?.trim();
  if (!expected) return false;
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  return (apiKey.length > 0 && constantTimeEqual(apiKey, expected))
    || (bearer.length > 0 && constantTimeEqual(bearer, expected));
}

async function handleMarketData(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/market-data/")) return null;
  if (!marketDataAuthorized(request, env as MarketDataEnv)) {
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
    const phase = url.searchParams.get("phase") as MarketDataPhase | null;
    if (!phase || !MARKET_DATA_PHASES.has(phase)) {
      return Response.json({ error: "invalid phase", allowed: [...MARKET_DATA_PHASES] }, { status: 400 });
    }
    return Response.json(await runMarketDataPipeline(env, phase));
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Family Read API V1 is intentionally placed above the legacy production entry.
    // It is a separate read-only lane for the owner's, mother's and sister's GPTs.
    if (url.pathname === "/family-openapi.json" && request.method === "GET") {
      return Response.json(familyReadOpenApiSchema(url.origin), {
        headers: { "cache-control": "public, max-age=300" },
      });
    }
    const familyRead = await handleFamilyReadApi(request, env);
    if (familyRead) return familyRead;

    const marketData = await handleMarketData(request, env);
    if (marketData) return marketData;
    return productionEntry.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const phase = marketDataPhaseForCron(controller.cron);
    if (phase) {
      ctx.waitUntil(runMarketDataPipeline(env, phase, new Date(controller.scheduledTime)));
      return;
    }
    const scheduled = (productionEntry as unknown as {
      scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void>;
    }).scheduled;
    if (scheduled) await scheduled(controller, env, ctx);
  },
};
