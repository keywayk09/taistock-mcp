export const FAMILY_SHARED_READ_PLANE_VERSION = "family-shared-read-plane/v1.5.0";

export type FamilySharedReadCapability = {
  id: string;
  label: string;
  sources: readonly string[];
  identity: string;
  access: "READ_ONLY";
  family_share: "SHARED_BY_DEFAULT" | "SHARED_WHEN_AVAILABLE";
  notes: string;
};

export const FAMILY_SHARED_READ_CAPABILITIES = [
  {
    id: "realtime_market",
    label: "即時市場、五檔與盤中狀態",
    sources: ["FUGLE_REST_QUOTE", "FUGLE_REST_TRADES", "TWSE", "TPEX"],
    identity: "EPHEMERAL_REALTIME_OR_OFFICIAL_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "taistock-mcp直接唯讀Fugle quote+trades取得最新成交、五檔、最近逐筆與短窗主動買賣；不持久化，正式OHLC身份仍只由既有canonical決定。",
  },
  {
    id: "canonical_ohlc",
    label: "正式 OHLC / 技術結構",
    sources: ["OHLC_MCP_GITHUB_CANONICAL_READ", "TV_PAPERTRADER_CANONICAL"],
    identity: "FORMAL_CANONICAL_OHLC",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "Family直接唯讀tv-papertrader既有OHLC canonical CSV並綁定GitHub path/SHA；不得把Fugle即時、FinMind或Web價格冒充正式OHLC。",
  },
  {
    id: "current_chip",
    label: "當期正式籌碼與分點研究",
    sources: [
      "OFFICIAL_EXACT_DATE_ON_DEMAND",
      "TWSE_TPEX_OFFICIAL_CHIP",
      "MONEYDJ_BROKER_RANKED_PUBLIC_SECONDARY",
      "TWSE_TPEX_WARRANT_ACTIVITY_NON_DIRECTIONAL",
    ],
    identity: "CURRENT_OFFICIAL_CHIP_PLUS_GOVERNED_SECONDARY",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "法人、融資融券、借券與借券賣出以TWSE/TPEx exact-date on-demand為當期正式證據；MoneyDJ分點僅RANKED_ONLY輔助，缺席不代表零交易；權證成交只代表活動度、不代表買超。",
  },
  {
    id: "published_chip",
    label: "歷史籌碼 Published archive",
    sources: ["PUBLISHED_GENERATION"],
    identity: "FORMAL_PUBLISHED_CHIP_HISTORY",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "既有Published generation保留做不可變歷史/replay context；不再作當期Family/Owner唯一資料來源。",
  },
  {
    id: "fundamentals",
    label: "財報、營收與估值",
    sources: ["FINMIND_STRUCTURED_READ_ONLY", "TWSE_TPEX_OFFICIAL_VALUATION", "COMPANY_FILINGS"],
    identity: "STRUCTURED_AND_OFFICIAL_FUNDAMENTALS",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "缺資料維持 UNKNOWN/null；重大數字衝突需追官方或第二來源。",
  },
  {
    id: "jin10_events",
    label: "金十即時快訊與新聞事件",
    sources: ["JIN10_MCP_EVENTS_READ_ONLY"],
    identity: "READ_ONLY_EVENT_RESEARCH_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_WHEN_AVAILABLE",
    notes: "透過taistock-mcp內部Jin10 MCP provider唯讀取得快訊/新聞；不持久化、不提供獨立Family tool，且不得升格為正式OHLC、當期官方籌碼或公司官方重大訊息。",
  },
  {
    id: "industry_supply_chain",
    label: "產業、同業與供應鏈研究",
    sources: ["STRUCTURED_RESEARCH_DATA", "COMPANY_FILINGS", "OPEN_WORLD_WEB"],
    identity: "RESEARCH_EVIDENCE",
    access: "READ_ONLY",
    family_share: "SHARED_WHEN_AVAILABLE",
    notes: "可追客戶、供應商、競爭者、產能、海外布局與政策；不可把推論當事實。",
  },
  {
    id: "research_repository",
    label: "Owner 已建立的市場研究資料",
    sources: ["GITHUB_PUBLIC_OR_SHARED_RESEARCH_READ", "VERIFIED_RESEARCH_OUTPUTS"],
    identity: "OWNER_SHARED_MARKET_RESEARCH",
    access: "READ_ONLY",
    family_share: "SHARED_WHEN_AVAILABLE",
    notes: "市場/策略研究成果可共享讀取；任何 GitHub write、PR、branch 或策略修改都不共享。",
  },
  {
    id: "txf_context",
    label: "台指期 Market Regime Context",
    sources: ["OHLC_MCP_TXF_READ"],
    identity: "GOVERNED_TXF_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_WHEN_AVAILABLE",
    notes: "跨Cloudflare帳號RPC不可用時維持UNAVAILABLE/fail-closed；TXF只作市場背景，不得猜值或用股票即時來源替代。",
  },
  {
    id: "global_futures_context",
    label: "已驗證全球期貨 Market Regime Context",
    sources: ["OHLC_MCP_GLOBAL_FUTURES_READ", "GLOBAL_FUTURES_VERIFIED_CANONICAL"],
    identity: "VERIFIED_GLOBAL_FUTURES_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_WHEN_AVAILABLE",
    notes: "跨帳號read adapter未提供時維持UNAVAILABLE；不得把PENDING或其他來源包裝成正式Global Futures資料。",
  },
  {
    id: "global_market_context",
    label: "全球市場研究背景",
    sources: ["GLOBAL_OHLC_READ", "OPEN_WORLD_WEB"],
    identity: "VERIFIED_OR_RESEARCH_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_WHEN_AVAILABLE",
    notes: "全球市場可作跨市場背景；不得覆寫台股正式資料身份。",
  },
  {
    id: "open_world_web",
    label: "Open-World Web Research",
    sources: ["OPEN_WORLD_WEB"],
    identity: "RESEARCH_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "不限固定網站、語言或關鍵字；可自行追新線索並交叉驗證。",
  },
] as const satisfies readonly FamilySharedReadCapability[];

