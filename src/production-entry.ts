import legacyOauthEntry from "./oauth-entry";
import {
  FAMILY_STOCK_SELECTION_VERSION,
  diagnoseFamilySelectionData,
  isFamilyStockSelectionQuery,
  runFamilyStockSelection,
} from "./v8/family-stock-selection-v12";

export { FamilyMCP, MyMCP } from "./oauth-entry";

type RuntimeEnv = Env & {
  MOM_GPT_API_KEY?: string;
};

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

function bearerAuthorized(request: Request, secret?: string) {
  const expected = secret?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice(7), expected);
}

function familyCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function maybeHandleFamilySelection(request: Request, env: RuntimeEnv) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/family/query" || request.method !== "POST") return null;

  const clone = request.clone();
  let body: unknown;
  try {
    body = await clone.json();
  } catch {
    return null;
  }
  const input = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query || !isFamilyStockSelectionQuery(query)) return null;

  if (!bearerAuthorized(request, env.MOM_GPT_API_KEY)) {
    return jsonResponse(
      { error: "unauthorized" },
      401,
      { "www-authenticate": 'Bearer realm="taistock-family"', ...familyCorsHeaders() },
    );
  }

  try {
    const result = await runFamilyStockSelection(env, {
      query,
      as_of_date: typeof input.as_of_date === "string" ? input.as_of_date : undefined,
    });
    return jsonResponse(result, 200, familyCorsHeaders());
  } catch (error) {
    return jsonResponse({
      error: "family_stock_selection_failed",
      message: error instanceof Error ? error.message : String(error),
      rule: "資料鏈失敗不可解讀成市場沒有好股票，也不可改用新聞硬湊候選股。",
      selector_version: FAMILY_STOCK_SELECTION_VERSION,
      diagnostic_route: "/health/family-selection-data",
    }, 503, familyCorsHeaders());
  }
}

async function augmentHealth(request: Request, env: Env, ctx: ExecutionContext) {
  const response = await legacyOauthEntry.fetch(request, env, ctx);
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    return jsonResponse({
      ...body,
      family_stock_selection: {
        version: FAMILY_STOCK_SELECTION_VERSION,
        route: "/api/family/query",
        diagnostic_route: "/health/family-selection-data",
        horizon: "1-8 weeks",
        production_safe: true,
      },
    }, response.status);
  } catch {
    return response;
  }
}

async function familyDataHealth(env: Env) {
  try {
    const diagnostics = await diagnoseFamilySelectionData(env);
    return jsonResponse(diagnostics, diagnostics.usable ? 200 : 503);
  } catch (error) {
    return jsonResponse({
      selector_version: FAMILY_STOCK_SELECTION_VERSION,
      usable: false,
      error: error instanceof Error ? error.message : String(error),
    }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return augmentHealth(request, env, ctx);
    if (url.pathname === "/health/family-selection-data" && request.method === "GET") return familyDataHealth(env);
    const familySelection = await maybeHandleFamilySelection(request, env as RuntimeEnv);
    if (familySelection) return familySelection;
    return legacyOauthEntry.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const scheduled = (legacyOauthEntry as unknown as { scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void> }).scheduled;
    if (scheduled) await scheduled(controller, env, ctx);
  },
};
