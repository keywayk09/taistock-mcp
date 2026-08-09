export const DIAMOND_CAPABILITY_SCHEMA_VERSION = "diamond-capability-registry/v1";
export const DIAMOND_ARCHITECTURE_VERSION = "diamond-architecture/2026-08-p10b";

export type CapabilityStatus =
  | "ACTIVE_INTERNAL"
  | "ADAPTER_IMPLEMENTED_UNVERIFIED"
  | "CANDIDATE_EXTERNAL"
  | "NOT_CONNECTED"
  | "SANDBOX_ONLY"
  | "APPROVAL_REQUIRED";

export type CapabilityPlane = "TOOL_REGISTRY" | "RESEARCH_VALIDATION_LAB" | "STRATEGY_LAB" | "INTELLIGENCE_CORE";

export type DiamondToolCapability = {
  id: string;
  title: string;
  category: "MARKET_DATA" | "RESEARCH_DATA" | "WORKFLOW";
  status: CapabilityStatus;
  owner: string;
  source_projects: string[];
  markets?: string[];
  gateway?: string;
  current_tool?: string;
  timeframes?: string[];
  implementation_version?: string;
  runtime_configuration?: "INTERNAL" | "PROVIDER_SECRET_REQUIRED" | "NOT_IMPLEMENTED";
  formal_research_eligible?: boolean;
  direct_provider_access: false;
  read_only_research: boolean;
  production_write: false;
  notes: string;
};

export type ResearchCapability = {
  id: string;
  title: string;
  status: CapabilityStatus;
  source_projects: string[];
  current_tool?: string;
  deterministic?: boolean;
  production_strategy_promotion: false;
  notes: string;
};

export type StrategyCandidate = {
  id: string;
  title: string;
  source_project: "ZhuLinsen/daily_stock_analysis";
  source_path: string;
  status: "CANDIDATE_EXTERNAL";
  formalization_class: "FULLY_QUANTIFIABLE_CANDIDATE" | "SEMI_QUANTITATIVE_CANDIDATE" | "RESEARCH_LLM_CANDIDATE";
  validated_on_taiwan_market: false;
  production_enabled: false;
  required_pipeline: string[];
};

const EXTERNAL_GATE = [
  "AUDIT",
  "FORMALIZE_OR_ADAPT",
  "SANDBOX",
  "BACKTEST_OR_VALIDATION",
  "REGIME_TEST",
  "REGRESSION",
  "APPROVAL",
] as const;

const MARKET_ADAPTER_NOTE = "Product surface belongs to Diamond Tool Registry, but OHLC implementation lives behind OHLC MCP Provider Adapter -> normalization -> Data Quality Gate -> frozen dataset/provenance. No Diamond direct-provider call.";
const P10_UNVERIFIED_NOTE = "P10 global 1D adapter is implemented in tv-papertrader/OHLC MCP 1.3.0. Runtime provider configuration is owned by the OHLC data plane. A successful provider response is frozen/hash-versioned but formal_research_eligible=false until independent cross-verification/archive reconciliation exists.";

const implementedGlobalOhlc = (
  id: string,
  title: string,
  markets: string[],
): DiamondToolCapability => ({
  id,
  title,
  category: "MARKET_DATA",
  status: "ADAPTER_IMPLEMENTED_UNVERIFIED",
  owner: "OHLC MCP / Global Market Adapter",
  source_projects: ["keywayk09/tv-papertrader"],
  markets,
  gateway: "OHLC_MCP",
  current_tool: "read_global_ohlc",
  timeframes: ["1d"],
  implementation_version: "OHLC MCP 1.3.0 / global-market-adapter v1.0.0",
  runtime_configuration: "PROVIDER_SECRET_REQUIRED",
  formal_research_eligible: false,
  direct_provider_access: false,
  read_only_research: true,
  production_write: false,
  notes: `${MARKET_ADAPTER_NOTE} ${P10_UNVERIFIED_NOTE}`,
});

