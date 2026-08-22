import { familySharedReadManifest } from "./family-shared-read-plane";

export const FAMILY_ADAPTIVE_PLANNER_VERSION = "family-adaptive-planner/v1.0.1";

export type FamilyIntent =
  | "QUICK_STOCK_QUESTION"
  | "FULL_STOCK_ANALYSIS"
  | "STOCK_COMPARE"
  | "SWING_DISCOVERY"
  | "MARKET_CONTEXT"
  | "OPEN_RESEARCH";

export type FamilyAnswerDepth = "QUICK" | "STANDARD" | "DEEP";

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function includesAny(query: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(query));
}

export function extractFamilyQuerySymbols(query: string) {
  return unique(String(query ?? "").match(/(?<!\d)\d{4,6}(?!\d)/g) ?? []).slice(0, 5);
}

export function inferFamilyAdaptiveIntent(query: string, symbols: string[]): FamilyIntent {
  const text = String(query ?? "").trim();

  if (symbols.length >= 2) return "STOCK_COMPARE";

  if (includesAny(text, [
    /波段|選股|選標的|找股票|找標的|候選|排名|哪幾檔|有什麼.*股票|值得注意的.*股票/i,
  ])) return "SWING_DISCOVERY";

  if (symbols.length === 1 && includesAny(text, [
    /完整|全面|深入|詳細|11\s*點|基本面.*技術|財務.*籌碼|估值.*技術|值不值得.*中長期/i,
  ])) return "FULL_STOCK_ANALYSIS";

  if (symbols.length === 1) return "QUICK_STOCK_QUESTION";

  if (includesAny(text, [
    /大盤|台股|加權|櫃買|市場|盤勢|今天.*跌|今天.*漲|為什麼.*跌|為什麼.*漲|外資.*大盤/i,
  ])) return "MARKET_CONTEXT";

  return "OPEN_RESEARCH";
}

function answerDepth(intent: FamilyIntent, query: string): FamilyAnswerDepth {
  if (intent === "FULL_STOCK_ANALYSIS" || intent === "STOCK_COMPARE") return "DEEP";
  if (intent === "SWING_DISCOVERY") return "STANDARD";
  if (/深入|詳細|完整|全面|徹底|研究/i.test(query)) return "DEEP";
  if (/簡單|快速|一句|先看|現在|能不能/i.test(query)) return "QUICK";
  return "STANDARD";
}

function preferredReads(intent: FamilyIntent) {
  switch (intent) {
    case "QUICK_STOCK_QUESTION":
      return ["realtime_market", "canonical_ohlc", "published_chip", "fundamentals", "open_world_web"];
    case "FULL_STOCK_ANALYSIS":
      return ["realtime_market", "canonical_ohlc", "published_chip", "fundamentals", "industry_supply_chain", "research_repository", "global_market_context", "open_world_web"];
    case "STOCK_COMPARE":
      return ["realtime_market", "canonical_ohlc", "published_chip", "fundamentals", "industry_supply_chain", "open_world_web"];
    case "SWING_DISCOVERY":
      return ["realtime_market", "canonical_ohlc", "published_chip", "fundamentals", "industry_supply_chain", "open_world_web"];
    case "MARKET_CONTEXT":
      return ["realtime_market", "published_chip", "global_market_context", "research_repository", "open_world_web"];
    case "OPEN_RESEARCH":
      return ["fundamentals", "industry_supply_chain", "research_repository", "global_market_context", "open_world_web"];
  }
}

export function planFamilyQuery(query: string, symbols: string[] = []) {
  const normalizedSymbols = unique(symbols.map((symbol) => String(symbol).trim()).filter(Boolean)).slice(0, 5);
  const normalizedQuery = String(query ?? "").trim();
  const intent = inferFamilyAdaptiveIntent(normalizedQuery, normalizedSymbols);
  const depth = answerDepth(intent, normalizedQuery);

  return {
    version: FAMILY_ADAPTIVE_PLANNER_VERSION,
    intent,
    answer_depth: depth,
    subjects: normalizedSymbols,
    planner_role: "NON_BINDING_RESEARCH_PLAN",
    model_override_allowed: true,
    fixed_workflow: false,
    preferred_reads: preferredReads(intent),
    shared_read_plane: familySharedReadManifest(),
    execution_guidance: {
      quick_question: "先回答使用者真正問的事；只取足以支撐答案的證據，不因為有11點框架就強迫逐點念完。",
      full_analysis: "需要完整個股研究時，以1到11點作最終完整性契約，但查詢順序與來源可動態決定。",
      progressive_deepening: "先做高價值核心讀取；若發現重大催化劑、資料衝突、未知欄位或新線索，再自主擴展研究。",
      conflict_resolution: "重大事實衝突不得直接選邊；優先官方/canonical，再找第二高權威來源，最後標 FACT/INFERENCE/JUDGMENT/CONFLICT/UNKNOWN。",
      web: "Open Web 永遠可用，不是 fallback-only；seed query 只是起點，可改寫、跨語言、跨網站與追新實體。",
      identity: "Web、Fugle、FinMind 與研究資料不得冒充正式 OHLC 或 Published 籌碼。",
    },
    answer_contract: {
      render_for_intent_not_template: true,
      eleven_point_required_when: ["FULL_STOCK_ANALYSIS"],
      compare_uses_common_evidence_model: true,
      quick_question_may_answer_without_all_eleven_sections: true,
      unknown_never_guessed: true,
    },
    stop_policy: {
      no_fixed_query_count: true,
      stop_when: [
        "核心問題已有足夠高權威證據",
        "重大衝突已解決或已明確標成 CONFLICT",
        "繼續搜尋只會重複相同資訊",
      ],
      continue_when: [
        "核心結論仍依賴單一低權威來源",
        "重大數字互相矛盾",
        "新發現可能改變投資結論的客戶/訂單/產能/政策/風險線索",
      ],
    },
  } as const;
}
