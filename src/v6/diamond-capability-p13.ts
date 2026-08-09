import { getDiamondToolRegistry } from "./diamond-capability-registry";
import { getDiamondArchitectureStatusP12 } from "./diamond-capability-p12";
import { SUPPLY_CHAIN_GRAPH_VERSION } from "./supply-chain-graph";

const SUPPLY_CHAIN_CAPABILITY = Object.freeze({
  id: "cross_market_supply_chain",
  title: "Cross-market Supply Chain / 跨市場供應鏈圖譜",
  category: "RESEARCH_DATA" as const,
  status: "ACTIVE_INTERNAL" as const,
  owner: "Diamond Research Data Plane",
  source_projects: ["keywayk09/taistock-mcp"],
  markets: ["TW_STOCK","US_STOCK","US_ETF","HK_STOCK","CN_STOCK","JP_STOCK","KR_STOCK","PRIVATE","OTHER"],
  gateway: "SUPPLY_CHAIN_EVIDENCE_GATE",
  current_tool: "query_supply_chain_graph",
  implementation_version: SUPPLY_CHAIN_GRAPH_VERSION,
  runtime_configuration: "INTERNAL" as const,
  formal_research_eligible: false,
  direct_provider_access: false as const,
  read_only_research: true,
  production_write: false as const,
  notes: "P13 graph contract is active. Company/legal-entity nodes are mapped to market instruments so Taiwan and overseas tickers can share one supply-chain graph. Formal research eligibility is snapshot-specific and requires time-safe evidence plus verified/corroborated edges with primary-source support; no external provider or LLM suggestion is trusted automatically.",
});

export function getDiamondToolRegistryP13() {
  const base = getDiamondToolRegistry();
  return {
    ...base,
    supply_chain_graph: {
      status: "ACTIVE_INTERNAL" as const,
      graph_level: "LEGAL_ENTITY_WITH_INSTRUMENT_MAPPING",
      verification_gateway: "SUPPLY_CHAIN_EVIDENCE_GATE",
      data_population: "EVIDENCE_SNAPSHOT_REQUIRED",
      default_candidate_edges_excluded: true,
      formal_research_eligibility: "PER_SNAPSHOT",
    },
    capabilities: [...base.capabilities, SUPPLY_CHAIN_CAPABILITY],
  };
}

export function getDiamondArchitectureStatusP13() {
  const base = getDiamondArchitectureStatusP12();
  return {
    ...base,
    architecture_version: "diamond-architecture/2026-08-p13",
    supply_chain_intelligence: {
      status: "ACTIVE_INTERNAL",
      engine_version: SUPPLY_CHAIN_GRAPH_VERSION,
      scope: "TAIWAN_AND_OVERSEAS_INSTRUMENTS_ON_SHARED_ENTITY_GRAPH",
      tools: ["get_supply_chain_contract","validate_supply_chain_snapshot","query_supply_chain_graph"],
      truth_model: "EVIDENCE_BACKED_TIME_SAFE_VERSIONED_SNAPSHOT",
      entity_first: true,
      cross_market_instrument_mapping: true,
      llm_can_verify_edges: false,
      direct_provider_trust: false,
      production_write: false,
      strategy_auto_promotion: false,
    },
    hard_boundaries: {
      ...base.hard_boundaries,
      supply_chain_truth: "VERIFIED_SNAPSHOT_ONLY",
      supply_chain_llm_suggestion: "CANDIDATE_ONLY",
      supply_chain_future_knowledge: "FORBIDDEN",
    },
    counts: {
      ...base.counts,
      tool_capabilities: base.counts.tool_capabilities + 1,
      supply_chain_capabilities: 1,
    },
  };
}
