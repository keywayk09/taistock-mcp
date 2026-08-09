export const STRATEGY_LAB_GOVERNANCE_VERSION = "diamond-strategy-lab/v1.0.0";
export const EXTERNAL_STRATEGY_SOURCE_REPO = "ZhuLinsen/daily_stock_analysis";
export const EXTERNAL_STRATEGY_SOURCE_LICENSE = "MIT";

export type FormalizationClass =
  | "FULLY_QUANTIFIABLE_CANDIDATE"
  | "SEMI_QUANTITATIVE_CANDIDATE"
  | "RESEARCH_LLM_CANDIDATE";

export type StrategyCandidateManifest = {
  strategy_id: string;
  title: string;
  source_repo: typeof EXTERNAL_STRATEGY_SOURCE_REPO;
  source_path: string;
  source_blob_sha: string;
  source_version: string;
  source_license: typeof EXTERNAL_STRATEGY_SOURCE_LICENSE;
  formalization_class: FormalizationClass;
  candidate_status: "REGISTERED_CANDIDATE";
  taiwan_semantic_calibrated: false;
  formalized: false;
  validated_on_taiwan_market: false;
  production_enabled: false;
  permitted_use: "RESEARCH_ONLY";
  required_evidence: string[];
  formalization_recipe: string[];
};

const COMMON_EVIDENCE = Object.freeze([
  "IMMUTABLE_SOURCE_VERSION",
  "FORMALIZATION_COMPLETE",
  "TAIWAN_SEMANTIC_CALIBRATION",
  "P2_DATASET_PROVENANCE",
  "P5_OR_SWING_BACKTEST",
  "P11_WALK_FORWARD",
  "P11_BOOTSTRAP",
  "P11_MONTE_CARLO",
  "REGIME_TEST",
  "REGRESSION_PASS",
  "P8_EXPERIMENT_MEMORY",
  "HUMAN_CANDIDATE_GATE",
]);

const FULL_RULE_RECIPE = Object.freeze([
  "extract deterministic entry/exit/feature rules",
  "remove natural-language ambiguity",
  "bind every feature to a time-safe input schema",
  "define parameters with explicit versions/defaults",
  "write deterministic unit/golden tests",
]);

const SEMI_RECIPE = Object.freeze([
  "separate mechanical rules from contextual judgment",
  "formalize mechanical core first",
  "define context fields and evidence sources explicitly",
  "forbid free-form context from changing historical Signal state",
  "validate rule-only and rule-plus-context variants separately",
]);

const RESEARCH_RECIPE = Object.freeze([
  "treat as research/context skill rather than deterministic trading rule",
  "define evidence source, event time and knowledge cutoff",
  "convert any proposed trade condition into a separate versioned hypothesis",
  "never let LLM narrative itself become an executable Production rule",
  "validate extracted hypotheses through P5/P7/P11 and store them in P8",
]);

function manifest(
  strategy_id: string,
  title: string,
  source_blob_sha: string,
  formalization_class: FormalizationClass,
): StrategyCandidateManifest {
  const formalization_recipe = formalization_class === "FULLY_QUANTIFIABLE_CANDIDATE"
    ? [...FULL_RULE_RECIPE]
    : formalization_class === "SEMI_QUANTITATIVE_CANDIDATE"
      ? [...SEMI_RECIPE]
      : [...RESEARCH_RECIPE];
  return {
    strategy_id,
    title,
    source_repo: EXTERNAL_STRATEGY_SOURCE_REPO,
    source_path: `strategies/${strategy_id}.yaml`,
    source_blob_sha,
    source_version: `github-blob:${source_blob_sha}`,
    source_license: EXTERNAL_STRATEGY_SOURCE_LICENSE,
    formalization_class,
    candidate_status: "REGISTERED_CANDIDATE",
    taiwan_semantic_calibrated: false,
    formalized: false,
    validated_on_taiwan_market: false,
    production_enabled: false,
    permitted_use: "RESEARCH_ONLY",
    required_evidence: [...COMMON_EVIDENCE],
    formalization_recipe,
  };
}

