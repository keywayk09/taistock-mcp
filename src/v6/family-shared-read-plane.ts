export const FAMILY_SHARED_READ_PLANE_VERSION = "family-shared-read-plane/v1.1.0";

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
    label: "即時市場與盤中狀態",
    sources: ["FUGLE_QUOTE", "FUGLE_MARKET_SNAPSHOT", "TWSE", "TPEX"],
    identity: "REALTIME_OR_OFFICIAL_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "Fugle 可作盤中即時/研究資訊；正式 OHLC 身份仍由 OHLC MCP 決定。",
  },
  {
    id: "canonical_ohlc",
    label: "正式 OHLC / 技術結構",
    sources: ["OHLC_MCP"],
    identity: "FORMAL_CANONICAL_OHLC",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "Family 只讀；不得把 Fugle、FinMind 或 Web 價格冒充正式 OHLC。",
  },
  {
    id: "published_chip",
    label: "正式籌碼",
    sources: ["PUBLISHED_GENERATION"],
    identity: "FORMAL_PUBLISHED_CHIP",
    access: "READ_ONLY",
    family_share: "SHARED_BY_DEFAULT",
    notes: "三大法人、融資融券、借券等正式籌碼只認 Published generation。",
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
    id: "global_market_context",
    label: "全球市場與期貨研究背景",
    sources: ["VERIFIED_GLOBAL_FUTURES_READ", "OPEN_WORLD_WEB"],
    identity: "VERIFIED_OR_RESEARCH_CONTEXT",
    access: "READ_ONLY",
    family_share: "SHARED_WHEN_AVAILABLE",
    notes: "只讀已驗證資料；PENDING/未驗證產品不得包裝成正式資料。",
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
    evidence_hierarchy: {
      FORMAL_TRUTH: ["OHLC_MCP_VERIFIED_CANONICAL", "PUBLISHED_GENERATION"],
      GOVERNED_CONTEXT: ["STRUCTURED_FUNDAMENTALS", "HOLDER_STRUCTURE", "TXF_CONTEXT", "GLOBAL_MARKET_CONTEXT", "GLOBAL_FUTURES_CONTEXT"],
      DISPLAY_FALLBACK: ["FUGLE_DISPLAY", "FINMIND_PRICE_FALLBACK"],
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
      "能力共享不代表資料身份可互換：正式 OHLC 仍只認 OHLC MCP。",
      "正式籌碼仍只認 Published generation。",
      "GOVERNED_CONTEXT、DISPLAY_FALLBACK、WEB_EVIDENCE 不能自行升級成 FORMAL_TRUTH。",
      "Web/研究資料可補充與解釋，但不能覆寫 canonical/official 事實。",
      "資料不足必須維持 UNKNOWN/UNAVAILABLE，不得為湊結論補值。",
      "Owner 私人郵件、行事曆、聯絡人與未明確共享的私人檔案不屬於 Family shared plane。",
    ],
  } as const;
}