export const DIAMOND_TOOL_REGISTRY: readonly DiamondToolCapability[] = Object.freeze([
  {
    id: "tw_ohlc",
    title: "台股 OHLC / K線",
    category: "MARKET_DATA",
    status: "ACTIVE_INTERNAL",
    owner: "OHLC MCP",
    source_projects: ["keywayk09/tv-papertrader"],
    markets: ["TW_STOCK"],
    gateway: "OHLC_MCP",
    current_tool: "read_ohlc",
    timeframes: ["1d", "5m", "1m"],
    implementation_version: "OHLC V4 / OHLC MCP 1.3.0",
    runtime_configuration: "INTERNAL",
    formal_research_eligible: true,
    direct_provider_access: false,
    read_only_research: true,
    production_write: false,
    notes: "Diamond reads 1D/5m/1m through the governed OHLC gateway. Production writers remain in the OHLC data plane. Formal research eligibility is still evaluated per returned dataset by the Data Quality/verification gate.",
  },
  implementedGlobalOhlc("us_ohlc", "美股 OHLC / ETF", ["US_STOCK", "US_ETF"]),
  implementedGlobalOhlc("hk_ohlc", "港股 OHLC", ["HK_STOCK"]),
  implementedGlobalOhlc("cn_ohlc", "A股 OHLC", ["CN_STOCK"]),
  implementedGlobalOhlc("jp_ohlc", "日股 OHLC", ["JP_STOCK"]),
  implementedGlobalOhlc("kr_ohlc", "韓股 OHLC", ["KR_STOCK"]),
  implementedGlobalOhlc("global_index_ohlc", "全球指數 OHLC", ["GLOBAL_INDEX"]),
  implementedGlobalOhlc("crypto_ohlc", "Crypto OHLC", ["CRYPTO"]),
  implementedGlobalOhlc("fx_ohlc", "Forex OHLC", ["FX"]),
  {
    id: "futures_ohlc",
    title: "Futures OHLC",
    category: "MARKET_DATA",
    status: "CANDIDATE_EXTERNAL",
    owner: "OHLC MCP / Future Market Adapter",
    source_projects: ["HKUDS/Vibe-Trading"],
    markets: ["FUTURES"],
    gateway: "OHLC_MCP",
    timeframes: [],
    runtime_configuration: "NOT_IMPLEMENTED",
    formal_research_eligible: false,
    direct_provider_access: false,
    read_only_research: true,
    production_write: false,
    notes: `${MARKET_ADAPTER_NOTE} Futures remain candidate-only; P10 does not implement futures.`,
  },
  {
    id: "fundamental_data",
    title: "Fundamental / 財報研究資料",
    category: "RESEARCH_DATA",
    status: "CANDIDATE_EXTERNAL",
    owner: "Research Data Gateway",
    source_projects: ["ZhuLinsen/daily_stock_analysis", "HKUDS/Vibe-Trading"],
    runtime_configuration: "NOT_IMPLEMENTED",
    direct_provider_access: false,
    read_only_research: true,
    production_write: false,
    notes: "Does not belong in OHLC MCP. Future adapter may expose fundamentals, filings, estimates and related evidence to Diamond.",
  },
  {
    id: "news_event_data",
    title: "News / Event / Filing",
    category: "RESEARCH_DATA",
    status: "CANDIDATE_EXTERNAL",
    owner: "News/Event Gateway",
    source_projects: ["ZhuLinsen/daily_stock_analysis", "HKUDS/Vibe-Trading"],
    runtime_configuration: "NOT_IMPLEMENTED",
    direct_provider_access: false,
    read_only_research: true,
    production_write: false,
    notes: "Evidence-oriented research data; must preserve source/time watermark and must not contaminate OHLC truth.",
  },
  {
    id: "macro_research_data",
    title: "Macro / Rates / Cross-market Context",
    category: "RESEARCH_DATA",
    status: "CANDIDATE_EXTERNAL",
    owner: "Macro Gateway",
    source_projects: ["HKUDS/Vibe-Trading"],
    runtime_configuration: "NOT_IMPLEMENTED",
    direct_provider_access: false,
    read_only_research: true,
    production_write: false,
    notes: "Research context only; future data must carry source, timestamp, currency/timezone semantics and provenance.",
  },
  ...[
    ["watchlist", "Watchlist Workflow"],
    ["dashboard", "Dashboard"],
    ["report_pipeline", "Report Pipeline"],
    ["scheduler", "Scheduler"],
    ["notification", "Notification"],
  ].map(([id, title]) => ({
    id,
    title,
    category: "WORKFLOW" as const,
    status: "CANDIDATE_EXTERNAL" as const,
    owner: "Diamond Tool Registry",
    source_projects: ["ZhuLinsen/daily_stock_analysis"],
    runtime_configuration: "NOT_IMPLEMENTED" as const,
    direct_provider_access: false as const,
    read_only_research: true,
    production_write: false as const,
    notes: "Candidate workflow capability. Audit/adapt before activation; no permission to mutate Production market data or strategy rules.",
  })),
]);

