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
  TAISTOCK_GPT_READ_KEY?: string;
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

function sharedGptActionAuthorized(request: Request, env: MarketDataEnv) {
  const expected = env.TAISTOCK_GPT_READ_KEY?.trim();
  const supplied = bearerToken(request);
  return Boolean(expected && supplied && constantTimeEqual(supplied, expected));
}

/**
 * Family Read V1 originally named its third read-only credential SISTER_GPT_API_KEY.
 * Keep that name as an internal compatibility alias only. The Cloudflare/public
 * contract is TAISTOCK_GPT_READ_KEY and no SISTER_GPT_API_KEY secret is required.
 */
function sharedGptReadEnv(env: Env): Env {
  const runtime = env as MarketDataEnv;
  const sharedKey = runtime.TAISTOCK_GPT_READ_KEY;
  return new Proxy(runtime, {
    get(target, property, receiver) {
      if (property === "SISTER_GPT_API_KEY") return sharedKey;
      return Reflect.get(target, property, receiver);
    },
  }) as Env;
}

async function normalizeSharedGptResponse(response: Response) {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  try {
    const body = await response.clone().json() as Record<string, any>;
    if (body.family_read && typeof body.family_read === "object") {
      body.family_read.identity = "shared_gpt";
      body.family_read.access_lane = "taistock_custom_gpt";
    }
    return new Response(JSON.stringify(body, null, 2), {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    return response;
  }
}

function marketDataAuthorized(request: Request, env: MarketDataEnv) {
  const expected = env.MCP_API_KEY?.trim();
  if (!expected) return false;
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  const bearer = bearerToken(request);
  return (apiKey.length > 0 && constantTimeEqual(apiKey, expected))
    || (bearer.length > 0 && constantTimeEqual(bearer, expected));
}

function sharedGptActionOpenApiSchema(origin: string) {
  const schema = familyReadOpenApiSchema(origin) as Record<string, any>;
  schema.info = {
    ...schema.info,
    title: "台股引擎 Shared Read API V1",
    description: "分享版台股引擎 Custom GPT 專用的只讀台股查詢入口。知道台股引擎連結的使用者可透過 GPT 使用；API 本身仍由共用只讀金鑰保護。媽媽使用獨立 Family MCP/OAuth。",
  };
  const operation = schema.paths?.["/api/family/read"]?.post;
  if (operation) {
    operation.summary = "台股引擎智慧查詢（共享只讀 Action）";
    operation.description = "把台股引擎使用者的原始問題完整送出。只讀；不可觸發資料抓取、研究寫入、策略變更或下單。";
    if (operation.responses?.["401"]) operation.responses["401"].description = "TAISTOCK_GPT_READ_KEY 錯誤或缺少";
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

    // Shared Custom GPT lane: one read-only credential belongs to the GPT itself,
    // not to a particular family member. Mother stays on /family-mcp via OAuth.
    if (url.pathname === "/family-openapi.json" && request.method === "GET") {
      return Response.json(sharedGptActionOpenApiSchema(url.origin), {
        headers: { "cache-control": "public, max-age=300" },
      });
    }
    if (url.pathname === "/api/family/read") {
      if (!sharedGptActionAuthorized(request, env as MarketDataEnv)) {
        return Response.json(
          { error: "unauthorized", access_lane: "taistock_custom_gpt" },
          {
            status: 401,
            headers: { "www-authenticate": 'Bearer realm="taistock-gpt-read"' },
          },
        );
      }
      const familyRead = await handleFamilyReadApi(request, sharedGptReadEnv(env));
      if (familyRead) return normalizeSharedGptResponse(familyRead);
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
