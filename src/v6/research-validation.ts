export const RESEARCH_VALIDATION_ENGINE_VERSION = "diamond-validation/v1.0.0";
export const WALK_FORWARD_SCHEMA_VERSION = "diamond-walk-forward/v1";
export const BOOTSTRAP_SCHEMA_VERSION = "diamond-bootstrap/v1";
export const MONTE_CARLO_SCHEMA_VERSION = "diamond-monte-carlo/v1";
export const VALIDATION_SUITE_SCHEMA_VERSION = "diamond-validation-suite/v1";

export type ValidationTrade = {
  case_id: string;
  trade_date: string;
  net_return_pct: number;
};

export type StrategyCandidateRun = {
  candidate_id: string;
  parameter_version: string;
  strategy_version?: string;
  trades: ValidationTrade[];
};

export type ValidationMetrics = {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: number;
  expectancy_pct: number;
  median_return_pct: number;
  gross_profit_pct: number;
  gross_loss_abs_pct: number;
  profit_factor: number | null;
  compounded_return_pct: number;
  max_drawdown_pct: number;
  longest_losing_streak: number;
};

export class ResearchValidationError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ResearchValidationError";
    this.code = code;
    this.detail = detail;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableValue(source[key]);
    return out;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function finite(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ResearchValidationError("INVALID_INPUT", `${field} must be finite`);
  return number;
}

function requireDate(value: unknown, field: string): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ResearchValidationError("INVALID_INPUT", `${field} must be YYYY-MM-DD`);
  return date;
}

function requireText(value: unknown, field: string, max = 240): string {
  const text = String(value ?? "").trim();
  if (!text) throw new ResearchValidationError("INVALID_INPUT", `${field} is required`);
  if (text.length > max) throw new ResearchValidationError("INVALID_INPUT", `${field} is too long`);
  return text;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * p));
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function compoundedReturnPct(returns: number[]): number {
  let equity = 1;
  for (const value of returns) equity *= 1 + value / 100;
  return (equity - 1) * 100;
}

function maxDrawdownPct(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? (peak - equity) / peak * 100 : 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  return maxDrawdown;
}

function longestLosingStreak(returns: number[]): number {
  let current = 0;
  let longest = 0;
  for (const value of returns) {
    current = value < 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function summarizeValidationReturns(returns: number[]): ValidationMetrics {
  const values = returns.map((value, index) => finite(value, `returns[${index}]`));
  const gains = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const grossProfit = gains.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    count: values.length,
    wins: gains.length,
    losses: losses.length,
    breakeven: values.length - gains.length - losses.length,
    win_rate: round(values.length ? gains.length / values.length : 0),
    expectancy_pct: round(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0),
    median_return_pct: round(median(values)),
    gross_profit_pct: round(grossProfit),
    gross_loss_abs_pct: round(grossLoss),
    profit_factor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    compounded_return_pct: round(compoundedReturnPct(values)),
    max_drawdown_pct: round(maxDrawdownPct(values)),
    longest_losing_streak: longestLosingStreak(values),
  };
}

function canonicalTrades(trades: ValidationTrade[], label: string): ValidationTrade[] {
  if (!Array.isArray(trades) || !trades.length) throw new ResearchValidationError("TRADES_REQUIRED", `${label}.trades must not be empty`);
  const seen = new Set<string>();
  const normalized = trades.map((trade, index) => {
    const case_id = requireText(trade?.case_id, `${label}.trades[${index}].case_id`);
    const trade_date = requireDate(trade?.trade_date, `${label}.trades[${index}].trade_date`);
    const net_return_pct = finite(trade?.net_return_pct, `${label}.trades[${index}].net_return_pct`);
    if (net_return_pct <= -100) throw new ResearchValidationError("INVALID_INPUT", "net_return_pct must be > -100", { case_id });
    if (seen.has(case_id)) throw new ResearchValidationError("DUPLICATE_CASE", `${label} contains duplicate case_id`, { case_id });
    seen.add(case_id);
    return { case_id, trade_date, net_return_pct };
  });
  return normalized.sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.case_id.localeCompare(b.case_id));
}

function canonicalCandidate(candidate: StrategyCandidateRun, index: number): StrategyCandidateRun {
  const candidate_id = requireText(candidate?.candidate_id, `candidates[${index}].candidate_id`);
  const parameter_version = requireText(candidate?.parameter_version, `candidates[${index}].parameter_version`, 160);
  const strategy_version = candidate?.strategy_version ? requireText(candidate.strategy_version, `candidates[${index}].strategy_version`, 160) : undefined;
  return { candidate_id, parameter_version, strategy_version, trades: canonicalTrades(candidate?.trades, `candidates[${index}]`) };
}