export const DIAMOND_RESEARCH_LAB: readonly ResearchCapability[] = Object.freeze([
  {
    id: "deterministic_5m_backtest",
    title: "Deterministic 5m Backtest",
    status: "ACTIVE_INTERNAL",
    source_projects: ["keywayk09/taistock-mcp"],
    current_tool: "run_deterministic_intraday_5m_backtest",
    deterministic: true,
    production_strategy_promotion: false,
    notes: "Fixed dataset + Signal + parameters + engine version contract.",
  },
  {
    id: "batch_5m_backtest",
    title: "5m Large-sample Batch Backtest",
    status: "ACTIVE_INTERNAL",
    source_projects: ["keywayk09/taistock-mcp"],
    current_tool: "run_signal_ledger_batch_backtest_5m",
    deterministic: true,
    production_strategy_promotion: false,
    notes: "P5 large-sample baseline; ambiguous intrabars are queued for selective replay.",
  },
  {
    id: "selective_1m_replay",
    title: "Selective 1m Replay",
    status: "ACTIVE_INTERNAL",
    source_projects: ["keywayk09/taistock-mcp"],
    current_tool: "resolve_ambiguous_backtest_with_1m",
    deterministic: true,
    production_strategy_promotion: false,
    notes: "P6 resolves selected ambiguous 5m cases without overwriting the conservative 5m result.",
  },
  {
    id: "swing_outcome_path",
    title: "Swing Outcome Path",
    status: "ACTIVE_INTERNAL",
    source_projects: ["keywayk09/taistock-mcp"],
    current_tool: "run_swing_outcome_path",
    deterministic: true,
    production_strategy_promotion: false,
    notes: "P7 independent 1D outcome path; future bars are outcome-only and never feed Signal generation.",
  },
  {
    id: "experiment_memory_review",
    title: "Experiment Memory + Review Loop",
    status: "ACTIVE_INTERNAL",
    source_projects: ["keywayk09/taistock-mcp"],
    current_tool: "review_hypothesis_history",
    deterministic: true,
    production_strategy_promotion: false,
    notes: "P8 keeps successful and failed experiments and blocks silent repetition/promotion.",
  },
  ...[
    ["walk_forward", "Walk-Forward Validation"],
    ["monte_carlo", "Monte Carlo Validation"],
    ["bootstrap", "Bootstrap Validation"],
    ["benchmark", "Benchmark / Alpha Comparison"],
    ["run_card", "Research Run Card"],
    ["shadow_account", "Shadow Account / Journal"],
    ["alpha_research", "Alpha Research Workflow"],
  ].map(([id, title]) => ({
    id,
    title,
    status: "CANDIDATE_EXTERNAL" as const,
    source_projects: ["HKUDS/Vibe-Trading"],
    deterministic: undefined,
    production_strategy_promotion: false as const,
    notes: "Architecture/method candidate only. Must be adapted to Diamond frozen datasets, provenance, no-lookahead and Experiment Ledger contracts before activation.",
  })),
]);

