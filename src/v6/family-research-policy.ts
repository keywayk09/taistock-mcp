export const FAMILY_RESEARCH_POLICY_VERSION = "family-research-policy/v1.0.0";

export const FAMILY_RESEARCH_POLICY = {
  mode: "OPEN_WORLD_AUTONOMOUS_RESEARCH",
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
    formal_chip: "PUBLISHED_GENERATION_ONLY",
    financials: ["FINMIND_STRUCTURED_READ_ONLY", "TWSE_TPEX_OFFICIAL_VALUATION"],
    web_context: "OPEN_WORLD",
    rule: "盤中價格/成交狀態可用 Fugle 等即時來源；正式型態與技術價位仍由 OHLC MCP；正式籌碼仍由 Published generation。Web 可解釋盤中異動與事件，但不能覆寫正式數字。",
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
    quick_pass: ["realtime", "revenue_financials", "published_chip", "major_current_events"],
    deep_pass_when_needed: ["customers", "supply_chain", "capacity", "competitors", "industry_cycle", "valuation", "catalysts", "risks", "foreign_sources"],
    rule: "簡單問題先快速完成核心資料；若使用者要求波段/完整分析，或資料出現矛盾/重大催化劑，再自動深化，不要求使用者逐項下指令。",
  },
  discovery_vs_ranking: {
    web_discovery_allowed: true,
    engine_discovery_allowed: true,
    web_candidate_label: "WEB_RESEARCH_CANDIDATE",
    engine_candidate_label: "ENGINE_CANDIDATE",
    official_rank_requires_engine_validation: true,
    rule: "Web 可以主動發現標的；但未經引擎資料驗證時只能稱研究候選，不能冒充全市場引擎排名。",
  },
  hard_boundaries: [
    "Web 不得冒充正式 OHLC/K線、支撐壓力或停損來源。",
    "Web 不得冒充 Published generation 的法人/融資融券/借券正式籌碼數字。",
    "財報/估值數字衝突時優先官方或結構化來源並標示差異。",
    "未知就是 UNKNOWN/null；不為了湊完整答案而創造數字。",
  ],
} as const;

export function familyResearchDirective(symbols: string[]) {
  return {
    version: FAMILY_RESEARCH_POLICY_VERSION,
    ...FAMILY_RESEARCH_POLICY,
    subjects: symbols,
    instruction: "把結構化資料當可信錨點，同時自由使用 Web 擴展研究。不要停在預設搜尋字串；每當發現新的公司、客戶、供應鏈節點、政策、產品或風險，應判斷是否值得繼續追查。",
  };
}
