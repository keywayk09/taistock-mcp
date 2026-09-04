import { runSmartFamilyAnalysis } from "./family-analysis";
import { planFamilyQuery } from "./family-adaptive-planner";
import { runFamilyBrokerQueryFastPath } from "./family-broker-query-fast-path";
import { compactFamilyAnalysisForCustomGpt } from "./family-custom-gpt-compact";
import { buildFamilyMarketQuestionContext } from "./family-market-question";
import { readFamilyStockMarketContext } from "./family-ohlc-read-bridge";
import { familyOpenApiV2 } from "./family-openapi-v2";
import { resolveFamilyQuery } from "./family-query-resolver";
import { familyResearchDirective } from "./family-research-policy";
import { familySharedReadManifest } from "./family-shared-read-plane";
import { runFamilySwingScreenV2 } from "./family-stock-selection-v2";
import { runFamilyCreditSblQueryFastPath } from "./tw-credit-sbl-query-fast-path";
import { getTwMarketChipSummaryOnDemand } from "./tw-market-chip-on-demand-facade";
import { resolveTradingAsOf } from "./tw-trading-asof-resolver";

type RuntimeFamilyEnv = Env & { MOM_GPT_API_KEY?: string };

const DEFAULT_COMPOSITE_BROKER_WINDOWS = [1, 5, 10, 20, 60] as const;

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function compactJson(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
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

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function hasExplicitBrokerWindow(maskedQuery: string) {
  return /(?<!\d)(?:1|5|10|20|40|60|120|240)\s*(?:日|天|[dD])(?![A-Za-z])/.test(maskedQuery);
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
      version: "family-rest/v3.4.0",
      intelligence_model: "SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS",
      capabilities: {
        natural_language_query: "ADAPTIVE_INTENT_PLANNER",
        single_stock: "INTENT_ADAPTIVE_WITH_11_POINT_FULL_ANALYSIS_CONTRACT",
        compare_2_to_5: "SAME_EVIDENCE_MODEL_ADAPTIVE_RENDERING",
        swing_screen: "V2_FULL_SNAPSHOT_PREFILTER_BOUNDED_DEEP_SCAN",
        realtime: "FUGLE_PRIMARY_DIRECT_ACTION_AND_ANALYSIS",
        market_event_context: "TXF_GLOBAL_FUTURES_JIN10_READ_ONLY",
        web_research: "OPEN_WORLD_AUTONOMOUS_NOT_FIXED_SITES_OR_KEYWORDS",
        formal_chip: "OFFICIAL_EXACT_DATE_ON_DEMAND_CURRENT+PUBLISHED_HISTORY_CONTEXT",
        broker_branch: "MONEYDJ_RANKED_ONLY_FAIL_SOFT_NO_FINMIND_TOKEN",
        credit_sbl: "TWSE_TPEX_TARGETED_1D_5D_10D_20D_60D_FAST_PATH",
        credit_sbl_broker_composite: "PARALLEL_BOUNDED_SAME_ASOF_NO_WEB",
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
      return json(await getTwMarketChipSummaryOnDemand(env, {
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

      const queryResolution = resolveFamilyQuery(query);
      const symbols = [...queryResolution.symbols];
      const adaptivePlan = planFamilyQuery(query, symbols);
      // Literal user text wins over an optional generated structured field. This
      // prevents an Action model from accidentally replacing the date the user
      // actually typed.
      const asOfDate = queryResolution.as_of_date ?? validDate(body.as_of_date);

      if (adaptivePlan.intent === "CREDIT_SBL_BROKER_QUERY") {
        const requestedAsOf = asOfDate ?? taipeiDate();
        const explicitAsOf = queryResolution.as_of_date !== null;
        const asOfResolution = await resolveTradingAsOf({
          as_of: requestedAsOf,
          explicit: explicitAsOf,
        });
        const compositeBrokerWindows = hasExplicitBrokerWindow(queryResolution.masked_query)
          ? queryResolution.broker_windows
          : DEFAULT_COMPOSITE_BROKER_WINDOWS;
        const [creditResult, brokerResult] = await Promise.all([
          runFamilyCreditSblQueryFastPath(env, {
            symbol: symbols[0],
            query,
            as_of: requestedAsOf,
            as_of_explicit: explicitAsOf,
          }),
          runFamilyBrokerQueryFastPath({
            symbol: symbols[0],
            as_of: asOfResolution.resolved_as_of,
            windows: compositeBrokerWindows,
          }),
        ]);
        const dateContractConsistent = creditResult.resolved_as_of === null
          || creditResult.resolved_as_of === asOfResolution.resolved_as_of;
        const creditOk = creditResult.ok === true;
        const brokerOk = brokerResult.ok === true;
        const status = !dateContractConsistent
          ? "CONFLICT"
          : creditOk && brokerOk
            ? "READY"
            : creditOk || brokerOk
              ? "DEGRADED"
              : "UNAVAILABLE";
        return compactJson({
          ok: dateContractConsistent && (creditOk || brokerOk),
          version: "family-credit-sbl-broker-composite/v1.0.0",
          route: "adaptive_credit_sbl_broker_query",
          status,
          read_only: true,
          persistence: "NONE",
          symbol: symbols[0],
          query,
          requested_as_of: requestedAsOf,
          resolved_as_of: asOfResolution.resolved_as_of,
          as_of_resolution: asOfResolution.mode,
          previous_day_substitution: false,
          date_contract_consistent: dateContractConsistent,
          requested_broker_windows: [...compositeBrokerWindows],
          credit_sbl: creditResult,
          broker: brokerResult,
          provider_policy: {
            web_fetch: false,
            ohlc_fetch: false,
            fundamental_fetch: false,
            jin10_fetch: false,
            published_chip_fetch: false,
            credit_sbl_official_exact_date: true,
            broker_ranked_same_provider_bundle: true,
            cross_provider_window_mixing: false,
            broker_web_backfill: false,
          },
          response_instructions: [
            "這是融資融券/借券與券商分點的bounded composite fast path；只用credit_sbl與broker欄位回答，不得另啟Open Web、OHLC、財報、Jin10或完整11點研究補數字。",
            "requested_as_of若為明示日期必須exact-date；未明示日期才可解析最近交易日。credit_sbl與broker必須共享resolved_as_of，若date_contract_consistent=false必須標CONFLICT並停止比較。",
            "券商分點數字只能取broker中的canonical同平台bundle；禁止逐window混來源、Web補洞、前一日替代或把未上榜分點當零。",
            "1D/5D/10D/20D/60D是同一截止日的巢狀累計窗口，不是五段獨立時間；不得把『各窗口同方向』寫成『每天持續買/賣』或連續性已被證明。",
            "券商分點是執行通路，不等於外資、投信、自營商或特定投資人身分；只能描述分點本身的淨買賣。",
            "融券餘額下降可描述為融券部位減少；除非另有成交/價格等直接證據，不得把融券減少單獨斷言為當日上漲由軋空或主動回補推動。",
          ],
          resolved_symbols: symbols,
          requested_via: "queryTaiwanStockSystem",
          adaptive_plan: adaptivePlan,
          query_resolution: queryResolution,
          shared_read_plane: familySharedReadManifest(),
        }, 200, cors());
      }

      if (adaptivePlan.intent === "BROKER_WINDOW_QUERY") {
        const result = await runFamilyBrokerQueryFastPath({
          symbol: symbols[0],
          as_of: asOfDate ?? taipeiDate(),
          windows: queryResolution.broker_windows,
        });
        return compactJson({
          ...result,
          route: "adaptive_broker_window_query",
          query,
          as_of_date: asOfDate ?? taipeiDate(),
          resolved_symbols: symbols,
          requested_via: "queryTaiwanStockSystem",
          adaptive_plan: adaptivePlan,
          query_resolution: queryResolution,
          shared_read_plane: familySharedReadManifest(),
        }, 200, cors());
      }

      if (adaptivePlan.intent === "CREDIT_SBL_QUERY") {
        const result = await runFamilyCreditSblQueryFastPath(env, {
          symbol: symbols[0],
          query,
          as_of: asOfDate ?? taipeiDate(),
          as_of_explicit: queryResolution.as_of_date !== null,
        });
        return compactJson({
          ...result,
          route: "adaptive_credit_sbl_query",
          query,
          as_of_date: result.resolved_as_of ?? asOfDate ?? taipeiDate(),
          resolved_symbols: symbols,
          requested_via: "queryTaiwanStockSystem",
          adaptive_plan: adaptivePlan,
          query_resolution: queryResolution,
          shared_read_plane: familySharedReadManifest(),
        }, 200, cors());
      }

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

      if (adaptivePlan.intent === "MARKET_CONTEXT") {
        const resolvedAsOf = asOfDate ?? taipeiDate();
        const engineResult = await buildFamilyMarketQuestionContext(env, {
          as_of_date: resolvedAsOf,
          question: query,
          intent: adaptivePlan.intent,
        });
        return compactJson({
          ok: true,
          service: "Taiwan Stock AI Family Read-Only API",
          version: "family-rest/v3.4.0",
          route: "adaptive_market_context",
          query,
          as_of_date: resolvedAsOf,
          resolved_symbols: [],
          requested_via: "queryTaiwanStockSystem",
          adaptive_plan: adaptivePlan,
          shared_read_plane: familySharedReadManifest(),
          engine_result: engineResult,
          open_world_research: familyResearchDirective([]),
          response_instructions: [
            "先用engine_result中的TXF、Global Futures與Jin10事件建立時間線，再回答市場為什麼漲跌。",
            "Jin10快訊/財經日曆屬事件研究context；不得冒充正式OHLC、當期官方籌碼或官方公司公告。",
            "TXF/Global Futures不可用時必須明示UNAVAILABLE，不得假裝已抓到；Web可補充與交叉驗證。",
            "若事件時間與價格轉折不能對上，必須標示推論不成立或證據不足。",
            "Family永遠唯讀；不得修改GitHub、策略、Production、OHLC canonical或Diamond Judgment。",
          ],
        }, 200, cors());
      }

      if (symbols.length) {
        const result = await runSmartFamilyAnalysis(env, { symbols, as_of_date: asOfDate, question: query });
        const compact = compactFamilyAnalysisForCustomGpt(result);
        return compactJson({
          ...compact,
          requested_via: "queryTaiwanStockSystem",
          compatibility: "LEGACY_QUERY_NOW_ADAPTIVE_FAMILY_V3_COMPACT",
        }, 200, cors());
      }

      return json({
        ok: true,
        service: "Taiwan Stock AI Family Read-Only API",
        version: "family-rest/v3.4.0",
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
          "正式OHLC、TWSE/TPEx exact-date當期籌碼與Published歷史的資料身份不可被Web/Fugle/FinMind取代或混用。",
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