const STRATEGY_PIPELINE = [
  "STRATEGY_AUDIT",
  "FORMALIZATION",
  "TAIWAN_SEMANTIC_CALIBRATION",
  "DATA_REQUIREMENT_MAPPING",
  "HISTORICAL_BACKTEST",
  "WALK_FORWARD",
  "MFE_MAE",
  "REGIME_TEST",
  "ROBUSTNESS_TEST",
  "REGRESSION",
  "HUMAN_APPROVAL_GATE",
] as const;

const strategy = (
  id: string,
  title: string,
  formalization_class: StrategyCandidate["formalization_class"],
): StrategyCandidate => ({
  id,
  title,
  source_project: "ZhuLinsen/daily_stock_analysis",
  source_path: `strategies/${id}.yaml`,
  status: "CANDIDATE_EXTERNAL",
  formalization_class,
  validated_on_taiwan_market: false,
  production_enabled: false,
  required_pipeline: [...STRATEGY_PIPELINE],
});

export const DIAMOND_STRATEGY_LAB: readonly StrategyCandidate[] = Object.freeze([
  strategy("bull_trend", "Bull Trend", "SEMI_QUANTITATIVE_CANDIDATE"),
  strategy("ma_golden_cross", "MA Golden Cross", "FULLY_QUANTIFIABLE_CANDIDATE"),
  strategy("volume_breakout", "Volume Breakout", "FULLY_QUANTIFIABLE_CANDIDATE"),
  strategy("shrink_pullback", "Shrink Pullback", "FULLY_QUANTIFIABLE_CANDIDATE"),
  strategy("bottom_volume", "Bottom Volume", "FULLY_QUANTIFIABLE_CANDIDATE"),
  strategy("box_oscillation", "Box Oscillation", "FULLY_QUANTIFIABLE_CANDIDATE"),
  strategy("one_yang_three_yin", "One Yang Three Yin", "SEMI_QUANTITATIVE_CANDIDATE"),
  strategy("chan_theory", "Chan Theory", "SEMI_QUANTITATIVE_CANDIDATE"),
  strategy("wave_theory", "Wave Theory", "SEMI_QUANTITATIVE_CANDIDATE"),
  strategy("dragon_head", "Dragon Head", "RESEARCH_LLM_CANDIDATE"),
  strategy("emotion_cycle", "Emotion Cycle", "RESEARCH_LLM_CANDIDATE"),
  strategy("hot_theme", "Hot Theme", "RESEARCH_LLM_CANDIDATE"),
  strategy("event_driven", "Event Driven", "RESEARCH_LLM_CANDIDATE"),
  strategy("growth_quality", "Growth Quality", "SEMI_QUANTITATIVE_CANDIDATE"),
  strategy("expectation_repricing", "Expectation Repricing", "RESEARCH_LLM_CANDIDATE"),
]);

export const EXTERNAL_PROJECT_REGISTRY = Object.freeze([
  {
    project: "ZhuLinsen/daily_stock_analysis",
    status: "CANDIDATE_EXTERNAL" as const,
    destination_planes: ["TOOL_REGISTRY", "STRATEGY_LAB"] as CapabilityPlane[],
    allowed_intake: ["market-adapter ideas", "research-data ideas", "watchlist/dashboard/report/scheduler/notification workflow", "15 strategy skills"],
    code_import_policy: "NO_DIRECT_BULK_IMPORT",
    gate: [...EXTERNAL_GATE],
  },
  {
    project: "HKUDS/Vibe-Trading",
    status: "CANDIDATE_EXTERNAL" as const,
    destination_planes: ["TOOL_REGISTRY", "RESEARCH_VALIDATION_LAB"] as CapabilityPlane[],
    allowed_intake: ["multi-market loader architecture", "walk-forward", "Monte Carlo", "bootstrap", "benchmark", "run card", "shadow account", "alpha research"],
    code_import_policy: "NO_DIRECT_BULK_IMPORT",
    gate: [...EXTERNAL_GATE],
  },
  {
    project: "mattpocock/skills",
    status: "CANDIDATE_EXTERNAL" as const,
    destination_planes: [] as CapabilityPlane[],
    allowed_intake: ["Engineering Control Plane only"],
    code_import_policy: "AI_TOOLBOX_ONLY",
    gate: [...EXTERNAL_GATE],
  },
  {
    project: "PrimeIntellect-ai/prime-agent",
    status: "SANDBOX_ONLY" as const,
    destination_planes: [] as CapabilityPlane[],
    allowed_intake: ["Long-running Agent Runtime candidate"],
    code_import_policy: "AI_TOOLBOX_SANDBOX_ONLY",
    gate: ["ISOLATED_WORKTREE", "MINIMAL_SECRETS", "RESTRICTED_PERMISSION", "TESTS", "CI", "HUMAN_GATE"],
  },
]);

