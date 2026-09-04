export type TwChipCapability =
  | "institutional"
  | "margin_short"
  | "securities_lending"
  | "sbl_short_sale"
  | "broker_branch"
  | "warrant"
  | "maintenance_ratio";

export type TwChipMarket = "listed" | "otc" | "both";
export type TwChipSourceTier = "OFFICIAL_PRIMARY" | "PUBLIC_SECONDARY" | "UNVERIFIED";
export type TwChipSourceStatus = "READY" | "EXPERIMENTAL" | "PLANNED_FAIL_CLOSED";
export type TwChipCompleteness = "FULL_OFFICIAL_DATASET" | "RANKED_ONLY" | "UNKNOWN";

export type TwChipSource = {
  id: string;
  capability: TwChipCapability;
  market: TwChipMarket;
  tier: TwChipSourceTier;
  status: TwChipSourceStatus;
  source_name: string;
  url_templates: string[];
  parser_contract?: string;
  completeness: TwChipCompleteness;
  source_date_verification: boolean;
  bulk_collection_allowed: boolean;
  terms_review_required: boolean;
  notes?: string;
};

/**
 * Thin routing registry for Taiwan chip/intelligence sources.
 *
 * Design goal: keep the public MCP ingress and public tool names stable while
 * moving non-OHLC market/chip data to read-only, on-demand retrieval. The
 * registry contains routing metadata only; it must never become a daily raw
 * data store or a second decision engine.
 */