function assertAlignedCandidates(candidates: StrategyCandidateRun[]) {
  if (!candidates.length) throw new ResearchValidationError("CANDIDATES_REQUIRED", "at least one candidate is required");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.candidate_id)) throw new ResearchValidationError("DUPLICATE_CANDIDATE", "candidate_id must be unique", { candidate_id: candidate.candidate_id });
    ids.add(candidate.candidate_id);
  }
  const baseline = candidates[0].trades.map((trade) => `${trade.case_id}\u0000${trade.trade_date}`);
  for (const candidate of candidates.slice(1)) {
    const keys = candidate.trades.map((trade) => `${trade.case_id}\u0000${trade.trade_date}`);
    if (keys.length !== baseline.length || keys.some((key, index) => key !== baseline[index])) {
      throw new ResearchValidationError("CANDIDATE_CASESET_MISMATCH", "all walk-forward candidates must contain the exact same chronological case set", { candidate_id: candidate.candidate_id });
    }
  }
}

function selectionScore(metrics: ValidationMetrics, metric: "expectancy_pct" | "profit_factor"): number {
  if (metric === "expectancy_pct") return metrics.expectancy_pct;
  if (metrics.profit_factor !== null) return metrics.profit_factor;
  return metrics.gross_profit_pct > 0 ? Number.MAX_SAFE_INTEGER : 0;
}

export async function runWalkForwardValidation(input: {
  candidates: StrategyCandidateRun[];
  train_size: number;
  test_size: number;
  step_size?: number;
  selection_metric?: "expectancy_pct" | "profit_factor";
}) {
  const candidates = (input?.candidates ?? []).map(canonicalCandidate);
  assertAlignedCandidates(candidates);
  const total = candidates[0].trades.length;
  const trainSize = Math.floor(finite(input?.train_size, "train_size"));
  const testSize = Math.floor(finite(input?.test_size, "test_size"));
  const stepSize = Math.floor(finite(input?.step_size ?? testSize, "step_size"));
  if (trainSize < 5 || testSize < 1 || stepSize < 1) throw new ResearchValidationError("INVALID_WINDOW", "train_size>=5, test_size>=1 and step_size>=1 are required");
  if (trainSize + testSize > total) throw new ResearchValidationError("INSUFFICIENT_CASES", "not enough cases for one walk-forward fold", { total, train_size:trainSize, test_size:testSize });
  const selectionMetric = input?.selection_metric ?? "expectancy_pct";
  const folds = [] as Array<Record<string, unknown>>;
  const oosReturns: number[] = [];
  const selectionCounts = new Map<string, number>();

  for (let start = 0, foldIndex = 0; start + trainSize + testSize <= total; start += stepSize, foldIndex += 1) {
    const trainEnd = start + trainSize;
    const testEnd = trainEnd + testSize;
    const scored = candidates.map((candidate) => {
      const metrics = summarizeValidationReturns(candidate.trades.slice(start, trainEnd).map((trade) => trade.net_return_pct));
      return { candidate, metrics, score:selectionScore(metrics, selectionMetric) };
    }).sort((a, b) => b.score - a.score || a.candidate.candidate_id.localeCompare(b.candidate.candidate_id) || a.candidate.parameter_version.localeCompare(b.candidate.parameter_version));
    const selected = scored[0].candidate;
    const testTrades = selected.trades.slice(trainEnd, testEnd);
    const testMetrics = summarizeValidationReturns(testTrades.map((trade) => trade.net_return_pct));
    oosReturns.push(...testTrades.map((trade) => trade.net_return_pct));
    selectionCounts.set(selected.candidate_id, (selectionCounts.get(selected.candidate_id) ?? 0) + 1);
    folds.push({
      fold_index: foldIndex + 1,
      train_start: selected.trades[start].trade_date,
      train_end: selected.trades[trainEnd - 1].trade_date,
      test_start: testTrades[0].trade_date,
      test_end: testTrades.at(-1)?.trade_date,
      train_count: trainSize,
      test_count: testSize,
      selected_candidate_id: selected.candidate_id,
      selected_parameter_version: selected.parameter_version,
      selection_metric: selectionMetric,
      selected_train_metrics: scored[0].metrics,
      test_metrics: testMetrics,
      test_case_ids: testTrades.map((trade) => trade.case_id),
    });
  }

  if (!folds.length) throw new ResearchValidationError("NO_WALK_FORWARD_FOLDS", "walk-forward produced no folds");
  const fingerprint = {
    schema_version: WALK_FORWARD_SCHEMA_VERSION,
    engine_version: RESEARCH_VALIDATION_ENGINE_VERSION,
    train_size: trainSize,
    test_size: testSize,
    step_size: stepSize,
    selection_metric: selectionMetric,
    candidates,
  };
  const hash = await sha256Hex(stableJson(fingerprint));
  const mostSelected = Array.from(selectionCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    ok: true as const,
    deterministic: true as const,
    schema_version: WALK_FORWARD_SCHEMA_VERSION,
    engine_version: RESEARCH_VALIDATION_ENGINE_VERSION,
    validation_run_id: `wf:${hash}`,
    no_lookahead: true as const,
    candidate_count: candidates.length,
    total_case_count: total,
    fold_count: folds.length,
    selection_metric: selectionMetric,
    train_size: trainSize,
    test_size: testSize,
    step_size: stepSize,
    oos_metrics: summarizeValidationReturns(oosReturns),
    selection_counts: Object.fromEntries(Array.from(selectionCounts.entries()).sort(([a], [b]) => a.localeCompare(b))),
    most_selected_candidate_id: mostSelected?.[0] ?? null,
    most_selected_fold_count: mostSelected?.[1] ?? 0,
    folds,
    production_promotion: "FORBIDDEN" as const,
  };
}