export function getDiamondToolRegistry() {
  return {
    schema_version: DIAMOND_CAPABILITY_SCHEMA_VERSION,
    plane: "TOOL_REGISTRY" as const,
    product_integration: "DIAMOND_ENGINE" as const,
    implementation_boundary: "SERVICE_LEVEL_SEPARATION" as const,
    ohlc_gateway: "OHLC_MCP" as const,
    implemented_global_adapter_count: DIAMOND_TOOL_REGISTRY.filter((x) => x.status === "ADAPTER_IMPLEMENTED_UNVERIFIED").length,
    capabilities: DIAMOND_TOOL_REGISTRY,
  };
}

export function getDiamondResearchLab() {
  return {
    schema_version: DIAMOND_CAPABILITY_SCHEMA_VERSION,
    plane: "RESEARCH_VALIDATION_LAB" as const,
    active_count: DIAMOND_RESEARCH_LAB.filter((x) => x.status === "ACTIVE_INTERNAL").length,
    candidate_count: DIAMOND_RESEARCH_LAB.filter((x) => x.status !== "ACTIVE_INTERNAL").length,
    capabilities: DIAMOND_RESEARCH_LAB,
  };
}

export function getDiamondStrategyLab() {
  return {
    schema_version: DIAMOND_CAPABILITY_SCHEMA_VERSION,
    plane: "STRATEGY_LAB" as const,
    candidate_count: DIAMOND_STRATEGY_LAB.length,
    approved_count: 0,
    production_enabled_count: 0,
    candidates: DIAMOND_STRATEGY_LAB,
  };
}

export function getDiamondArchitectureStatus() {
  return {
    schema_version: DIAMOND_CAPABILITY_SCHEMA_VERSION,
    architecture_version: DIAMOND_ARCHITECTURE_VERSION,
    product: "DIAMOND_ENGINE",
    integration_model: "PRODUCT_LEVEL_INTEGRATION_PLUS_SERVICE_LEVEL_SEPARATION",
    planes: {
      production_data_plane: "OHLC V4 / GitHub / Cloudflare / OHLC MCP",
      trading_research_plane: ["Tool Registry", "Research & Validation Lab", "Strategy Lab", "Intelligence Core", "Experiment Memory"],
      engineering_control_plane: "AI Toolbox / Skills / Agents / TDD / Review / Handoff / Sandbox / CI",
    },
    hard_boundaries: {
      ohlc_gateway: "OHLC_MCP_ONLY",
      research_ohlc_access: "READ_ONLY",
      external_direct_production_access: false,
      strategy_auto_promotion: false,
      external_bulk_import: false,
      global_adapter_formal_research: "BLOCKED_UNTIL_CROSS_VERIFIED_ARCHIVE",
    },
    counts: {
      tool_capabilities: DIAMOND_TOOL_REGISTRY.length,
      implemented_global_adapters_unverified: DIAMOND_TOOL_REGISTRY.filter((x) => x.status === "ADAPTER_IMPLEMENTED_UNVERIFIED").length,
      research_capabilities: DIAMOND_RESEARCH_LAB.length,
      strategy_candidates: DIAMOND_STRATEGY_LAB.length,
      external_projects: EXTERNAL_PROJECT_REGISTRY.length,
    },
    external_projects: EXTERNAL_PROJECT_REGISTRY,
  };
}