export const STRATEGY_CANDIDATE_SNAPSHOT: readonly StrategyCandidateManifest[] = Object.freeze([
  manifest("bottom_volume", "Bottom Volume", "0e032928ac9580c119e7175a43b62d98d1a6a4e1", "FULLY_QUANTIFIABLE_CANDIDATE"),
  manifest("box_oscillation", "Box Oscillation", "eaa8c02db156d2eabf515e8a386d61e86c61b48b", "FULLY_QUANTIFIABLE_CANDIDATE"),
  manifest("bull_trend", "Bull Trend", "b6900db2268c81657018eaf0dc3513b62e2ef543", "SEMI_QUANTITATIVE_CANDIDATE"),
  manifest("chan_theory", "Chan Theory", "362d4692034bbfc4d338552db6c5058f0f18b4a7", "SEMI_QUANTITATIVE_CANDIDATE"),
  manifest("dragon_head", "Dragon Head", "4a1b6a84e977576c0c1c80d2d77ab13384035e77", "RESEARCH_LLM_CANDIDATE"),
  manifest("emotion_cycle", "Emotion Cycle", "668942fbecf04d2ba58b24808245ee2ebe925065", "RESEARCH_LLM_CANDIDATE"),
  manifest("event_driven", "Event Driven", "1e243e9c0a82f35a43c4cf1ace2bb1ecd67ec4ba", "RESEARCH_LLM_CANDIDATE"),
  manifest("expectation_repricing", "Expectation Repricing", "a75ee7daada54a9a08d338d6893c01b2f91642ed", "RESEARCH_LLM_CANDIDATE"),
  manifest("growth_quality", "Growth Quality", "9497741567a3daf1f9fc4c56f047f1997fa59199", "SEMI_QUANTITATIVE_CANDIDATE"),
  manifest("hot_theme", "Hot Theme", "f036b7ba2e7c133c0199b8ae0f7d6e652ba49241", "RESEARCH_LLM_CANDIDATE"),
  manifest("ma_golden_cross", "MA Golden Cross", "a9256e50a8897fbf35acd11ac3715b85febc9455", "FULLY_QUANTIFIABLE_CANDIDATE"),
  manifest("one_yang_three_yin", "One Yang Three Yin", "c561be32659f2fd8cce0c7bc6e8f3c5bf1bd8006", "SEMI_QUANTITATIVE_CANDIDATE"),
  manifest("shrink_pullback", "Shrink Pullback", "d28955fa8f7b5b3bae351e4012a15ca50c2e4e6a", "FULLY_QUANTIFIABLE_CANDIDATE"),
  manifest("volume_breakout", "Volume Breakout", "9b814c15da0bbef7d2e63da591880997d2b8eb09", "FULLY_QUANTIFIABLE_CANDIDATE"),
  manifest("wave_theory", "Wave Theory", "ab8ca43a111be5ebb21479c1fbc8d2f55506a07b", "SEMI_QUANTITATIVE_CANDIDATE"),
]);

const INDEX = new Map(STRATEGY_CANDIDATE_SNAPSHOT.map((item) => [item.strategy_id, item]));

export class StrategyLabGovernanceError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "StrategyLabGovernanceError";
    this.code = code;
    this.detail = detail;
  }
}

export function getStrategyCandidate(strategyId: string) {
  const strategy_id = String(strategyId ?? "").trim();
  const item = INDEX.get(strategy_id);
  if (!item) throw new StrategyLabGovernanceError("STRATEGY_NOT_FOUND", "unknown Strategy Lab candidate", { strategy_id });
  return item;
}

export function listStrategyCandidates(formalizationClass?: FormalizationClass) {
  const candidates = formalizationClass
    ? STRATEGY_CANDIDATE_SNAPSHOT.filter((item) => item.formalization_class === formalizationClass)
    : [...STRATEGY_CANDIDATE_SNAPSHOT];
  return {
    ok: true as const,
    governance_version: STRATEGY_LAB_GOVERNANCE_VERSION,
    source_repo: EXTERNAL_STRATEGY_SOURCE_REPO,
    source_license: EXTERNAL_STRATEGY_SOURCE_LICENSE,
    snapshot_count: STRATEGY_CANDIDATE_SNAPSHOT.length,
    returned: candidates.length,
    candidates,
    production_enabled_count: 0,
  };
}

export function buildStrategyValidationPlan(strategyId: string) {
  const candidate = getStrategyCandidate(strategyId);
  const research_mode = candidate.formalization_class === "FULLY_QUANTIFIABLE_CANDIDATE"
    ? "DETERMINISTIC_RULE_FORMALIZATION"
    : candidate.formalization_class === "SEMI_QUANTITATIVE_CANDIDATE"
      ? "RULE_PLUS_CONTEXT_SEPARATION"
      : "RESEARCH_CONTEXT_TO_HYPOTHESIS";
  return {
    ok: true as const,
    governance_version: STRATEGY_LAB_GOVERNANCE_VERSION,
    strategy_id: candidate.strategy_id,
    source_version: candidate.source_version,
    formalization_class: candidate.formalization_class,
    research_mode,
    steps: [
      { order:1, stage:"SOURCE_AUDIT", requirement:"verify immutable external source version and license" },
      { order:2, stage:"FORMALIZATION", requirement:candidate.formalization_recipe.join("; ") },
      { order:3, stage:"TAIWAN_SEMANTIC_CALIBRATION", requirement:"map market/session/price-limit/volume/context semantics without changing source history" },
      { order:4, stage:"DATA_MAPPING", requirement:"map every feature to OHLC MCP or governed Research Data Gateway with knowledge cutoff" },
      { order:5, stage:"BACKTEST", requirement:"use P5 intraday batch and/or P7 Swing Outcome according to strategy horizon" },
      { order:6, stage:"ROBUSTNESS", requirement:"use P11 Walk-Forward + Bootstrap + Monte Carlo and explicit Regime tests" },
      { order:7, stage:"MEMORY", requirement:"record successful and failed evidence in P8 Experiment Memory" },
      { order:8, stage:"REGRESSION", requirement:"Golden/regression tests must pass after implementation changes" },
      { order:9, stage:"CANDIDATE_GATE", requirement:"human/system gate may mark Candidate only" },
    ],
    production_promotion:"FORBIDDEN" as const,
  };
}