export const TW_CHIP_INTELLIGENCE_REGISTRY = Object.freeze({
  schema: "TW_CHIP_INTELLIGENCE_REGISTRY_V1",
  registry_version: "tw-chip-intelligence/v1.1.0-on-demand",
  mode: "ON_DEMAND_ONLY" as const,
  read_only: true,
  monitoring_enabled: false,
  persistence_enabled: false,
  bulk_capture_enabled: false,
  decision_logic_enabled: false,
  policy: Object.freeze({
    official_first: true,
    require_requested_or_resolved_as_of_date: true,
    require_source_date_match: true,
    previous_day_substitution_for_missing_current_day: false,
    pending_when_not_published: true,
    expose_completeness: true,
    no_captcha_bypass: true,
    no_automated_bulk_scrape_when_disallowed: true,
    raw_response_persistence: "NONE" as const,
    normalized_response_persistence: "NONE" as const,
    gpt_role: "INTERPRET_EVIDENCE_NOT_FIXED_SCORE" as const,
  }),
  ingress_contract: Object.freeze({
    owner_primary: "/my-mcp",
    owner_legacy_alias: "/mcp",
    family: "/family-mcp",
    change_public_ingress: false,
    add_public_endpoint: false,
    add_public_tool_name_required: false,
  }),
  integration_contract: Object.freeze({
    owner_existing_tools: [
      "get_tw_margin_short",
      "get_tw_market_data_bundle",
      "get_tw_market_chip_summary",
    ],
    family_existing_tools: [
      "get_family_market_chip_summary",
      "analyze_family_stock",
      "compare_family_stocks",
    ],
    family_permission: "READ_ONLY_ALLOWLIST" as const,
    rule: "INTERNAL_PROVIDER_SWAP_BEHIND_EXISTING_PUBLIC_SURFACE" as const,
  }),
  sources: Object.freeze([
    {
      id: "twse_institutional_t86",
      capability: "institutional",
      market: "listed",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TWSE_T86",
      url_templates: ["https://www.twse.com.tw/rwd/zh/fund/T86?date={YYYYMMDD}&selectType=ALLBUT0999&response=json"],
      parser_contract: "normalizeTwseInstitutional",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
    },
    {
      id: "tpex_institutional_daily",
      capability: "institutional",
      market: "otc",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TPEX_3INSTI_DAILY_TRADING",
      url_templates: ["https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading"],
      parser_contract: "normalizeTpexInstitutional",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
    },
    {
      id: "twse_margin_short_mi_margn",
      capability: "margin_short",
      market: "listed",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TWSE_MI_MARGN",
      url_templates: ["https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={YYYYMMDD}&selectType=ALL&response=json"],
      parser_contract: "normalizeTwseMiMargnOfficial",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
    },
    {
      id: "tpex_margin_short_balance",
      capability: "margin_short",
      market: "otc",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TPEX_MAINBOARD_MARGIN_BALANCE",
      url_templates: ["https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance"],
      parser_contract: "normalizeTpexMargin",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
    },
    {
      id: "twse_securities_lending_twt72u",
      capability: "securities_lending",
      market: "both",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TWSE_TWT72U",
      url_templates: ["https://www.twse.com.tw/exchangeReport/TWT72U?date={YYYYMMDD}&selectType=SLBNLB&response=json"],
      parser_contract: "normalizeTwseSecuritiesLending",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
    },
    {
      id: "twse_sbl_short_sale_twt93u",
      capability: "sbl_short_sale",
      market: "listed",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TWSE_TWT93U",
      url_templates: ["https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date={YYYYMMDD}&response=json"],
      parser_contract: "normalizeTwseSblShortSale",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
    },
    {
      id: "tpex_sbl_short_sale",
      capability: "sbl_short_sale",
      market: "otc",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL",
      url_templates: [
        "https://www.tpex.org.tw/openapi/v1/tpex_margin_sbl",
        "https://www.tpex.org.tw/openapi/v1/tpex_short_sell",
      ],
      parser_contract: "normalizeTpexSblShortSale",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
    },
    {
      id: "moneydj_broker_branch_ranked",
      capability: "broker_branch",
      market: "both",
      tier: "PUBLIC_SECONDARY",
      status: "EXPERIMENTAL",
      source_name: "MoneyDJ broker branch public pages",
      url_templates: [
        "https://www.moneydj.com/Z/ZC/ZCO/ZCO.djhtm?a={SYMBOL}&e=",
        "https://www.moneydj.com/Z/ZG/ZGB/ZGB0/ZGB0.djhtm?a={BROKER_CODE}&b={BRANCH_CODE}",
      ],
      parser_contract: "getTwBrokerRankedOnDemand stock->ranked-branches; branch->stocks remains routing-only until separately regression-tested",
      completeness: "RANKED_ONLY",
      source_date_verification: true,
      bulk_collection_allowed: false,
      terms_review_required: true,
      notes: "Secondary ranked evidence only. Do not represent missing branches as zero activity. Do not bypass anti-bot/CAPTCHA or bulk-scrape the site.",
    },
    {
      id: "twse_warrant_activity",
      capability: "warrant",
      market: "listed",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TWSE warrant basic + daily transaction OpenAPI",
      url_templates: [
        "https://openapi.twse.com.tw/v1/opendata/t187ap37_L",
        "https://openapi.twse.com.tw/v1/opendata/t187ap42_L",
      ],
      parser_contract: "getTwWarrantActivityOnDemand",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
      notes: "Activity/turnover evidence only. Daily volume/value does not identify buy aggressor, broker direction, dealer hedge direction, or net buying.",
    },
    {
      id: "tpex_warrant_activity",
      capability: "warrant",
      market: "otc",
      tier: "OFFICIAL_PRIMARY",
      status: "READY",
      source_name: "TPEx warrant info + warrant quotes OpenAPI",
      url_templates: [
        "https://www.tpex.org.tw/openapi/v1/tpex_warrant",
        "https://www.tpex.org.tw/openapi/v1/tpex_warrant_quts",
      ],
      parser_contract: "getTwWarrantActivityOnDemand",
      completeness: "FULL_OFFICIAL_DATASET",
      source_date_verification: true,
      bulk_collection_allowed: true,
      terms_review_required: false,
      notes: "Activity/turnover evidence only. Daily volume/value does not identify buy aggressor, broker direction, dealer hedge direction, or net buying.",
    },
    {
      id: "maintenance_ratio_source_pending_verification",
      capability: "maintenance_ratio",
      market: "both",
      tier: "UNVERIFIED",
      status: "PLANNED_FAIL_CLOSED",
      source_name: "Official customer account maintenance ratio is not public market data",
      url_templates: [],
      completeness: "UNKNOWN",
      source_date_verification: false,
      bulk_collection_allowed: false,
      terms_review_required: false,
      notes: "Do not infer account-level maintenance ratio from market aggregates. Existing ESTIMATED_POSITION_MAINTENANCE_PROXY is a derived proxy from reference price and estimated financing cost and must remain explicitly labeled non-official.",
    },
  ] satisfies readonly TwChipSource[]),
});

export function queryTwChipSources(input: {
  capability?: TwChipCapability;
  market?: "listed" | "otc";
  include_experimental?: boolean;
  include_planned?: boolean;
}) {
  return TW_CHIP_INTELLIGENCE_REGISTRY.sources.filter((source) => {
    if (input.capability && source.capability !== input.capability) return false;
    if (input.market && source.market !== "both" && source.market !== input.market) return false;
    if (!input.include_planned && source.status === "PLANNED_FAIL_CLOSED") return false;
    if (!input.include_experimental && source.status === "EXPERIMENTAL") return false;
    return true;
  });
}
