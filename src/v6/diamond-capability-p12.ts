import { getDiamondStrategyLab as getBaseStrategyLab } from "./diamond-capability-registry.ts";
import { getDiamondArchitectureStatusP11 } from "./diamond-capability-p11.ts";
import { STRATEGY_CANDIDATE_SNAPSHOT, STRATEGY_LAB_GOVERNANCE_VERSION } from "./strategy-lab-governance.ts";

export function getDiamondStrategyLabP12() {
  const base = getBaseStrategyLab();
  const manifestById = new Map(STRATEGY_CANDIDATE_SNAPSHOT.map((item) => [item.strategy_id, item]));
  const candidates = base.candidates.map((candidate) => {
    const manifest = manifestById.get(candidate.id);
    return {
      ...candidate,
      source_version: manifest?.source_version ?? null,
      source_blob_sha: manifest?.source_blob_sha ?? null,
      source_license: manifest?.source_license ?? null,
      governance_status: manifest ? "REGISTERED_CANDIDATE" as const : "UNREGISTERED",
      taiwan_semantic_calibrated: false,
      formalized: false,
      validated_on_taiwan_market: false,
      production_enabled: false,
      permitted_use: "RESEARCH_ONLY" as const,
    };
  });
  return {
    ...base,
    governance_version: STRATEGY_LAB_GOVERNANCE_VERSION,
    governance_status: "ACTIVE_INTERNAL" as const,
    source_snapshot_locked: true,
    source_license: "MIT",
    registered_candidate_count: candidates.filter((item) => item.governance_status === "REGISTERED_CANDIDATE").length,
    formalized_count: 0,
    validated_count: 0,
    approved_count: 0,
    production_enabled_count: 0,
    governance_tools: [
      "list_strategy_lab_candidates",
      "get_strategy_lab_candidate",
      "build_strategy_validation_plan",
      "evaluate_strategy_candidate_gate",
    ],
    candidates,
  };
}

export function getDiamondArchitectureStatusP12() {
  const base = getDiamondArchitectureStatusP11();
  return {
    ...base,
    architecture_version: "diamond-architecture/2026-08-p12",
    strategy_lab_governance: {
      status: "ACTIVE_INTERNAL",
      governance_version: STRATEGY_LAB_GOVERNANCE_VERSION,
      registered_candidates: STRATEGY_CANDIDATE_SNAPSHOT.length,
      source_repo: "ZhuLinsen/daily_stock_analysis",
      source_license: "MIT",
      immutable_source_snapshot: true,
      formalized_count: 0,
      validated_on_taiwan_count: 0,
      production_enabled_count: 0,
      candidate_gate_target: "CANDIDATE_ONLY",
      production_strategy_promotion: false,
    },
  };
}