function seedFromHash(hash: string): number {
  const seed = Number.parseInt(hash.slice(0, 8), 16) >>> 0;
  return seed || 0x6d2b79f5;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function resolveSeed(kind: string, trades: ValidationTrade[], seed?: string) {
  const seedMaterial = seed?.trim() || `${kind}:${stableJson(trades)}`;
  const seedHash = await sha256Hex(seedMaterial);
  return { seed_material: seedMaterial, seed_hash: seedHash, seed_int: seedFromHash(seedHash) };
}

function validateIterations(value: unknown, fallback: number) {
  const iterations = Math.floor(finite(value ?? fallback, "iterations"));
  if (iterations < 100 || iterations > 5000) throw new ResearchValidationError("INVALID_ITERATIONS", "iterations must be 100..5000");
  return iterations;
}

function distribution(values: number[]) {
  return {
    min: round(Math.min(...values)),
    p05: round(percentile(values, 0.05)),
    p25: round(percentile(values, 0.25)),
    p50: round(percentile(values, 0.50)),
    p75: round(percentile(values, 0.75)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(...values)),
  };
}

export async function runBootstrapValidation(input: {
  trades: ValidationTrade[];
  iterations?: number;
  seed?: string;
}) {
  const trades = canonicalTrades(input?.trades, "bootstrap");
  const iterations = validateIterations(input?.iterations, 1000);
  const seed = await resolveSeed("bootstrap", trades, input?.seed);
  const random = mulberry32(seed.seed_int);
  const expectancy: number[] = [];
  const profitFactor: number[] = [];
  const compounded: number[] = [];
  let expectancyPositive = 0;
  let profitFactorAboveOne = 0;
  for (let i = 0; i < iterations; i += 1) {
    const sample = Array.from({ length: trades.length }, () => trades[Math.floor(random() * trades.length)].net_return_pct);
    const metrics = summarizeValidationReturns(sample);
    expectancy.push(metrics.expectancy_pct);
    compounded.push(metrics.compounded_return_pct);
    const pf = metrics.profit_factor ?? (metrics.gross_profit_pct > 0 ? 1e9 : 0);
    profitFactor.push(pf);
    if (metrics.expectancy_pct > 0) expectancyPositive += 1;
    if (pf > 1) profitFactorAboveOne += 1;
  }
  const fingerprint = { schema_version:BOOTSTRAP_SCHEMA_VERSION, engine_version:RESEARCH_VALIDATION_ENGINE_VERSION, trades, iterations, seed_hash:seed.seed_hash };
  const hash = await sha256Hex(stableJson(fingerprint));
  return {
    ok: true as const,
    deterministic: true as const,
    schema_version: BOOTSTRAP_SCHEMA_VERSION,
    engine_version: RESEARCH_VALIDATION_ENGINE_VERSION,
    validation_run_id: `bootstrap:${hash}`,
    iterations,
    seed_hash: seed.seed_hash,
    original_metrics: summarizeValidationReturns(trades.map((trade) => trade.net_return_pct)),
    expectancy_pct_distribution: distribution(expectancy),
    profit_factor_distribution: distribution(profitFactor.map((value) => Math.min(value, 1e6))),
    compounded_return_pct_distribution: distribution(compounded),
    probability_expectancy_positive: round(expectancyPositive / iterations),
    probability_profit_factor_above_1: round(profitFactorAboveOne / iterations),
    production_promotion: "FORBIDDEN" as const,
  };
}

function shuffled(values: number[], random: () => number) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function runMonteCarloValidation(input: {
  trades: ValidationTrade[];
  iterations?: number;
  seed?: string;
}) {
  const trades = canonicalTrades(input?.trades, "monte_carlo");
  const iterations = validateIterations(input?.iterations, 1000);
  const seed = await resolveSeed("monte_carlo", trades, input?.seed);
  const random = mulberry32(seed.seed_int);
  const baseReturns = trades.map((trade) => trade.net_return_pct);
  const drawdowns: number[] = [];
  const losingStreaks: number[] = [];
  const compounded: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const sequence = shuffled(baseReturns, random);
    drawdowns.push(maxDrawdownPct(sequence));
    losingStreaks.push(longestLosingStreak(sequence));
    compounded.push(compoundedReturnPct(sequence));
  }
  const fingerprint = { schema_version:MONTE_CARLO_SCHEMA_VERSION, engine_version:RESEARCH_VALIDATION_ENGINE_VERSION, trades, iterations, seed_hash:seed.seed_hash };
  const hash = await sha256Hex(stableJson(fingerprint));
  return {
    ok: true as const,
    deterministic: true as const,
    schema_version: MONTE_CARLO_SCHEMA_VERSION,
    engine_version: RESEARCH_VALIDATION_ENGINE_VERSION,
    validation_run_id: `mc:${hash}`,
    method: "RETURN_SEQUENCE_PERMUTATION" as const,
    iterations,
    seed_hash: seed.seed_hash,
    original_metrics: summarizeValidationReturns(baseReturns),
    max_drawdown_pct_distribution: distribution(drawdowns),
    longest_losing_streak_distribution: distribution(losingStreaks),
    compounded_return_pct_distribution: distribution(compounded),
    compounded_return_invariant_tolerance_pct: round(Math.max(...compounded) - Math.min(...compounded), 12),
    production_promotion: "FORBIDDEN" as const,
  };
}

