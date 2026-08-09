import {
  getDiamondArchitectureStatus as getBaseArchitectureStatus,
  getDiamondResearchLab as getBaseResearchLab,
} from "./diamond-capability-registry.ts";

const P11_ACTIVE = Object.freeze({
  walk_forward: {
    current_tool: "run_walk_forward_validation",
    deterministic: true,
    notes: "P11 fixed-window no-lookahead candidate selection: each fold selects on Train only, then evaluates on the following Test window.",
  },
  bootstrap: {
    current_tool: "run_bootstrap_validation",
    deterministic: true,
    notes: "P11 seeded bootstrap resampling for expectancy/PF/compounded-return robustness distributions.",
  },
  monte_carlo: {
    current_tool: "run_monte_carlo_validation",
    deterministic: true,
    notes: "P11 seeded return-sequence permutation for drawdown and losing-streak path risk distributions.",
  },
} as const);

export function getDiamondResearchLabP11() {
  const base = getBaseResearchLab();
  const capabilities = base.capabilities.map((capability) => {
    const implementation = P11_ACTIVE[capability.id as keyof typeof P11_ACTIVE];
    if (!implementation) return capability;
    return {
      ...capability,
      status: "ACTIVE_INTERNAL" as const,
      source_projects: ["keywayk09/taistock-mcp", "HKUDS/Vibe-Trading"],
      current_tool: implementation.current_tool,
      deterministic: implementation.deterministic,
      production_strategy_promotion: false as const,
      notes: `${implementation.notes} Adapted as original Diamond implementation; external methodology is not bulk-imported.`,
    };
  });
  return {
    ...base,
    active_count: capabilities.filter((x) => x.status === "ACTIVE_INTERNAL").length,
    candidate_count: capabilities.filter((x) => x.status !== "ACTIVE_INTERNAL").length,
    validation_suite_tool: "run_research_validation_suite",
    p11_active_ids: Object.keys(P11_ACTIVE),
    capabilities,
  };
}

export function getDiamondArchitectureStatusP11() {
  const base = getBaseArchitectureStatus();
  return {
    ...base,
    architecture_version: "diamond-architecture/2026-08-p11",
    research_validation: {
      status: "ACTIVE_INTERNAL",
      engine_version: "diamond-validation/v1.0.0",
      tools: [
        "run_walk_forward_validation",
        "run_bootstrap_validation",
        "run_monte_carlo_validation",
        "run_research_validation_suite",
      ],
      deterministic_randomness: "EXPLICIT_OR_CONTENT_DERIVED_SEED",
      no_lookahead_walk_forward: true,
      production_strategy_promotion: false,
    },
  };
}
