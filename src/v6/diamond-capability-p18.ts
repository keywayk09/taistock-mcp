import {
  getDiamondArchitectureStatusP16,
  getDiamondResearchLabP16,
  getDiamondToolRegistryP16,
} from "./diamond-capability-p16";
import { TW_MARKET_DATA_VERSION } from "./tw-market-data-github";

const MARKET_CAPABILITIES = [
  {
    id: "tw_institutional_flow",
    title: "台股三大法人買賣超 / Institutional Flow",
    category: "MARKET_DATA" as const,
    status: "ACTIVE_INTERNAL" as const,
    owner: "Diamond Market Data Plane",
    source_projects: ["keywayk09/taistock-mcp"],
    markets: ["TW_STOCK"],
    gateway: "DIAMOND_MCP",
    current_tool: "get_tw_institutional_flow",
    timeframes: ["1d"],
    implementation_version: TW_MARKET_DATA_VERSION,
    runtime_configuration: "INTERNAL" as const,
    formal_research_eligible: true,
    direct_provider_access: false as const,
    read_only_research: true,
    production_write: false as const,
    notes: "TWSE/TPEx official daily institutional data is the primary truth. Immutable GitHub snapshots are joined with FinMind history only as fallback; 1/3/5/10/20-day aggregates are exposed without writing OHLC.",
  },
  {
    id: "tw_margin_short",
    title: "台股融資融券 / Margin & Short",
    category: "MARKET_DATA" as const,
    status: "ACTIVE_INTERNAL" as const,
    owner: "Diamond Market Data Plane",
    source_projects: ["keywayk09/taistock-mcp"],
    markets: ["TW_STOCK"],
    gateway: "DIAMOND_MCP",
    current_tool: "get_tw_margin_short",
    timeframes: ["1d"],
    implementation_version: TW_MARKET_DATA_VERSION,
    runtime_configuration: "INTERNAL" as const,
    formal_research_eligible: true,
    direct_provider_access: false as const,
    read_only_research: true,
    production_write: false as const,
    notes: "TWSE/TPEx official margin/short balance is the primary truth. Late publication is retried by a later scheduled capture and degrades only this layer; it never blocks the OHLC data plane.",
  },
  {
    id: "tw_securities_lending",
    title: "台股借券/還券 / Securities Lending",
    category: "MARKET_DATA" as const, status: "ACTIVE_INTERNAL" as const, owner: "Diamond Market Data Plane",
    source_projects: ["keywayk09/taistock-mcp"], markets: ["TW_STOCK"], gateway: "DIAMOND_MCP",
    current_tool: "get_tw_securities_lending", timeframes: ["1d"], implementation_version: TW_MARKET_DATA_VERSION,
    runtime_configuration: "INTERNAL" as const, formal_research_eligible: true, direct_provider_access: false as const, read_only_research: true, production_write: false as const,
    notes: "TWSE TWT72U official borrow/return/balance data archived to GitHub canonical storage. Official return/closure is kept distinct from intraday buy-to-cover volume.",
  },
  {
    id: "tw_sbl_short_sale",
    title: "台股借券賣出 / SBL Short Sale",
    category: "MARKET_DATA" as const, status: "ACTIVE_INTERNAL" as const, owner: "Diamond Market Data Plane",
    source_projects: ["keywayk09/taistock-mcp"], markets: ["TW_STOCK"], gateway: "DIAMOND_MCP",
    current_tool: "get_tw_sbl_short_sale", timeframes: ["1d"], implementation_version: TW_MARKET_DATA_VERSION,
    runtime_configuration: "INTERNAL" as const, formal_research_eligible: true, direct_provider_access: false as const, read_only_research: true, production_write: false as const,
    notes: "TWSE TWT93U and TPEx official SBL short-sale sources are archived in GitHub and kept separate from margin short balances.",
  },
] as const;

export function getDiamondToolRegistryP18() {
  const base = getDiamondToolRegistryP16();
  return {
    ...base,
    tw_market_data: {
      status: "ACTIVE_INTERNAL" as const,
      version: TW_MARKET_DATA_VERSION,
      owner: "Diamond Market Data Plane",
      source_priority: ["TWSE/TPEx official", "GitHub immutable canonical snapshot", "FinMind fallback/history"],
      storage: "GITHUB_ONLY_NO_D1_NO_R2",
      tools: [
        "get_tw_market_data_contract",
        "get_tw_institutional_flow",
        "get_tw_margin_short",
        "get_tw_securities_lending",
        "get_tw_sbl_short_sale",
        "get_tw_market_data_bundle",
        "get_tw_market_data_status",
      ],
      rolling_windows: [1,3,5,10,20],
      ohlc_gateway: "OHLC_MCP_ONLY",
    },
    capabilities: [...base.capabilities, ...MARKET_CAPABILITIES],
  };
}

export function getDiamondResearchLabP18() {
  return getDiamondResearchLabP16();
}

export function getDiamondArchitectureStatusP18() {
  const base = getDiamondArchitectureStatusP16();
  return {
    ...base,
    architecture_version: "diamond-architecture/2026-08-p19-github",
    tw_market_data_layer: {
      status: "ACTIVE_INTERNAL" as const,
      engine_version: TW_MARKET_DATA_VERSION,
      ownership: {
        ohlc: "OHLC MCP / OHLC data plane",
        institutional_margin_fundamental_event: "Diamond Market Data / Research Data planes",
      },
      official_sources: {
        listed_institutional: "TWSE T86",
        otc_institutional: "TPEx tpex_3insti_daily_trading",
        listed_margin: "TWSE MI_MARGN",
        otc_margin: "TPEx tpex_mainboard_margin_balance",
        securities_lending: "TWSE TWT72U",
        listed_sbl_short_sale: "TWSE TWT93U",
        otc_sbl_short_sale: "TPEx tpex_margin_sbl + tpex_short_sell",
      },
      source_priority: "OFFICIAL_GITHUB_BEFORE_FINMIND_HISTORY",
      archive_model: "GITHUB_RAW_PLUS_IMMUTABLE_SNAPSHOTS_PLUS_DERIVED_INDEX",
      storage_policy: "GITHUB_ONLY_NO_D1_NO_R2",
      capture_schedule_taipei: ["18:15 weekdays", "20:15 weekdays retry/finalize"],
      rolling_windows: [1,3,5,10,20],
      layer_degradation: true,
      market_data_failure_blocks_ohlc: false,
      formal_swing_join: "OHLC_MCP + DIAMOND_MARKET_DATA",
      legacy_market_tools: ["get_institutional", "get_margin", "analyze_swing_candidate"],
      legacy_policy: "COMPATIBILITY_ONLY_NOT_FORMAL_SWING_SOURCE",
    },
    hard_boundaries: {
      ...base.hard_boundaries,
      market_data_ohlc_write: "FORBIDDEN",
      market_data_failure_blocks_ohlc: "FORBIDDEN",
      finmind_price_as_formal_ohlc: "FORBIDDEN",
      r2_usage: "FORBIDDEN",
      formal_market_data_source_priority: "OFFICIAL_BEFORE_FALLBACK",
      formal_swing_legacy_analyze_swing_candidate: "FORBIDDEN",
    },
    counts: {
      ...base.counts,
      tool_capabilities: Number(base.counts.tool_capabilities ?? 0) + MARKET_CAPABILITIES.length,
      tw_market_data_capabilities: MARKET_CAPABILITIES.length,
      tw_market_data_tools: 7,
    },
  };
}
