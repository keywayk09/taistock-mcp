import { familySharedReadManifest } from "./family-shared-read-plane.ts";

export const FAMILY_RESEARCH_POLICY_VERSION = "family-research-policy/v2.1.0";

export const FAMILY_RESEARCH_POLICY = {
  mode: "OPEN_WORLD_AUTONOMOUS_RESEARCH",
  intelligence_model: "SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS",
  web_research: {
    allowed: true,
    fixed_site_allowlist: false,
    fixed_keyword_limit: false,
    autonomous_query_expansion: true,
    follow_new_entities: true,
    follow_new_events: true,
    follow_supply_chain_links: true,
    follow_competitors_and_customers: true,
    follow_foreign_sources_when_useful: true,
    rule: "Web 搜尋不是 fallback-only；它是持續可用的研究層。模型可依新發現自主改寫查詢、擴展網站、追客戶/供應商/同業/海外新聞/法說/政策，不受預設關鍵字限制。",
  },
  realtime_fusion: {
    intraday_primary: ["FUGLE_QUOTE", "FUGLE_MARKET_SNAPSHOT"],
    market_official_context: ["TWSE", "TPEX"],
    formal_structure: "OHLC_MCP_ONLY",
    formal_chip: "OFFICIAL_EXACT_DATE_ON_DEMAND_CURRENT+PUBLISHED_HISTORY_CONTEXT",
    broker_branch: "MONEYDJ_RANKED_ONLY_FAIL_SOFT",
    warrant_activity: "OFFICIAL_NON_DIRECTIONAL_ACTIVITY_ONLY",
    financials: ["FINMIND_STRUCTURED_READ_ONLY", "TWSE_TPEX_OFFICIAL_VALUATION"],
    web_context: "OPEN_WORLD",
    rule: "盤中價格/成交狀態可用 Fugle 等即時來源；正式型態與技術價位仍由 OHLC MCP；當期法人/融資融券/借券優先TWSE/TPEx exact-date on-demand，Published只作歷史背景。MoneyDJ分點與權證活動不可升級成官方方向性真相。",
  },
  evidence_authority: [
    "CANONICAL_OR_OFFICIAL_MARKET_DATA",
    "COMPANY_FILING_EARNINGS_CALL_ANNUAL_REPORT",
    "VERIFIED_STRUCTURED_DATA_PROVIDER",
    "REPUTABLE_BROKER_OR_MAJOR_MEDIA_PUBLIC_RESEARCH",
    "GENERAL_WEB",
    "SOCIAL_COMMUNITY_UNVERIFIED",
  ],
  conflict_resolution: {
    detect_conflicts: true,
    second_source_required_for_material_conflict: true,
    never_silently_average_conflicting_facts: true,
    output_labels: ["FACT", "INFERENCE", "JUDGMENT", "CONFLICT", "UNKNOWN"],
  },
  progressive_deepening: {
    enabled: true,
    fixed_workflow: false,
    model_may_choose_sources_and_order: true,
    quick_pass: ["realtime", "revenue_financials", "current_chip", "published_chip_history", "major_current_events"],
    deep_pass_when_needed: ["broker_branch", "warrant_activity", "customers", "supply_chain", "capacity", "competitors", "industry_cycle", "valuation", "catalysts", "risks", "foreign_sources"],
    rule: "簡單問題先回答真正問題，不強迫輸出固定模板；完整個股研究再用11點作最終完整性契約。若資料矛盾、重大催化劑或新線索可能改變結論，模型自行深化，不要求使用者逐項下指令。",
  },
  discovery_vs_ranking: {
    web_discovery_allowed: true,
    engine_discovery_allowed: true,
    web_candidate_label: "WEB_RESEARCH_CANDIDATE",
    engine_candidate_label: "ENGINE_CANDIDATE",
    official_rank_requires_engine_validation: true,
    rule: "Web 可以主動發現標的；但未經引擎資料驗證時只能稱研究候選，不能冒充全市場引擎排名。",
  },
  family_permission_model: {
    owner_market_research_reads: "SHARED_BY_DEFAULT_WHEN_AVAILABLE",
    family_market_research_reads: "ALLOW",
    all_mutations: "DENY",
    owner_private_context: "DENY_BY_DEFAULT_UNLESS_EXPLICITLY_SHARED",
    rule: "Family 與 Owner 共用市場/研究讀取能力，不做智力或資料面的縮水；差異只在權限。任何 GitHub/Production/策略/OHLC canonical/Diamond Judgment 寫入都禁止。",
  },
  hard_boundaries: [
    "Web 不得冒充正式 OHLC/K線、支撐壓力或停損來源。",
    "Web/FinMind 不得冒充TWSE/TPEx exact-date當期官方法人/融資融券/借券數字。",
    "Published generation是歷史/replay context，不得在當期官方資料已可得時覆蓋它。",
    "MoneyDJ分點只屬RANKED_ONLY；未出現在排名中不得解讀為零交易，且分點不依賴FinMind token。",
    "權證turnover不得直接解讀為買超/賣超或dealer hedge方向。",
    "財報/估值數字衝突時優先官方或結構化來源並標示差異。",
    "未知就是 UNKNOWN/null；不為了湊完整答案而創造數字。",
    "Owner 私人 Gmail、Calendar、Contacts、Secrets 與未明確共享的私人檔案不自動進入 Family shared plane。",
  ],
} as const;

export function familyResearchDirective(symbols: string[]) {
  return {
    version: FAMILY_RESEARCH_POLICY_VERSION,
    ...FAMILY_RESEARCH_POLICY,
    subjects: symbols,
    shared_read_plane: familySharedReadManifest(),
    instruction: "把 canonical/official exact-date 資料當可信錨點，同時自由使用 Web 與 Owner 已共享的市場研究讀取能力。當期籌碼與Published歷史身份分開；MoneyDJ分點與權證活動維持Governed Context。不要停在預設搜尋字串；每當發現新的公司、客戶、供應鏈節點、政策、產品或風險，應判斷是否值得繼續追查。回答方式依使用者意圖調整，不因為存在11點框架就機械式逐點輸出。",
  };
}
