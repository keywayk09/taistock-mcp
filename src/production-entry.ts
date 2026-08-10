import legacyOauthEntry from "./oauth-entry";
import { probeFamilyAlternativeDataPaths } from "./v8/family-data-probes";
import {
  FAMILY_STOCK_SELECTION_VERSION,
  diagnoseFamilySelectionData,
  isFamilyStockSelectionQuery,
  runFamilyStockSelection,
} from "./v8/family-stock-selection-v18";
import {
  inferFamilySelectionIntent,
  type FamilyMode,
  type FamilySelectionObjective,
} from "./v8/family-selection-intent";

export { FamilyMCP, MyMCP } from "./oauth-entry";

type RuntimeEnv = Env & {
  MOM_GPT_API_KEY?: string;
};

type FamilyCacheEnvelope = {
  schema: "family-selection-lkg/v2";
  cached_at: string;
  selector_version: string;
  family_mode: FamilyMode;
  selection_objective: FamilySelectionObjective;
  intent_signature: string;
  top_n: number;
  result: Record<string, unknown>;
};

const FAMILY_RUNTIME_RELEASE = "family-production-runtime/1.9.0";
const FAMILY_CACHE_SCHEMA = "family-selection-lkg/v2" as const;
const FAMILY_CACHE_PREFIX = "family-selection:lkg:v2";
const FAMILY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FAMILY_PREWARM_QUERY = "波段選股，請你幫我找 Top 5";

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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function familyRequestIdentity(query: string) {
  const intent = inferFamilySelectionIntent(query);
  return {
    family_mode: intent.family_mode,
    selection_objective: intent.objective,
    intent_signature: intent.signature,
    top_n: intent.top_n,
    key: `${FAMILY_CACHE_PREFIX}:${intent.signature}:top${intent.top_n}`,
  };
}

function validFamilyCacheEnvelope(value: unknown): value is FamilyCacheEnvelope {
  const item = record(value);
  if (item.schema !== FAMILY_CACHE_SCHEMA) return false;
  if (typeof item.cached_at !== "string" || !Number.isFinite(Date.parse(item.cached_at))) return false;
  if (typeof item.selector_version !== "string") return false;
  if (!(["stable", "balanced", "aggressive"] as const).includes(item.family_mode as FamilyMode)) return false;
  if (!([
    "balanced",
    "low_position_turning_up",
    "pullback_entry",
    "breakout_confirmed",
    "steady_trend",
    "aggressive_momentum",
  ] as const).includes(item.selection_objective as FamilySelectionObjective)) return false;
  if (typeof item.intent_signature !== "string" || !item.intent_signature) return false;
  if (!Number.isInteger(item.top_n) || Number(item.top_n) < 1 || Number(item.top_n) > 10) return false;
  return Object.keys(record(item.result)).length > 0;
}

async function putFamilySelectionCache(env: RuntimeEnv, query: string, result: unknown) {
  const identity = familyRequestIdentity(query);
  const payload = record(result);
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!candidates.length) return;
  const envelope: FamilyCacheEnvelope = {
    schema: FAMILY_CACHE_SCHEMA,
    cached_at: new Date().toISOString(),
    selector_version: FAMILY_STOCK_SELECTION_VERSION,
    family_mode: identity.family_mode,
    selection_objective: identity.selection_objective,
    intent_signature: identity.intent_signature,
    top_n: identity.top_n,
    result: payload,
  };
  await env.OAUTH_KV.put(identity.key, JSON.stringify(envelope));
}

async function getFamilySelectionCache(env: RuntimeEnv, query: string) {
  const identity = familyRequestIdentity(query);
  const raw = await env.OAUTH_KV.get(identity.key);
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!validFamilyCacheEnvelope(parsed)) return null;
  if (parsed.family_mode !== identity.family_mode
    || parsed.selection_objective !== identity.selection_objective
    || parsed.intent_signature !== identity.intent_signature
    || parsed.top_n !== identity.top_n) return null;
  const age_ms = Date.now() - Date.parse(parsed.cached_at);
  if (age_ms < 0 || age_ms > FAMILY_CACHE_MAX_AGE_MS) return null;
  const candidates = Array.isArray(parsed.result.candidates) ? parsed.result.candidates : [];
  if (!candidates.length) return null;
  return { envelope: parsed, age_ms };
}