export async function runResearchValidationSuite(input: {
  primary: StrategyCandidateRun;
  walk_forward_candidates?: StrategyCandidateRun[];
  walk_forward?: { train_size: number; test_size: number; step_size?: number; selection_metric?: "expectancy_pct" | "profit_factor" };
  bootstrap?: { iterations?: number; seed?: string };
  monte_carlo?: { iterations?: number; seed?: string };
}) {
  const primary = canonicalCandidate(input?.primary, 0);
  const bootstrap = await runBootstrapValidation({ trades: primary.trades, ...(input.bootstrap ?? {}) });
  const monteCarlo = await runMonteCarloValidation({ trades: primary.trades, ...(input.monte_carlo ?? {}) });
  let walkForward = null;
  if (Array.isArray(input.walk_forward_candidates) && input.walk_forward_candidates.length) {
    if (!input.walk_forward) throw new ResearchValidationError("WALK_FORWARD_PARAMETERS_REQUIRED", "walk_forward parameters are required when candidates are provided");
    walkForward = await runWalkForwardValidation({ candidates:input.walk_forward_candidates, ...input.walk_forward });
  }
  const fingerprint = {
    schema_version:VALIDATION_SUITE_SCHEMA_VERSION,
    engine_version:RESEARCH_VALIDATION_ENGINE_VERSION,
    primary:{candidate_id:primary.candidate_id,parameter_version:primary.parameter_version,trades:primary.trades},
    bootstrap_run_id:bootstrap.validation_run_id,
    monte_carlo_run_id:monteCarlo.validation_run_id,
    walk_forward_run_id:walkForward?.validation_run_id ?? null,
  };
  const hash = await sha256Hex(stableJson(fingerprint));
  return {
    ok:true as const,
    deterministic:true as const,
    schema_version:VALIDATION_SUITE_SCHEMA_VERSION,
    engine_version:RESEARCH_VALIDATION_ENGINE_VERSION,
    validation_suite_id:`validation:${hash}`,
    primary_candidate_id:primary.candidate_id,
    primary_parameter_version:primary.parameter_version,
    walk_forward:walkForward,
    bootstrap,
    monte_carlo:monteCarlo,
    experiment_memory_recommended:true,
    production_promotion:"FORBIDDEN" as const,
  };
}
