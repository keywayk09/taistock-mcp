import { getDiamondArchitectureStatusP15, getDiamondResearchLabP15, getDiamondToolRegistryP15 } from "./diamond-capability-p15";
import { GPT_JUDGMENT_MEMORY_VERSION } from "./gpt-judgment-memory";

export function getDiamondToolRegistryP16() {
  const base = getDiamondToolRegistryP15();
  return {
    ...base,
    gpt_judgment_memory: {
      status: "ACTIVE_INTERNAL",
      owner: "Diamond Intelligence Core",
      version: GPT_JUDGMENT_MEMORY_VERSION,
      markets: ["TW_STOCK", "TXF"],
      data_gateway: "OHLC_MCP_ONLY_FOR_OUTCOMES",
      tools: [
        "get_gpt_judgment_memory_contract",
        "record_gpt_market_judgment",
        "get_gpt_market_judgment",
        "list_gpt_market_judgments",
        "record_gpt_judgment_review",
        "analyze_gpt_judgment_history",
        "record_gpt_trading_knowledge",
        "list_gpt_trading_knowledge",
      ],
      production_strategy_promotion: false,
    },
  };
}

export function getDiamondResearchLabP16() {
  const base = getDiamondResearchLabP15();
  const added = [
    {
      id: "gpt_judgment_ledger",
      title: "GPT Judgment Ledger",
      status: "ACTIVE_INTERNAL" as const,
      source_projects: ["keywayk09/taistock-mcp"],
      current_tool: "record_gpt_market_judgment",
      deterministic: true,
      production_strategy_promotion: false as const,
      notes: "Immutable signal-time GPT view for TW stock and TXF: direction, confidence, reason codes, structure, support/resistance, patterns and trendlines. No future anchor/pattern timestamps are accepted.",
    },
    {
      id: "trendline_pattern_memory",
      title: "Structure / Pattern / Trendline Memory",
      status: "ACTIVE_INTERNAL" as const,
      source_projects: ["keywayk09/taistock-mcp"],
      current_tool: "analyze_gpt_judgment_history",
      deterministic: true,
      production_strategy_promotion: false as const,
      notes: "Stores GPT-selected trendline anchors, touch/break/reclaim state and pattern metadata so long-run statistics can later be translated into a deterministic trendline indicator model.",
    },
    {
      id: "gpt_trading_knowledge",
      title: "GPT Trading Knowledge",
      status: "ACTIVE_INTERNAL" as const,
      source_projects: ["keywayk09/taistock-mcp"],
      current_tool: "record_gpt_trading_knowledge",
      deterministic: true,
      production_strategy_promotion: false as const,
      notes: "Versioned observations/hypotheses/validated/rejected beliefs. ACCEPTED knowledge requires explicit human approval; GPT cannot self-promote a belief into accepted knowledge or Production strategy rules.",
    },
  ];
  return {
    ...base,
    gpt_judgment_learning: {
      status: "ACTIVE_INTERNAL",
      version: GPT_JUDGMENT_MEMORY_VERSION,
      markets: ["TW_STOCK", "TXF"],
      objective: "Improve GPT trading cognition first, then translate repeatedly validated knowledge into engine-rule candidates.",
    },
    active_count: base.active_count + added.length,
    capabilities: [...base.capabilities, ...added],
  };
}

export function getDiamondArchitectureStatusP16() {
  const base = getDiamondArchitectureStatusP15();
  return {
    ...base,
    architecture_version: "diamond-architecture/2026-08-p16",
    gpt_cognition_loop: {
      status: "ACTIVE_INTERNAL",
      flow: "GPT Judgment -> immutable Judgment Ledger -> OHLC MCP frozen Outcome -> Review -> reason/pattern/trendline statistics -> Hypothesis -> Trading Knowledge -> later engine-rule candidate",
      markets: ["TW_STOCK", "TXF"],
      judgment_dimensions: ["DIRECTION", "LOCATION", "TIMING", "STRUCTURE", "PATTERN", "TRENDLINE", "RISK_REWARD", "CONFIDENCE"],
      trendline_memory: {
        anchors_structured: true,
        touch_break_reclaim_structured: true,
        normalized_slope_and_distance_supported: true,
        future_indicator_goal: "DETERMINISTIC_TRENDLINE_ENGINE_THEN_TRADINGVIEW_INDICATOR",
      },
      unit_policy: "TW_STOCK pct and TXF points are never combined into one numeric expectancy",
      accepted_knowledge_requires_human_approval: true,
      auto_strategy_change: false,
    },
    hard_boundaries: {
      ...base.hard_boundaries,
      future_anchor_or_pattern_in_judgment: "FORBIDDEN",
      overwrite_original_gpt_judgment_after_outcome: "FORBIDDEN",
      mixed_stock_pct_and_txf_point_expectancy: "FORBIDDEN",
      gpt_self_accept_knowledge: "FORBIDDEN",
      gpt_review_to_production_strategy: "FORBIDDEN",
    },
  };
}