function cachedFallbackResult(cache: { envelope: FamilyCacheEnvelope; age_ms: number }, liveError: unknown) {
  const result = cache.envelope.result;
  return {
    ...result,
    runtime_release: FAMILY_RUNTIME_RELEASE,
    cache_fallback: {
      used: true,
      schema: FAMILY_CACHE_SCHEMA,
      cached_at: cache.envelope.cached_at,
      age_minutes: Math.round(cache.age_ms / 60000),
      selector_version: cache.envelope.selector_version,
      selection_objective: cache.envelope.selection_objective,
      intent_signature: cache.envelope.intent_signature,
      reason: liveError instanceof Error ? liveError.message : String(liveError),
      rule: "即時完整市場資料鏈失敗時，只能回退到七日內同一選股意圖的最後成功結果；不得拿 balanced 名單冒充低位階/回檔/突破，也不得用新聞硬湊。",
    },
  };
}

async function familyCacheHealth(env: RuntimeEnv) {
  const queries = [
    "穩健波段選股 Top 5",
    FAMILY_PREWARM_QUERY,
    "積極波段選股 Top 5",
    "有沒有低位階、還沒大漲但開始轉強的波段股 Top 5",
    "找回檔到支撐附近的波段股 Top 5",
    "找突破確認型的波段股 Top 5",
  ];
  const rows = await Promise.all(queries.map(async (query) => {
    const identity = familyRequestIdentity(query);
    const raw = await env.OAUTH_KV.get(identity.key);
    if (!raw) return {
      mode: identity.family_mode,
      objective: identity.selection_objective,
      intent_signature: identity.intent_signature,
      top_n: identity.top_n,
      available: false,
    };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return { objective: identity.selection_objective, top_n: identity.top_n, available: false, invalid: true }; }
    if (!validFamilyCacheEnvelope(parsed)) {
      return { objective: identity.selection_objective, top_n: identity.top_n, available: false, invalid: true };
    }
    const age_ms = Date.now() - Date.parse(parsed.cached_at);
    const candidates = Array.isArray(parsed.result.candidates) ? parsed.result.candidates : [];
    return {
      mode: identity.family_mode,
      objective: identity.selection_objective,
      intent_signature: identity.intent_signature,
      top_n: identity.top_n,
      available: age_ms >= 0 && age_ms <= FAMILY_CACHE_MAX_AGE_MS && candidates.length > 0,
      cached_at: parsed.cached_at,
      age_minutes: Math.max(0, Math.round(age_ms / 60000)),
      candidate_count: candidates.length,
      latest_candidate_price_date: record(parsed.result).latest_candidate_price_date ?? null,
      selector_version: parsed.selector_version,
    };
  }));
  return {
    runtime_release: FAMILY_RUNTIME_RELEASE,
    cache_schema: FAMILY_CACHE_SCHEMA,
    max_age_days: FAMILY_CACHE_MAX_AGE_MS / 86400000,
    identity_rule: "family_mode + selection_objective + avoid_chasing signature + top_n",
    entries: rows,
  };
}

async function refreshDefaultFamilyCache(env: RuntimeEnv) {
  const result = await runFamilyStockSelection(env, { query: FAMILY_PREWARM_QUERY });
  await putFamilySelectionCache(env, FAMILY_PREWARM_QUERY, result);
}

