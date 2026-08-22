import { finmind } from "./common";
import { runFamilyActionCompatQuery } from "./family-action-compat";
import { planFamilyQuery } from "./family-adaptive-planner";
import { buildFamilyElevenPointAnalysis } from "./family-eleven-point";
import {
  fetchFamilyOfficialValuation,
  summarizeFamilyAccounting,
  summarizeFamilyRevenue,
} from "./family-fundamental-summary";
import { familyResearchDirective } from "./family-research-policy";

type SmartFamilyInput = {
  symbols: string[];
  as_of_date?: string;
  question?: string;
};

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function safeFinmind(env: Env, dataset: string, params: Record<string, unknown>) {
  try {
    return { ok: true as const, data: await finmind(env, dataset, params), error: null };
  } catch (error) {
    return { ok: false as const, data: [] as any[], error: `${dataset}:${error instanceof Error ? error.message : String(error)}` };
  }
}

function openWorldElevenPoint(raw: any, symbol: string) {
  const directive = familyResearchDirective([symbol]);
  const points = Array.isArray(raw?.points) ? raw.points.map((item: any) => {
    const { web_research, ...rest } = item ?? {};
    return {
      ...rest,
      research: {
        mode: "OPEN_WORLD_AUTONOMOUS",
        seed_queries: Array.isArray(web_research) ? web_research : [],
        seeds_are_non_binding: true,
        may_rewrite_queries: true,
        may_search_other_sites: true,
        may_follow_new_entities_and_events: true,
        instruction: "seed_queries只是可能的起點；可完全改寫、忽略或擴展，不得視為網站或關鍵字限制。",
      },
    };
  }) : [];
  return {
    ...raw,
    points,
    web_research_plan: undefined,
    open_world_research: directive,
    final_answer_policy: [
      ...(Array.isArray(raw?.final_answer_policy) ? raw.final_answer_policy : []),
      "Web研究採open-world：可依新發現自主擴展搜尋，不限seed queries、網站、語言或預先定義主題。",
      "即時異動可用Fugle與Web事件共同解釋；正式OHLC與Published籌碼的資料身份不可被取代。",
      "11點是完整個股研究的完整性契約，不是所有問題都必須逐點輸出；簡單問題應先直接回答真正問題。",
    ],
  };
}

