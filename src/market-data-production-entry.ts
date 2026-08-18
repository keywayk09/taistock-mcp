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
  SISTER_GPT_API_KEY?: string;
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

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

function sisterActionAuthorized(request: Request, env: MarketDataEnv) {
  const expected = env.SISTER_GPT_API_KEY?.trim();
  const supplied = bearerToken(request);
  return Boolean(expected && supplied && constantTimeEqual(supplied, expected));
}

function marketDataAuthorized(request: Request, env: MarketDataEnv) {
  const expected = env.MCP_API_KEY?.trim();
  if (!expected) return false;
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  const bearer = bearerToken(request);
  return (apiKey.length > 0 && constantTimeEqual(apiKey, expected))
    || (bearer.length > 0 && constantTimeEqual(bearer, expected));
}

function sisterActionOpenApiSchema(origin: string) {
  const schema = familyReadOpenApiSchema(origin) as Record<string, any>;
  schema.info = {
    ...schema.info,
    title: "台股引擎 Sister Read API V1",
    description: "台股引擎 Custom GPT 專用的只讀台股查詢入口。媽媽使用獨立 Family MCP/OAuth，不使用此 Action。",
  };
  const operation = schema.paths?.["/api/family/read"]?.post;
  if (operation) {
    operation.summary = "台股引擎智慧查詢（妹妹專用 Action）";
    operation.description = "把台股引擎使用者的原始問題完整送出。只讀；不可觸發資料抓取、研究寫入、策略變更或下單。";
    if (operation.responses?.["401"]) operation.responses["401"].description = "SISTER_GPT_API_KEY 錯誤或缺少";
  }
  return schema;
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

    // Custom GPT lane: the user's shared "台股引擎" uses a dedicated sister-only
    // Bearer key. Mother access remains on /family-mcp through OAuth family role.
    if (url.pathname === "/family-openapi.json" && request.method === "GET") {
      return Response.json(sisterActionOpenApiSchema(url.origin), {
        headers: { "cache-control": "public, max-age=300" },
      });
    }
    if (url.pathname === "/api/family/read") {
      if (!sisterActionAuthorized(request, env as MarketDataEnv)) {
        return Response.json(
          { error: "unauthorized", access_lane: "sister_custom_gpt" },
          {
            status: 401,
            headers: { "www-authenticate": 'Bearer realm="taistock-sister-gpt"' },
          },
        );
      }
      const familyRead = await handleFamilyReadApi(request, env);
      if (familyRead) return familyRead;
    }

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
