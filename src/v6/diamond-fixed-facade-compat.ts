import { readFamilyStockMarketContext } from "./family-ohlc-read-bridge";
import { readGitHubJson } from "./github-data-store";
import { getSupplyChainContract } from "./supply-chain-graph";
import { getTwMarketChipSummaryOnDemand } from "./tw-market-chip-on-demand-facade";
import {
  getTwFullMarketInstitutionalOnDemand,
  getTwFullMarketMarginOnDemand,
} from "./tw-full-market-chip-on-demand";

export const DIAMOND_CHATGPT_FIXED_FACADE_VERSION = "diamond-chatgpt-fixed-facade/v1";

/**
 * Names that exist in the frozen 79-tool ChatGPT App snapshot but are absent
 * from the modern Owner tools/list inventory.
 *
 * Do NOT register these names into modern tools/list. ChatGPT may continue to
 * call them from its cached schema, so the authenticated Owner content handler
 * intercepts only tools/call for these legacy names. This preserves the modern
 * runtime inventory while keeping the historical App callable.
 */
export const DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES = Object.freeze([
  "add_industry_evidence",
  "create_classification_candidate",
  "get_active_etf_daily_change_report",
  "get_active_etf_holding_changes",
  "get_active_etf_holdings",
  "get_active_etf_list",
  "get_company_industry_map",
  "get_daily_chip_report",
  "get_global_industry_coverage",
  "get_official_market_institutional",
  "get_official_market_margin",
  "get_official_stock_institutional",
  "get_official_stock_margin",
  "get_stock_active_etf_activity",
  "get_supply_chain_network",
  "get_taifex_futures_daily",
  "get_taifex_futures_positions",
  "get_taifex_institutional_general",
  "get_taifex_options_daily",
  "get_taifex_options_positions",
  "get_taiwan_stock_analysis_12",
  "get_taiwan_stock_analysis_kpis",
  "get_taiwan_stock_analysis_template_12",
  "get_theme_industry_map",
  "get_unclassified_taiwan_companies",
  "import_global_industry_batch",
  "initialize_global_industry_map",
  "list_active_etf_official_sources",
  "refresh_active_etf_official_holdings",
  "review_classification_candidate",
  "search_global_industry_map",
  "set_active_etf_official_source",
  "set_company_theme_membership",
  "set_supply_chain_edge",
  "set_taiwan_stock_analysis_context",
  "sync_taiwan_company_universe",
  "upsert_global_company",
  "upsert_industry_theme",
  "upsert_taiwan_stock_analysis_kpi",
] as const);

const compatNames = new Set<string>(DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES);

const retiredWrites = new Set<string>([
  "add_industry_evidence",
  "create_classification_candidate",
  "import_global_industry_batch",
  "initialize_global_industry_map",
  "refresh_active_etf_official_holdings",
  "review_classification_candidate",
  "set_active_etf_official_source",
  "set_company_theme_membership",
  "set_supply_chain_edge",
  "set_taiwan_stock_analysis_context",
  "sync_taiwan_company_universe",
  "upsert_global_company",
  "upsert_industry_theme",
  "upsert_taiwan_stock_analysis_kpi",
]);

const etfReads = new Set<string>([
  "get_active_etf_daily_change_report",
  "get_active_etf_holding_changes",
  "get_active_etf_holdings",
  "get_active_etf_list",
  "get_stock_active_etf_activity",
  "list_active_etf_official_sources",
]);

const taifexReads = new Set<string>([
  "get_taifex_futures_daily",
  "get_taifex_futures_positions",
  "get_taifex_institutional_general",
  "get_taifex_options_daily",
  "get_taifex_options_positions",
]);

const globalMapReads = new Set<string>([
  "get_company_industry_map",
  "get_global_industry_coverage",
  "get_supply_chain_network",
  "get_theme_industry_map",
  "get_unclassified_taiwan_companies",
  "search_global_industry_map",
]);

const analysis12Reads = new Set<string>([
  "get_taiwan_stock_analysis_12",
  "get_taiwan_stock_analysis_kpis",
  "get_taiwan_stock_analysis_template_12",
]);

type CompatInput = Record<string, unknown>;
type RpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: {
    name?: unknown;
    arguments?: unknown;
  };
};

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function symbolOf(input: CompatInput) {
  const value = String(input.symbol ?? input.stock_id ?? input.stock ?? input.code ?? "").trim();
  return /^\d{4,6}$/.test(value) ? value : "";
}