export const FAMILY_HARD_DENY_CAPABILITIES = [
  "PRODUCTION_WRITE",
  "GITHUB_WRITE",
  "GITHUB_BRANCH_OR_PR_MUTATION",
  "STRATEGY_OR_PINE_MODIFICATION",
  "OHLC_CANONICAL_WRITE",
  "PUBLISHED_MARKET_DATA_WRITE",
  "DIAMOND_JUDGMENT_WRITE",
  "ORDER_PLACEMENT",
  "SECRET_OR_TOKEN_READ",
  "OWNER_PRIVATE_EMAIL",
  "OWNER_PRIVATE_CALENDAR",
  "OWNER_PRIVATE_CONTACTS",
  "OWNER_PRIVATE_FILES_NOT_EXPLICITLY_SHARED",
] as const;

export function familySharedReadManifest() {
  return {
    version: FAMILY_SHARED_READ_PLANE_VERSION,
    principle: "SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS",
    owner_to_family_policy: "OWNER_MARKET_RESEARCH_READ_CAPABILITIES_SHARED_BY_DEFAULT",
    evidence_contract: "family-evidence/v1",
    evidence_identity_policy: "EVIDENCE_CLASS_CANNOT_BE_SELF_PROMOTED",
    read_transport: {
      mode: "CROSS_ACCOUNT_SAFE_DIRECT_READ",
      cloudflare_service_binding: false,
      stock_realtime: "FUGLE_REST_QUOTE_TRADES",
      stock_formal_ohlc: "TV_PAPERTRADER_GITHUB_CANONICAL_READ_ONLY",
      current_chip: "OFFICIAL_EXACT_DATE_ON_DEMAND_READ_ONLY",
      broker_branch: "MONEYDJ_RANKED_ONLY_FAIL_SOFT_NO_PERSISTENCE",
      event_research: "JIN10_MCP_EVENTS_READ_ONLY",
      capabilities: ["CANONICAL_OHLC_READ", "CURRENT_CHIP_READ", "BROKER_RANKED_READ", "STOCK_REALTIME_READ", "STOCK_FIVE_LEVEL_BOOK", "STOCK_RECENT_TRADES", "STOCK_SHORT_WINDOW_ORDER_FLOW", "JIN10_EVENT_READ"],
      stock_live_persistence: "NONE",
      current_chip_persistence: "NONE",
      event_research_persistence: "NONE",
      public_bypass_route: false,
      mutation_methods: false,
    },
    evidence_hierarchy: {
      FORMAL_TRUTH: ["OHLC_MCP_GITHUB_CANONICAL_READ", "OFFICIAL_EXACT_DATE_ON_DEMAND", "PUBLISHED_GENERATION_HISTORY"],
      GOVERNED_CONTEXT: ["MONEYDJ_BROKER_RANKED_PUBLIC_SECONDARY", "WARRANT_ACTIVITY_NON_DIRECTIONAL", "STRUCTURED_FUNDAMENTALS", "HOLDER_STRUCTURE", "TXF_CONTEXT", "GLOBAL_MARKET_CONTEXT", "GLOBAL_FUTURES_CONTEXT", "JIN10_MCP_EVENTS_READ_ONLY"],
      DISPLAY_FALLBACK: ["FUGLE_REST_QUOTE_TRADES", "FINMIND_PRICE_FALLBACK"],
      WEB_EVIDENCE: ["OPEN_WORLD_WEB_WITH_SOURCE_AND_TIME"],
    },
    permission_model: {
      market_and_research_reads: "ALLOW_WHEN_AVAILABLE",
      future_owner_read_capabilities: "SHARE_BY_DEFAULT_UNLESS_PRIVATE_OR_SENSITIVE",
      all_mutations: "DENY",
      owner_private_context: "DENY_BY_DEFAULT_UNLESS_EXPLICITLY_SHARED",
    },
    capabilities: FAMILY_SHARED_READ_CAPABILITIES,
    hard_deny: FAMILY_HARD_DENY_CAPABILITIES,
    evidence_rules: [
      "能力共享不代表資料身份可互換：正式OHLC只認既有tv-fugle-1d canonical的GitHub唯讀資料。",
      "當期法人、融資融券、借券與借券賣出優先使用TWSE/TPEx exact-date on-demand；當日未公布就PENDING，不得拿前一日冒充。",
      "MoneyDJ分點只屬PUBLIC_SECONDARY/RANKED_ONLY；未出現在榜上不代表零交易，且不依賴FinMind token。",
      "權證公開成交資料只代表成交活動度；不得由成交量推論買方aggressor、買超或dealer hedge方向。",
      "既有Published generation保留不可變歷史/replay context，不再覆蓋當期official on-demand證據。",
      "Fugle REST成交、五檔、逐筆與短窗主動買賣只屬即時context，不持久化、不得升級成正式OHLC。",
      "Jin10 MCP快訊/新聞只屬事件研究context，不持久化、不得升級成正式OHLC、當期官方籌碼或公司官方重大訊息。",
      "TXF/Global Futures不可用時必須fail-closed，不得用股票資料或Web價格補成正式context。",
      "GOVERNED_CONTEXT、DISPLAY_FALLBACK、WEB_EVIDENCE 不能自行升級成 FORMAL_TRUTH。",
      "Web/研究資料可補充與解釋，但不能覆寫 canonical/official 事實。",
      "資料不足必須維持 UNKNOWN/UNAVAILABLE，不得為湊結論補值。",
      "Owner 私人郵件、行事曆、聯絡人與未明確共享的私人檔案不屬於 Family shared plane。",
    ],
  } as const;
}