export type StrategyCandidateEvidence = {
  strategy_id: string;
  source_version: string;
  formalization_complete: boolean;
  taiwan_semantic_calibrated: boolean;
  time_safe_data_mapping: boolean;
  dataset_versions: string[];
  backtest_run_ids: string[];
  walk_forward_run_id?: string | null;
  bootstrap_run_id?: string | null;
  monte_carlo_run_id?: string | null;
  regime_tested: boolean;
  regression_passed: boolean;
  experiment_versions: string[];
  human_candidate_approved: boolean;
};

function nonEmptyStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

export function evaluateStrategyCandidateGate(raw: StrategyCandidateEvidence) {
  const candidate = getStrategyCandidate(raw?.strategy_id);
  const sourceVersion = String(raw?.source_version ?? "").trim();
  if (sourceVersion !== candidate.source_version) {
    throw new StrategyLabGovernanceError("SOURCE_VERSION_MISMATCH", "evidence source_version does not match the registered candidate snapshot", {
      expected: candidate.source_version,
      received: sourceVersion || null,
    });
  }
  const datasetVersions = nonEmptyStrings(raw?.dataset_versions);
  const backtestRunIds = nonEmptyStrings(raw?.backtest_run_ids);
  const experimentVersions = nonEmptyStrings(raw?.experiment_versions);
  const checks = [
    ["FORMALIZATION_COMPLETE", raw?.formalization_complete === true],
    ["TAIWAN_SEMANTIC_CALIBRATION", raw?.taiwan_semantic_calibrated === true],
    ["TIME_SAFE_DATA_MAPPING", raw?.time_safe_data_mapping === true],
    ["DATASET_PROVENANCE", datasetVersions.length > 0 && datasetVersions.every((v) => /^sha256:[0-9a-f]{64}$/.test(v))],
    ["BACKTEST_EVIDENCE", backtestRunIds.length > 0],
    ["WALK_FORWARD_EVIDENCE", !!String(raw?.walk_forward_run_id ?? "").trim()],
    ["BOOTSTRAP_EVIDENCE", !!String(raw?.bootstrap_run_id ?? "").trim()],
    ["MONTE_CARLO_EVIDENCE", !!String(raw?.monte_carlo_run_id ?? "").trim()],
    ["REGIME_TEST", raw?.regime_tested === true],
    ["REGRESSION_PASS", raw?.regression_passed === true],
    ["EXPERIMENT_MEMORY", experimentVersions.length > 0 && experimentVersions.every((v) => /^sha256:[0-9a-f]{64}$/.test(v))],
    ["HUMAN_CANDIDATE_GATE", raw?.human_candidate_approved === true],
  ] as const;
  const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
  const eligible = failed.length === 0;
  return {
    ok:true as const,
    governance_version:STRATEGY_LAB_GOVERNANCE_VERSION,
    strategy_id:candidate.strategy_id,
    source_version:candidate.source_version,
    formalization_class:candidate.formalization_class,
    gate_status:eligible ? "CANDIDATE_ELIGIBLE" as const : "VALIDATION_INCOMPLETE" as const,
    candidate_eligible:eligible,
    failed_requirements:failed,
    passed_requirements:checks.filter(([, passed]) => passed).map(([name]) => name),
    evidence_summary:{
      dataset_versions:datasetVersions,
      backtest_run_ids:backtestRunIds,
      walk_forward_run_id:String(raw?.walk_forward_run_id ?? "").trim() || null,
      bootstrap_run_id:String(raw?.bootstrap_run_id ?? "").trim() || null,
      monte_carlo_run_id:String(raw?.monte_carlo_run_id ?? "").trim() || null,
      experiment_versions:experimentVersions,
    },
    permitted_transition:eligible ? "MARK_CANDIDATE_ONLY" as const : "KEEP_RESEARCH" as const,
    production_promotion:"FORBIDDEN" as const,
  };
}
