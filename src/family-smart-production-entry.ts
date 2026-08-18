import productionEntry, { FamilyMCP, MyMCP } from "./production-entry";
import { runFamilyQuery } from "./v8/family-query";

export { FamilyMCP, MyMCP };

type RuntimeEnv = Env & {
  MOM_GPT_API_KEY?: string;
};

const SMART_ROUTER_VERSION = "family-smart-query-router/v1.0.0";

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
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

/**
 * Only explicit discovery/scanning requests should enter the full-market selector.
 * A bare symbol/company, stock comparison, fundamentals, chips, technicals, themes,
 * or educational question belongs to the general read-only Family Query engine.
 */
export function shouldUseFamilyStockSelector(query: string) {
  const text = query.trim();
  if (!text) return false;

  const symbols = text.match(/(?<!\d)\d{4,6}(?!\d)/g) ?? [];
  const explicitScan = /(選股|選股票|找股|找股票|候選股|篩選.*(?:股|股票|標的)|掃描.*(?:股|股票|標的)|推薦.*(?:股|股票|標的)|找.{0,20}\d+\s*檔|哪幾檔|哪些(?:股|股票|個股|標的)|有沒有.{0,40}(?:股票|個股|標的|波段股)|\btop\s*\d+\b)/i.test(text);
  const selectionFollowUp = symbols.length === 0
    && /(有沒有|還有沒有|再找|幫我找).{0,30}(低位階|低檔|底部|低基期|回檔|拉回|回踩|突破|轉強|強勢|趨勢|波段)/.test(text);

  // A named stock stays an individual-stock query unless the user explicitly asks
  // to discover a list around it, e.g. "找跟2317類似的5檔".
  if (symbols.length > 0) return explicitScan;
  return explicitScan || selectionFollowUp;
}

function addPresentationContract(result: Record<string, any>) {
  const existing = Array.isArray(result.response_instructions) ? result.response_instructions : [];
  return {
    ...result,
    smart_router: {
      version: SMART_ROUTER_VERSION,
      route: result.route ?? "family_query",
      rule: "只有明確找股/選股/Top N/推薦/掃描需求才進全市場 selector；指定個股、比較、財報、籌碼、技術與一般問題走 Family Query。",
    },
    presentation_contract: {
      broad_individual_stock: "使用者只給單一股票代號/公司名，或問怎麼看、能不能買、完整分析時，預設以11大項呈現。",
      numbered_sections: "1-11",
      section_12_role: "後端第12節資料只作最後『操作結論／失敗條件／KPI』，不要顯示成第12大項。",
      focused_question: "若使用者只問外資、財報、支撐等單一面向，直接回答該面向，不硬塞11大項。",
    },
    response_instructions: [
      ...existing,
      "單一個股的廣義分析預設呈現11大項；後端第12節僅併入最後操作結論/失敗條件/KPI，不另列第12項。",
      "若資料鏈不足，明確標示缺口；不得改拿全市場選股結果冒充指定個股資料。",
      "不要在成品回答中重述HTTP endpoint、debug、request/response trace或內部工具資訊。",
    ],
  };
}

async function maybeHandleSmartFamilyQuery(request: Request, env: RuntimeEnv) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/family/query" || request.method !== "POST") return null;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.clone().json();
    body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return null;
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || shouldUseFamilyStockSelector(query)) return null;

  if (!bearerAuthorized(request, env.MOM_GPT_API_KEY)) {
    return jsonResponse(
      { error: "unauthorized" },
      401,
      { "www-authenticate": 'Bearer realm="taistock-family"', ...familyCorsHeaders() },
    );
  }

  try {
    const result = await runFamilyQuery(env, {
      query,
      mode: "auto",
      as_of_date: typeof body.as_of_date === "string" ? body.as_of_date : undefined,
    });
    return jsonResponse(addPresentationContract(result as Record<string, any>), 200, familyCorsHeaders());
  } catch (error) {
    return jsonResponse({
      error: "family_smart_query_failed",
      message: error instanceof Error ? error.message : String(error),
      smart_router: {
        version: SMART_ROUTER_VERSION,
        route: "family_query",
      },
      rule: "指定個股/比較/財報/籌碼資料失敗時必須回報資料缺口；不得退回全市場選股結果冒充答案。",
    }, 503, familyCorsHeaders());
  }
}

async function smartHealth(request: Request, env: Env, ctx: ExecutionContext) {
  const response = await productionEntry.fetch(request, env, ctx);
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    return jsonResponse({
      ...body,
      family_smart_query_router: {
        version: SMART_ROUTER_VERSION,
        individual_stock_route: "family_query",
        selection_route: "family_stock_selector",
        production_safe: true,
      },
    }, response.status);
  } catch {
    return response;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if ((url.pathname === "/" || url.pathname === "/health") && request.method === "GET") {
      return smartHealth(request, env, ctx);
    }
    const smartQuery = await maybeHandleSmartFamilyQuery(request, env as RuntimeEnv);
    if (smartQuery) return smartQuery;
    return productionEntry.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const scheduled = (productionEntry as unknown as {
      scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void>;
    }).scheduled;
    if (scheduled) await scheduled(controller, env, ctx);
  },
};