async function maybeHandleFamilySelection(request: Request, env: RuntimeEnv, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/family/query" || request.method !== "POST") return null;

  const clone = request.clone();
  let body: unknown;
  try { body = await clone.json(); }
  catch { return null; }
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
    ctx.waitUntil(putFamilySelectionCache(env, query, result).catch(() => undefined));
    return jsonResponse({ ...record(result), runtime_release: FAMILY_RUNTIME_RELEASE }, 200, familyCorsHeaders());
  } catch (error) {
    const cached = await getFamilySelectionCache(env, query).catch(() => null);
    if (cached) return jsonResponse(cachedFallbackResult(cached, error), 200, familyCorsHeaders());
    const intent = inferFamilySelectionIntent(query);
    return jsonResponse({
      error: "family_stock_selection_failed",
      message: error instanceof Error ? error.message : String(error),
      interpreted_intent: intent,
      rule: "資料鏈失敗不可解讀成市場沒有好股票，也不可改用新聞或固定 balanced 名單硬湊候選股。",
      selector_version: FAMILY_STOCK_SELECTION_VERSION,
      runtime_release: FAMILY_RUNTIME_RELEASE,
      cache_fallback: {
        used: false,
        reason: "沒有七日內可用的同意圖、同模式、同 Top N 最後成功結果",
      },
      diagnostic_route: "/health/family-selection-data",
      intent_diagnostic_route: "/health/family-intent?q=...",
      cache_diagnostic_route: "/health/family-cache",
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
        runtime_release: FAMILY_RUNTIME_RELEASE,
        intent_engine: "family-selection-intent/v1",
        route: "/api/family/query",
        diagnostic_route: "/health/family-selection-data",
        intent_diagnostic_route: "/health/family-intent?q=...",
        cache_diagnostic_route: "/health/family-cache",
        cache_schema: FAMILY_CACHE_SCHEMA,
        cache_max_age_days: FAMILY_CACHE_MAX_AGE_MS / 86400000,
        horizon: "1-8 weeks",
        production_safe: true,
      },
    }, response.status);
  } catch { return response; }
}

async function familyDataHealth(env: Env) {
  try {
    const diagnostics = await diagnoseFamilySelectionData(env);
    return jsonResponse({ ...record(diagnostics), runtime_release: FAMILY_RUNTIME_RELEASE }, diagnostics.usable ? 200 : 503);
  } catch (error) {
    return jsonResponse({
      selector_version: FAMILY_STOCK_SELECTION_VERSION,
      runtime_release: FAMILY_RUNTIME_RELEASE,
      usable: false,
      error: error instanceof Error ? error.message : String(error),
    }, 503);
  }
}

function familyIntentHealth(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || FAMILY_PREWARM_QUERY;
  return jsonResponse({
    selector_version: FAMILY_STOCK_SELECTION_VERSION,
    runtime_release: FAMILY_RUNTIME_RELEASE,
    intent_engine: "family-selection-intent/v1",
    query,
    interpreted_intent: inferFamilySelectionIntent(query),
  });
}

async function familyAlternativeDataHealth(env: Env) {
  try { return jsonResponse(await probeFamilyAlternativeDataPaths(env)); }
  catch (error) { return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 503); }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return augmentHealth(request, env, ctx);
    if (url.pathname === "/health/family-selection-data" && request.method === "GET") return familyDataHealth(env);
    if (url.pathname === "/health/family-intent" && request.method === "GET") return familyIntentHealth(request);
    if (url.pathname === "/health/family-alternative-data" && request.method === "GET") return familyAlternativeDataHealth(env);
    if (url.pathname === "/health/family-cache" && request.method === "GET") {
      return jsonResponse(await familyCacheHealth(env as RuntimeEnv));
    }
    const familySelection = await maybeHandleFamilySelection(request, env as RuntimeEnv, ctx);
    if (familySelection) return familySelection;
    return legacyOauthEntry.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshDefaultFamilyCache(env as RuntimeEnv).catch(() => undefined));
    const scheduled = (legacyOauthEntry as unknown as {
      scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void>
    }).scheduled;
    if (scheduled) await scheduled(controller, env, ctx);
  },
};