export async function runSmartFamilyAnalysis(env: Env, input: SmartFamilyInput) {
  const symbols = [...new Set(input.symbols.map((symbol) => String(symbol).trim()).filter(Boolean))].slice(0, 5);
  if (!symbols.length) throw new Error("at least one symbol is required");

  const userQuestion = String(input.question ?? "").trim();
  const plannerQuestion = userQuestion || (symbols.length > 1 ? `比較 ${symbols.join(" ")}` : `${symbols[0]} 完整分析`);
  const adaptivePlan = planFamilyQuery(plannerQuestion, symbols);

  const base = await runFamilyActionCompatQuery(env, {
    query: userQuestion || symbols.join(" "),
    mode: "auto",
    as_of_date: input.as_of_date,
  });

  const asOf = base.as_of_date;
  const [allInfo, industryChain] = await Promise.all([
    safeFinmind(env, "TaiwanStockInfo", {}),
    safeFinmind(env, "TaiwanStockIndustryChain", {}),
  ]);
  const globalErrors = [allInfo.error, industryChain.error].filter((value): value is string => Boolean(value));

  const enriched = await Promise.all(base.stock_analyses.map(async (analysis: any) => {
    const symbol = String(analysis.symbol);
    const fundamentals = analysis?.fundamentals ?? {};
    const [valuation, holdingDistribution, foreignShareholding] = await Promise.all([
      fetchFamilyOfficialValuation(symbol),
      safeFinmind(env, "TaiwanStockHoldingSharesPer", {
        data_id: symbol,
        start_date: subtractDays(asOf, 180),
        end_date: asOf,
      }),
      safeFinmind(env, "TaiwanStockShareholding", {
        data_id: symbol,
        start_date: subtractDays(asOf, 180),
        end_date: asOf,
      }),
    ]);
    const monthlyRevenue = summarizeFamilyRevenue(Array.isArray(fundamentals.monthly_revenue) ? fundamentals.monthly_revenue : []);
    const accounting = summarizeFamilyAccounting(
      Array.isArray(fundamentals.income_statement_rows) ? fundamentals.income_statement_rows : [],
      Array.isArray(fundamentals.balance_sheet_rows) ? fundamentals.balance_sheet_rows : [],
      Array.isArray(fundamentals.cashflow_rows) ? fundamentals.cashflow_rows : [],
    );

    const familyIntelligence = {
      contract: "SHARED_READ_ONLY_JUDGMENT_INPUTS",
      monthly_revenue: monthlyRevenue,
      accounting,
      official_valuation: valuation,
      realtime_context: {
        source: analysis?.market_snapshot?.source ?? "UNAVAILABLE",
        quote: analysis?.market_snapshot?.quote ?? null,
        latest_daily_bar_research_fallback: analysis?.market_snapshot?.latest_daily_bar ?? null,
        intraday_policy: "FUGLE_PRIMARY_WHEN_AVAILABLE",
        formal_structure_policy: "OHLC_MCP_ONLY",
      },
      interpretation_guardrails: [
        "好公司不等於現在就是好買點；基本面與技術位置分開判斷。",
        "正式籌碼只採 Published generation；缺資料不可自行補值。",
        "正式 OHLC/K線仍由 OHLC MCP 負責；Fugle/FinMind價格可作即時與研究輔助，但不得冒充正式技術價位。",
        "Web 是開放研究層，可自主延伸任何有價值的新線索，不限固定網站或關鍵字。",
        "Family 與 Owner 共用市場/研究讀取能力；差異只在 Family 永遠沒有寫入權限。",
        "估值缺值代表官方來源未提供可計算值，不得把 null 解讀為 0。",
        "roe_period_estimate_percent 不是年化 ROE，僅為期間淨利/期末權益的輔助估算。",
      ],
    };

    const enrichmentErrors = [
      ...globalErrors,
      holdingDistribution.error,
      foreignShareholding.error,
    ].filter((value): value is string => Boolean(value));

    const elevenPointRaw = buildFamilyElevenPointAnalysis({
      symbol,
      as_of_date: asOf,
      analysis,
      intelligence: familyIntelligence,
      holding_distribution_rows: holdingDistribution.data,
      foreign_shareholding_rows: foreignShareholding.data,
      industry_chain_rows: industryChain.data,
      all_stock_info_rows: allInfo.data,
      enrichment_errors: enrichmentErrors,
    });
    const elevenPoint = openWorldElevenPoint(elevenPointRaw, symbol);

    return {
      ...analysis,
      family_intelligence: familyIntelligence,
      eleven_point_analysis: elevenPoint,
      open_world_research: familyResearchDirective([symbol]),
      decision_readiness: {
        realtime: Boolean(analysis?.market_snapshot?.quote?.close),
        technical_research_fallback: analysis?.technical?.status === "READY",
        formal_ohlc: false,
        published_chip: Boolean(analysis?.data_quality?.published_chip),
        monthly_revenue: monthlyRevenue.status === "READY",
        accounting: accounting.status === "READY",
        official_valuation: valuation.status === "READY",
        holder_distribution: holdingDistribution.ok && holdingDistribution.data.length > 0,
        foreign_shareholding: foreignShareholding.ok && foreignShareholding.data.length > 0,
        industry_chain: industryChain.ok && industryChain.data.length > 0,
        eleven_point_contract: elevenPoint.coverage?.point_count === 11,
      },
      enrichment_diagnostics: {
        errors: enrichmentErrors,
        fail_soft: true,
      },
    };
  }));

  return {
    ...base,
    version: "family-smart-analysis/v3.0.0",
    route: symbols.length > 1 ? "adaptive_stock_compare" : adaptivePlan.intent === "FULL_STOCK_ANALYSIS" ? "adaptive_full_stock_analysis" : "adaptive_stock_question",
    question: userQuestion || null,
    adaptive_plan: adaptivePlan,
    stock_analyses: enriched,
    open_world_research: familyResearchDirective(symbols),
    family_policy: {
      read_only: true,
      same_research_brain_as_owner: true,
      owner_market_research_reads_shared_by_default: true,
      owner_private_context_shared_by_default: false,
      production_writes: false,
      github_writes: false,
      strategy_changes: false,
      formal_chip: "PUBLISHED_GENERATION_ONLY",
      formal_ohlc: "OHLC_MCP_ONLY",
      realtime_display: "FUGLE_PRIMARY_WITH_RESEARCH_FALLBACKS",
      web_research: "OPEN_WORLD_AUTONOMOUS_ALLOWED",
    },
    response_contract: {
      answer_style: "ADAPTIVE_TO_USER_INTENT",
      single_stock: "QUICK_QUESTION_CAN_BE_CONCISE; FULL_ANALYSIS_USES_FIXED_1_TO_11_COMPLETENESS_CONTRACT",
      compare: "COMPARE_USING_THE_SAME_1_TO_11_EVIDENCE_MODEL_WITHOUT_FORCING_11_VISIBLE_SECTIONS",
      missing_data: "EXPLICIT_NULL_OR_UNKNOWN_NEVER_GUESS",
      web: "OPEN_WORLD_AUTONOMOUS_RESEARCH_NOT_FIXED_KEYWORDS_OR_SITES",
      realtime: "FUGLE_AND_MARKET_SOURCES_ALLOWED_BUT_NOT_FORMAL_OHLC",
      evidence_labels: ["FACT", "INFERENCE", "JUDGMENT", "CONFLICT", "UNKNOWN"],
    },
  };
}
