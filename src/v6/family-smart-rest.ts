import { runSmartFamilyAnalysis } from "./family-analysis";
import { extractFamilyQuerySymbols, planFamilyQuery } from "./family-adaptive-planner";
import { readFamilyStockMarketContext } from "./family-ohlc-read-bridge";
import { familyOpenApiV2 } from "./family-openapi-v2";
import { familyResearchDirective } from "./family-research-policy";
import { familySharedReadManifest } from "./family-shared-read-plane";
import { runFamilySwingScreenV2 } from "./family-stock-selection-v2";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";

type RuntimeFamilyEnv = Env & { MOM_GPT_API_KEY?: string };

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left), b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function authorized(request: Request, env: RuntimeFamilyEnv) {
  const expected = String(env.MOM_GPT_API_KEY ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && constantTimeEqual(header.slice(7), expected);
}

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 32_000) throw new Error("payload_too_large");
  const value = await request.json();
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

function validSymbol(value: unknown) {
  const symbol = String(value ?? "").trim();
  return /^\d{4,6}$/.test(symbol) ? symbol : null;
}

function validDate(value: unknown) {
  const date = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function optionalPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function inferScreenMode(query: string): "stable" | "balanced" | "aggressive" {
  if (/保守|穩健|比較穩|低波動/i.test(query)) return "stable";
  if (/積極|進攻|高成長|高動能/i.test(query)) return "aggressive";
  return "balanced";
}

export async function handleFamilySmartRest(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === "/family-openapi.json") return json(familyOpenApiV2(url.origin));

  const familyPaths = new Set([
    "/api/family/query",
    "/api/family/market-context",
    "/api/family/chips",
    "/api/family/analyze",
    "/api/family/compare",
    "/api/family/screen",
    "/api/family/status",
  ]);
  if (!familyPaths.has(url.pathname)) return null;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (!authorized(request, env as RuntimeFamilyEnv)) {
    return json({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer realm="taistock-family"', ...cors() });
  }

  if (url.pathname === "/api/family/status") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET, OPTIONS", ...cors() });
    return json({
      ok: true,
      service: "Taiwan Stock AI Family Read-Only API",
      version: "family-rest/v3.1.0",
      intelligence_model: "SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS",
      capabilities: {
        natural_language_query: "ADAPTIVE_INTENT_PLANNER",
        single_stock: "INTENT_ADAPTIVE_WITH_11_POINT_FULL_ANALYSIS_CONTRACT",
        compare_2_to_5: "SAME_EVIDENCE_MODEL_ADAPTIVE_RENDERING",
        swing_screen: "V2_FULL_SNAPSHOT_PREFILTER_BOUNDED_DEEP_SCAN",
        realtime: "FUGLE_PRIMARY_DIRECT_ACTION_AND_ANALYSIS",
        web_research: "OPEN_WORLD_AUTONOMOUS_NOT_FIXED_SITES_OR_KEYWORDS",
        formal_chip: "PUBLISHED_GENERATION_DIRECT_ACTION_AND_ANALYSIS",
        formal_ohlc: "OHLC_MCP_ONLY",
        owner_market_research_reads: "SHARED_BY_DEFAULT_WHEN_AVAILABLE",
        action_surface_parity: "FAMILY_MCP_CORE_READ_TOOLS_EXPOSED",
        writes: "DENIED",
      },
      shared_read_plane: familySharedReadManifest(),
      research_policy: familyResearchDirective([]),
      endpoints: [
        "/api/family/query",
        "/api/family/market-context",
        "/api/family/chips",
        "/api/family/analyze",
        "/api/family/compare",
        "/api/family/screen",
        "/api/family/status",
      ],
      read_only: true,
    }, 200, cors());
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...cors() });

  let body: Record<string, any>;
  try { body = await readBody(request); }
  catch (error) {
    const message = errorText(error);
    return json({ error: message === "payload_too_large" ? "payload_too_large" : "invalid_json" }, message === "payload_too_large" ? 413 : 400, cors());
  }

  try {
    if (url.pathname === "/api/family/market-context") {
      const symbol = validSymbol(body.symbol);
      if (!symbol) return json({ error: "invalid_symbol" }, 400, cors());
      const waitMs = Number.isFinite(Number(body.wait_ms))
        ? Math.max(0, Math.min(2_500, Math.trunc(Number(body.wait_ms))))
        : 0;
      return json(await readFamilyStockMarketContext(env, {
        symbol,
        books: body.books !== false,
        wait_ms: waitMs,
      }), 200, cors());
    }

    if (url.pathname === "/api/family/chips") {
      const symbol = validSymbol(body.symbol);
      if (!symbol) return json({ error: "invalid_symbol" }, 400, cors());
      const calendarDays = Number.isFinite(Number(body.calendar_days))
        ? Math.max(30, Math.min(180, Math.trunc(Number(body.calendar_days))))
        : 60;
      const rawFinancingRatio = Number(body.financing_ratio);
      const financingRatio = Number.isFinite(rawFinancingRatio)
        ? Math.max(0.1, Math.min(0.9, rawFinancingRatio))
        : 0.6;
      return json(await getTwMarketChipSummaryPublished(env, {
        symbol,
        as_of: validDate(body.as_of),
        calendar_days: calendarDays,
        reference_price: optionalPositiveNumber(body.reference_price),
        estimated_financing_cost: optionalPositiveNumber(body.estimated_financing_cost),
        financing_ratio: financingRatio,
      }), 200, cors());
    }

    if (url.pathname === "/api/family/query") {
      const query = String(body.query ?? "").trim();
      if (!query) return json({ error: "query_required" }, 400, cors());
      if (query.length > 2_000) return json({ error: "query_too_long" }, 400, cors());

      const symbols = extractFamilyQuerySymbols(query);
      const adaptivePlan = planFamilyQuery(query, symbols);
      const asOfDate = validDate(body.as_of_date);

      if (adaptivePlan.intent === "SWING_DISCOVERY") {
        const result = await runFamilySwingScreenV2(env, { mode: inferScreenMode(query), top_n: 5 });
        return json({
          ...result,
          route: "adaptive_swing_discovery",
          requested_via: "queryTaiwanStockSystem",
          adaptive_plan: adaptivePlan,
          shared_read_plane: familySharedReadManifest(),
          open_world_research: familyResearchDirective(result.candidates?.map((row: any) => String(row.symbol)) ?? []),
          candidate_identity_rule: "WEB_RESEARCH_CANDIDATE_IS_NOT_ENGINE_RANK_UNTIL_ENGINE_VALIDATED",
        }, 200, cors());
      }

      if (symbols.length) {
        const result = await runSmartFamilyAnalysis(env, { symbols, as_of_date: asOfDate, question: query });
        return json({
          ...result,
          requested_via: "queryTaiwanStockSystem",
          compatibility: "LEGACY_QUERY_NOW_ADAPTIVE_FAMILY_V3",
        }, 200, cors());
      }

      return json({
        ok: true,
        service: "Taiwan Stock AI Family Read-Only API",
        version: "family-rest/v3.1.0",
        route: "adaptive_open_research",
        query,
        resolved_symbols: [],
        adaptive_plan: adaptivePlan,
        shared_read_plane: familySharedReadManifest(),
        open_world_research: familyResearchDirective([]),
        engine_result: null,
        response_instructions: [
          "先依使用者真正問題回答，不要求使用者改成固定指令。",
          "可自由使用 Open Web 與 Family 已共享的市場研究讀取能力追查新線索。",
          "若之後辨識到股票代號、公司、產業、客戶、供應商或事件，可自主深化研究。",
          "正式 OHLC 與 Published 籌碼身份不可被 Web/Fugle/FinMind 取代。",
          "Family 永遠唯讀；不得修改 GitHub、策略、Production、OHLC canonical 或 Diamond Judgment。",
        ],
      }, 200, cors());
    }

    if (url.pathname === "/api/family/analyze") {
      const symbol = validSymbol(body.symbol);
      if (!symbol) return json({ error: "invalid_symbol" }, 400, cors());
      return json(await runSmartFamilyAnalysis(env, { symbols: [symbol], as_of_date: validDate(body.as_of_date) }), 200, cors());
    }

    if (url.pathname === "/api/family/compare") {
      if (!Array.isArray(body.symbols)) return json({ error: "symbols_required" }, 400, cors());
      const rawSymbols = body.symbols.map((value: unknown) => String(value ?? "").trim());
      const symbols = [...new Set(rawSymbols.map(validSymbol).filter((value): value is string => Boolean(value)))];
      if (symbols.length < 2 || symbols.length > 5 || symbols.length !== rawSymbols.length) {
        return json({ error: "symbols_must_be_2_to_5_unique_valid_codes" }, 400, cors());
      }
      return json(await runSmartFamilyAnalysis(env, { symbols, as_of_date: validDate(body.as_of_date) }), 200, cors());
    }

    const mode = ["stable", "balanced", "aggressive"].includes(String(body.mode)) ? body.mode as "stable" | "balanced" | "aggressive" : "balanced";
    const topN = Number.isFinite(Number(body.top_n)) ? Math.max(1, Math.min(10, Math.floor(Number(body.top_n)))) : 5;
    const result = await runFamilySwingScreenV2(env, { mode, top_n: topN });
    return json({
      ...result,
      adaptive_plan: planFamilyQuery("波段選股", []),
      shared_read_plane: familySharedReadManifest(),
      open_world_research: familyResearchDirective(result.candidates?.map((row: any) => String(row.symbol)) ?? []),
    }, 200, cors());
  } catch (error) {
    return json({ error: "family_request_failed", message: errorText(error) }, 500, cors());
  }
}