function asOfOf(input: CompatInput) {
  const value = String(input.as_of ?? input.as_of_date ?? input.date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dailyRankingsPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/daily-report-inputs/${year}/${month}/${day}/official-rankings.json`;
}

async function readExactDateOfficialRankings(env: Env, date: string) {
  const path = dailyRankingsPath(date);
  const file = await readGitHubJson<Record<string, unknown>>(env, path);
  if (!file.exists || !file.value) {
    return {
      status: "PENDING_EXACT_DATE_CAPTURE" as const,
      path,
      sha: file.sha,
      artifact: null,
      error: "exact_date_rankings_artifact_missing",
    };
  }

  const artifact = file.value;
  const rankings = artifact.rankings && typeof artifact.rankings === "object" && !Array.isArray(artifact.rankings)
    ? artifact.rankings as Record<string, unknown>
    : {};
  const groups = ["foreign_buy", "foreign_sell", "trust_buy", "trust_sell"];
  const markets = Array.isArray(artifact.markets) ? artifact.markets.map(String) : [];
  const valid = artifact.status === "READY"
    && artifact.trade_date === date
    && artifact.source_date_verified === true
    && artifact.previous_day_substitution === false
    && markets.includes("listed")
    && markets.includes("otc")
    && groups.every((key) => Array.isArray(rankings[key]) && (rankings[key] as unknown[]).length === 10);

  if (!valid) {
    return {
      status: "INVALID_EXACT_DATE_ARTIFACT" as const,
      path,
      sha: file.sha,
      artifact,
      error: "exact_date_rankings_artifact_failed_contract",
    };
  }

  return {
    status: "READY" as const,
    path,
    sha: file.sha,
    artifact,
    error: null,
  };
}

function retired(tool: string, modernCapability: string, detail: string) {
  return out({
    ok: false,
    status: "LEGACY_COMPATIBILITY_RETAINED_FAIL_CLOSED",
    facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
    legacy_tool: tool,
    modern_capability: modernCapability,
    detail,
    persistence: "NONE",
    d1_app_persistence: "FORBIDDEN",
    r2_app_persistence: "FORBIDDEN",
    production_mutation: "NONE",
  });
}

function historyLayerOf(summary: unknown, key: string) {
  const record = summary && typeof summary === "object" ? summary as Record<string, any> : {};
  const layers = record.layers && typeof record.layers === "object" ? record.layers as Record<string, any> : {};
  return layers[key] ?? null;
}

async function onDemandSummary(env: Env, symbol: string, as_of: string | undefined) {
  return getTwMarketChipSummaryOnDemand(env, { symbol, as_of, calendar_days: 60 });
}

async function resolveFullMarketInstitutional(env: Env, tradeDate: string) {
  const direct = await getTwFullMarketInstitutionalOnDemand({ as_of: tradeDate });
  if (direct.status === "READY") {
    return {
      ok: true,
      status: "READY" as const,
      role: "CURRENT_EXACT_DATE_OFFICIAL_ON_DEMAND" as const,
      current_selection_source: true,
      evidence_source: "DIRECT_TWSE_TPEX_EXACT_DATE_ON_DEMAND" as const,
      data: direct,
      direct,
      exact_date_readback: null,
      error: null,
    };
  }

  // Exact-date GitHub is a fallback/readback only. It is never consulted when
  // direct official sources are READY, so GitHub latency cannot gate today's
  // green/red report.
  const exact = await readExactDateOfficialRankings(env, tradeDate);
  if (exact.status === "READY") {
    return {
      ok: true,
      status: "READY" as const,
      role: "CURRENT_EXACT_DATE_CANONICAL_READBACK" as const,
      current_selection_source: true,
      evidence_source: "GITHUB_EXACT_DATE_READBACK_FALLBACK" as const,
      data: exact.artifact,
      direct,
      exact_date_readback: {
        status: exact.status,
        source_path: exact.path,
        source_sha: exact.sha,
      },
      error: null,
    };
  }

  return {
    ok: false,
    status: direct.status,
    role: "CURRENT_EXACT_DATE_NOT_READY" as const,
    current_selection_source: false,
    evidence_source: "DIRECT_TWSE_TPEX_EXACT_DATE_ON_DEMAND" as const,
    data: direct,
    direct,
    exact_date_readback: {
      status: exact.status,
      source_path: exact.path,
      source_sha: exact.sha,
      error: exact.error,
    },
    error: direct.error ?? exact.error,
  };
}

async function handleLegacyRead(tool: string, env: Env, input: CompatInput) {
  const symbol = symbolOf(input);
  const as_of = asOfOf(input);

  if (tool === "get_official_stock_institutional") {
    if (!symbol) return retired(tool, "get_tw_institutional_flow", "legacy call requires a 4-6 digit Taiwan stock symbol");
    const summary = await onDemandSummary(env, symbol, as_of);
    return out({
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tool: "get_tw_institutional_flow",
      preferred_current_evidence: "EXACT_DATE_OFFICIAL_ON_DEMAND",
      data: summary.on_demand_current.layers.institutional,
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: summary.legacy_archive_context?.data_as_of ?? null,
        layer: historyLayerOf(summary, "institutional"),
      },
      previous_day_substitution: false,
    });
  }

  if (tool === "get_official_stock_margin") {
    if (!symbol) return retired(tool, "get_tw_margin_short", "legacy call requires a 4-6 digit Taiwan stock symbol");
    const summary = await onDemandSummary(env, symbol, as_of);
    return out({
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tool: "get_tw_margin_short",
      preferred_current_evidence: "EXACT_DATE_OFFICIAL_ON_DEMAND",
      data: summary.on_demand_current.layers.margin_short,
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: summary.legacy_archive_context?.data_as_of ?? null,
        layer: historyLayerOf(summary, "margin"),
      },
      previous_day_substitution: false,
    });
  }

  if (tool === "get_daily_chip_report") {
    if (symbol) {
      return out({
        compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
        legacy_tool: tool,
        modern_tool: "get_tw_market_data_bundle",
        data: await onDemandSummary(env, symbol, as_of),
      });
    }

    const tradeDate = as_of ?? taipeiToday();
    const [institutional, margin] = await Promise.all([
      resolveFullMarketInstitutional(env, tradeDate),
      getTwFullMarketMarginOnDemand({ as_of: tradeDate }),
    ]);
    const institutionalReady = institutional.status === "READY";
    const marginReady = margin.status === "READY";
    return out({
      ok: institutionalReady || marginReady,
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_capability: "OFFICIAL_DAILY_INSTITUTIONAL_AND_MARGIN_EXACT_DATE_ON_DEMAND",
      // Backward compatibility: top-level readiness follows the green/red
      // institutional component. Yellow is explicitly independent below.
      status: institutional.status,
      role: institutional.role,
      trade_date: tradeDate,
      current_selection_source: institutionalReady,
      previous_day_substitution: false,
      persistence: "CURRENT_ON_DEMAND_NONE; GITHUB_EXACT_DATE_READBACK_FALLBACK_ONLY",
      all_components_ready: institutionalReady && marginReady,
      components: {
        inflow_outflow: {
          status: institutional.status,
          ready: institutionalReady,
          source: institutional.evidence_source,
          blocks_margin: false,
        },
        margin_short: {
          status: margin.status,
          ready: marginReady,
          source: "DIRECT_TWSE_TPEX_EXACT_DATE_ON_DEMAND",
          blocks_inflow_outflow: false,
        },
      },
      // Keep data as the institutional payload for frozen callers that already
      // read data.rankings.*, while exposing margin independently for yellow.
      data: institutional.data,
      institutional: institutional.data,
      margin,
      institutional_direct_status: institutional.direct.status,
      exact_date_readback: institutional.exact_date_readback,
      error: institutional.error,
    });
  }

  if (tool === "get_official_market_institutional") {
    const tradeDate = as_of ?? taipeiToday();
    const resolved = await resolveFullMarketInstitutional(env, tradeDate);
    return out({
      ok: resolved.ok,
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_capability: "OFFICIAL_DAILY_INSTITUTIONAL_RANKINGS_EXACT_DATE_ON_DEMAND",
      projection: "institutional",
      status: resolved.status,
      role: resolved.role,
      trade_date: tradeDate,
      current_selection_source: resolved.current_selection_source,
      preferred_current_evidence: "DIRECT_TWSE_TPEX_EXACT_DATE_ON_DEMAND",
      evidence_source: resolved.evidence_source,
      previous_day_substitution: false,
      persistence: "CURRENT_ON_DEMAND_NONE; GITHUB_EXACT_DATE_READBACK_FALLBACK_ONLY",
      data: resolved.data,
      direct_status: resolved.direct.status,
      direct_source_health: resolved.direct.source_health,
      exact_date_readback: resolved.exact_date_readback,
      error: resolved.error,
    });
  }

  if (tool === "get_official_market_margin") {
    const tradeDate = as_of ?? taipeiToday();
    const data = await getTwFullMarketMarginOnDemand({ as_of: tradeDate });
    return out({
      ok: data.status === "READY",
      compatibility: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_capability: "OFFICIAL_FULL_MARKET_MARGIN_EXACT_DATE_ON_DEMAND",
      projection: "margin",
      status: data.status,
      role: data.role,
      trade_date: tradeDate,
      current_selection_source: data.status === "READY",
      preferred_current_evidence: "DIRECT_TWSE_TPEX_EXACT_DATE_ON_DEMAND",
      previous_day_substitution: false,
      persistence: "NONE",
      note: data.status === "READY"
        ? "TWSE＋TPEx 全市場融資融券已以指定日官方資料直接讀取；GitHub 歷史 archive 不再是當期 Gate。"
        : "指定日其中一個官方來源尚未 READY 或讀取失敗；維持 fail-closed，不以舊交易日補值。",
      data,
    });
  }

  if (analysis12Reads.has(tool)) {
    if (!symbol) {
      return out({
        ok: true,
        status: "LEGACY_TEMPLATE_COMPATIBILITY",
        facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
        legacy_tool: tool,
        modern_tools: ["get_stock_market_context", "get_tw_market_chip_summary", "get_monthly_revenue", "get_valuation", "get_stock_news"],
        note: "舊12項 facade 保留；現代資料由既有固定工具內部組合，不新增 ChatGPT 公開工具。",
      });
    }
    const [marketContext, chip] = await Promise.all([
      readFamilyStockMarketContext(env, { symbol, books: true, wait_ms: 0 }),
      onDemandSummary(env, symbol, as_of),
    ]);
    return out({
      ok: true,
      status: "LEGACY_12_ANALYSIS_COMPATIBILITY",
      facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      symbol,
      market_context: marketContext,
      chip,
      enrichment_contract: {
        existing_public_tools: ["get_monthly_revenue", "get_valuation", "get_stock_news", "get_material_events", "get_derivatives_sentiment"],
        rule: "existing tool -> internal provider/capability enrichment",
      },
    });
  }

  if (globalMapReads.has(tool)) {
    return out({
      ok: true,
      status: "LEGACY_GLOBAL_MAP_COMPATIBILITY",
      facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
      legacy_tool: tool,
      modern_tools: ["get_supply_chain_contract", "query_supply_chain_graph", "query_archived_supply_chain"],
      contract: getSupplyChainContract(),
      note: "舊D1 global-map資料層不復活；供應鏈/產業圖改由現代 deterministic snapshot + evidence graph 承接。",
      persistence: "NONE",
    });
  }

  if (etfReads.has(tool)) {
    return retired(tool, "current read-only market/research plane", "舊Active ETF獨立資料面已退役；保留舊呼叫名稱但不重啟舊D1/舊來源寫入。");
  }

  if (taifexReads.has(tool)) {
    return retired(tool, "get_txf_review_contract/get_txf_signal/build_stock_txf_context", "舊TAIFEX raw facade已由目前TXF deterministic research plane取代；不以舊來源冒充現代正式資料。");
  }

  return retired(tool, "modern Diamond runtime", "legacy compatibility surface retained without unsafe historical persistence");
}

function rpcResponse(id: unknown, result: unknown, request: Request) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  const session = request.headers.get("mcp-session-id");
  if (session) headers.set("mcp-session-id", session);
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), { status: 200, headers });
}

/**
 * Intercept only authenticated Owner tools/call requests for the 39 names that
 * disappeared from the modern server inventory. tools/list is intentionally
 * untouched, so no new public schema is added and the 123 modern inventory
 * remains stable. The access broker calls this only after Owner authorization.
 */
export async function tryHandleDiamondFixedFacadeCompatCall(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return null;

  let body: RpcRequest;
  try {
    const parsed = await request.clone().json();
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;
    body = parsed as RpcRequest;
  } catch {
    return null;
  }

  if (body.method !== "tools/call") return null;
  const tool = String(body.params?.name ?? "");
  if (!compatNames.has(tool)) return null;
  const args = body.params?.arguments && typeof body.params.arguments === "object" && !Array.isArray(body.params.arguments)
    ? body.params.arguments as CompatInput
    : {};

  try {
    const result = retiredWrites.has(tool)
      ? retired(tool, "modern deterministic/GitHub-only capability", "此舊名稱原本具有D1/管理型寫入語義；現在永久fail-closed，不允許為相容而恢復舊app persistence。")
      : await handleLegacyRead(tool, env, args);
    return rpcResponse(body.id, result, request);
  } catch (error) {
    return rpcResponse(body.id, {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          status: "LEGACY_COMPATIBILITY_RUNTIME_ERROR",
          facade_version: DIAMOND_CHATGPT_FIXED_FACADE_VERSION,
          legacy_tool: tool,
          error: error instanceof Error ? error.message : String(error),
          production_mutation: "NONE",
        }, null, 2),
      }],
    }, request);
  }
}
