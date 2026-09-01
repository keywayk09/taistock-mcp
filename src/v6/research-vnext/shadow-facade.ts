import {
  summarizeReviewMetrics,
  type ReviewMetricInputRow,
} from "./compute/review-metrics.ts";
import {
  rankSwingCandidateEvidence,
  summarizeSwingOutcomeEvidence,
  type SwingEvidenceSignal,
} from "./compute/swing-evidence.ts";
import { resolveAmbiguousBacktestEvidenceWith1m } from "./compute/selective-1m-replay.ts";
import {
  createResearchVNextGitHubMemoryAdapter,
  type ResearchVNextGitHubMemoryAdapterOptions,
} from "./memory/github-memory-adapter.ts";

export const RESEARCH_VNEXT_SHADOW_FACADE_VERSION =
  "research-vnext-shadow-facade/v1.0.0" as const;

export type ResearchVNextShadowFacadeOptions = {
  memoryAdapterOptions?: ResearchVNextGitHubMemoryAdapterOptions;
};

export function createResearchVNextShadowFacade(
  options: ResearchVNextShadowFacadeOptions = {},
) {
  const memory = createResearchVNextGitHubMemoryAdapter(options.memoryAdapterOptions);

  return {
    contract() {
      return {
        schema: "RESEARCH_VNEXT_SHADOW_FACADE_CONTRACT_V1" as const,
        version: RESEARCH_VNEXT_SHADOW_FACADE_VERSION,
        reasoning_owner: "GPT" as const,
        backend_roles: ["DATA", "COMPUTE", "REPLAY", "EVIDENCE", "MEMORY"] as const,
        direct_provider_access: "FORBIDDEN" as const,
        ohlc_write: "FORBIDDEN" as const,
        automatic_strategy_promotion: "FORBIDDEN" as const,
        production_registration: "DISABLED" as const,
      };
    },

    summarizeReviewEvidence(rows: ReviewMetricInputRow[]) {
      return summarizeReviewMetrics(rows);
    },

    rankSwingEvidence(signals: SwingEvidenceSignal[], limit = 10) {
      return rankSwingCandidateEvidence(signals, limit);
    },

    summarizeSwingOutcomes(results: Array<Record<string, unknown>>) {
      return summarizeSwingOutcomeEvidence(results);
    },

    resolveSelective1mReplay: resolveAmbiguousBacktestEvidenceWith1m,

    memory,
  };
}
