import { runFamilyActionCompatQuery } from "./family-action-compat";
import {
  fetchFamilyOfficialValuation,
  summarizeFamilyAccounting,
  summarizeFamilyRevenue,
} from "./family-fundamental-summary";

type SmartFamilyInput = {
  symbols: string[];
  as_of_date?: string;
};

export async function runSmartFamilyAnalysis(env: Env, input: SmartFamilyInput) {
  const symbols = [...new Set(input.symbols.map((symbol) => String(symbol).trim()).filter(Boolean))].slice(0, 5);
  if (!symbols.length) throw new Error("at least one symbol is required");

  const base = await runFamilyActionCompatQuery(env, {
    query: symbols.join(" "),
    mode: "auto",
    as_of_date: input.as_of_date,
  });

  const enriched = await Promise.all(base.stock_analyses.map(async (analysis: any) => {
    const fundamentals = analysis?.fundamentals ?? {};
    const [valuation] = await Promise.all([
      fetchFamilyOfficialValuation(String(analysis.symbol)),
    ]);
    const monthlyRevenue = summarizeFamilyRevenue(Array.isArray(fundamentals.monthly_revenue) ? fundamentals.monthly_revenue : []);
    const accounting = summarizeFamilyAccounting(
      Array.isArray(fundamentals.income_statement_rows) ? fundamentals.income_statement_rows : [],
      Array.isArray(fundamentals.balance_sheet_rows) ? fundamentals.balance_sheet_rows : [],
      Array.isArray(fundamentals.cashflow_rows) ? fundamentals.cashflow_rows : [],
    );

    return {
      ...analysis,
      family_intelligence: {
        contract: "NORMALIZED_READ_ONLY_JUDGMENT_INPUTS",
        monthly_revenue: monthlyRevenue,
        accounting,
        official_valuation: valuation,
        interpretation_guardrails: [
          "好公司不等於現在就是好買點；基本面與技術位置分開判斷。",
          "正式籌碼只採 Published generation；缺資料不可自行補值。",
          "正式 OHLC/K線仍由 OHLC MCP 負責；此處價格只作家用顯示與輔助判斷。",
          "估值缺值代表官方來源未提供可計算值，不得把 null 解讀為 0。",
          "roe_period_estimate_percent 不是年化 ROE，僅為期間淨利/期末權益的輔助估算。",
        ],
      },
      decision_readiness: {
        technical: analysis?.technical?.status === "READY",
        published_chip: Boolean(analysis?.data_quality?.published_chip),
        monthly_revenue: monthlyRevenue.status === "READY",
        accounting: accounting.status === "READY",
        official_valuation: valuation.status === "READY",
      },
    };
  }));

  return {
    ...base,
    version: "family-smart-analysis/v1.0.0",
    route: symbols.length > 1 ? "smart_stock_compare" : "smart_stock_analysis",
    stock_analyses: enriched,
    family_policy: {
      read_only: true,
      production_writes: false,
      github_writes: false,
      strategy_changes: false,
      formal_chip: "PUBLISHED_GENERATION_ONLY",
      formal_ohlc: "OHLC_MCP_ONLY",
    },
  };
}
