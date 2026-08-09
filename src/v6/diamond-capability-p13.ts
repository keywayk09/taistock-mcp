import { getDiamondToolRegistry } from "./diamond-capability-registry";
import { getDiamondArchitectureStatusP12 } from "./diamond-capability-p12";
import { SUPPLY_CHAIN_CROSS_VERIFY_VERSION } from "./supply-chain-cross-verification";
import { SUPPLY_CHAIN_DATA_PLANE_VERSION } from "./supply-chain-data-plane";
import { SUPPLY_CHAIN_GRAPH_VERSION } from "./supply-chain-graph";
import { SUPPLY_CHAIN_OFFICIAL_SOURCE_VERSION } from "./supply-chain-official-source";

const SUPPLY_CHAIN_CAPABILITY = Object.freeze({
  id: "cross_market_supply_chain",
  title: "Cross-market Supply Chain / 跨市場供應鏈圖譜",
  category: "RESEARCH_DATA" as const,
  status: "ACTIVE_INTERNAL" as const,
  owner: "Diamond Research Data Plane",
  source_projects: ["keywayk09/taistock-mcp"],
  markets: ["TW_STOCK","US_STOCK","US_ETF","HK_STOCK","CN_STOCK","JP_STOCK","KR_STOCK","PRIVATE","OTHER"],
  gateway: "SUPPLY_CHAIN_EVIDENCE_GATE",
  current_tool: "query_archived_supply_chain",
  implementation_version: `${SUPPLY_CHAIN_GRAPH_VERSION} / ${SUPPLY_CHAIN_DATA_PLANE_VERSION}`,
  runtime_configuration: "INTERNAL" as const,
  formal_research_eligible: false,
  direct_provider_access: false as const,
  read_only_research: true,
  production_write: false as const,
  notes: "P13/P13b entity-first graph, guarded official evidence intake, deterministic cross-verification, and immutable D1/R2 archive are active. Formal eligibility remains dataset-specific; no LLM/provider relationship is trusted automatically and nothing writes OHLC.",
});

export function getDiamondToolRegistryP13() {
  const base = getDiamondToolRegistry();
  return {
    ...base,
    supply_chain_graph: {
      status: "ACTIVE_INTERNAL" as const,
      graph_level: "LEGAL_ENTITY_WITH_INSTRUMENT_MAPPING",
      verification_gateway: "SUPPLY_CHAIN_EVIDENCE_GATE",
      data_population: "GUARDED_OFFICIAL_EVIDENCE_TO_VERSIONED_ARCHIVE",
      official_source_adapter: SUPPLY_CHAIN_OFFICIAL_SOURCE_VERSION,
      cross_verification_engine: SUPPLY_CHAIN_CROSS_VERIFY_VERSION,
      archive_plane: "RESEARCH_DB_INDEX_PLUS_R2_IMMUTABLE_SNAPSHOT",
      default_candidate_edges_excluded: true,
      formal_research_eligibility: "PER_SNAPSHOT",
      archive_human_gate: true,
      read_hash_revalidation: true,
    },
    capabilities: [...base.capabilities, SUPPLY_CHAIN_CAPABILITY],
  };
}

export function getDiamondArchitectureStatusP13() {
  const base = getDiamondArchitectureStatusP12();
  return {
    ...base,
    architecture_version: "diamond-architecture/2026-08-p13b",
    supply_chain_intelligence: {
      status: "ACTIVE_INTERNAL",
      engine_version: SUPPLY_CHAIN_GRAPH_VERSION,
      data_plane_version: SUPPLY_CHAIN_DATA_PLANE_VERSION,
      official_source_version: SUPPLY_CHAIN_OFFICIAL_SOURCE_VERSION,
      cross_verification_version: SUPPLY_CHAIN_CROSS_VERIFY_VERSION,
      scope: "TAIWAN_AND_OVERSEAS_INSTRUMENTS_ON_SHARED_ENTITY_GRAPH",
      tools: [
        "get_supply_chain_contract","validate_supply_chain_snapshot","query_supply_chain_graph",
        "get_supply_chain_official_source_contract","fetch_official_supply_chain_evidence",
        "cross_verify_supply_chain_edges","archive_supply_chain_snapshot","find_supply_chain_datasets",
        "get_archived_supply_chain_snapshot","query_archived_supply_chain",
      ],
      truth_model: "EVIDENCE_BACKED_TIME_SAFE_VERSIONED_SNAPSHOT",
      source_model: "SEC_OR_MOPS_ALLOWLISTED_OFFICIAL_EVIDENCE_PLUS_REVIEWED_SECONDARY_EVIDENCE",
      cross_verification_model: "PRIMARY_SOURCE_AND_INDEPENDENT_SOURCE_COUNT",
      archive_model: "D1_INDEX_PLUS_R2_IMMUTABLE_PAYLOAD",
      entity_first: true,
      cross_market_instrument_mapping: true,
      llm_can_verify_edges: false,
      direct_provider_trust: false,
      archive_requires_human_approval: true,
      archive_revalidates_hash_on_read: true,
      production_write: false,
      strategy_auto_promotion: false,
    },
    hard_boundaries: {
      ...base.hard_boundaries,
      supply_chain_truth: "VERIFIED_VERSIONED_SNAPSHOT_ONLY",
      supply_chain_llm_suggestion: "CANDIDATE_ONLY",
      supply_chain_future_knowledge: "FORBIDDEN",
      supply_chain_official_fetch: "HTTPS_GET_ALLOWLIST_ONLY_NO_REDIRECT",
      supply_chain_archive_mutability: "APPEND_ONLY",
      supply_chain_archive_human_gate: "REQUIRED",
      supply_chain_ohlc_write: "FORBIDDEN",
    },
    counts: {
      ...base.counts,
      tool_capabilities: base.counts.tool_capabilities + 1,
      supply_chain_capabilities: 1,
      supply_chain_tools: 10,
    },
  };
}
