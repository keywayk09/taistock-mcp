// The Production scheduler runs every five minutes. Cloudflare Cron Triggers at
// sub-hour intervals have a 30s CPU ceiling, so the application must stop
// starting new work materially before that platform boundary. Wall time and CPU
// time are different clocks, but a shorter application slice plus per-unit
// completion guards prevents a late large JSON/compression/GitHub persistence
// unit from being started near the hard runtime edge.
export const DEFAULT_MARKET_DATA_WORK_SLICE_MS = 24_000;
export const DEFAULT_MARKET_DATA_ESTIMATED_SUBREQUEST_BUDGET = 42;

export type MarketDataWorkBudget = {
  started_at_ms: number;
  deadline_at_ms: number;
  estimated_subrequests: number;
  subrequest_budget: number;
};

export function createMarketDataWorkBudget(input: {
  nowMs?: number;
  sliceMs?: number;
  subrequestBudget?: number;
} = {}): MarketDataWorkBudget {
  const nowMs = input.nowMs ?? Date.now();
  const sliceMs = Math.max(1_000, input.sliceMs ?? DEFAULT_MARKET_DATA_WORK_SLICE_MS);
  const subrequestBudget = Math.max(8, input.subrequestBudget ?? DEFAULT_MARKET_DATA_ESTIMATED_SUBREQUEST_BUDGET);
  return {
    started_at_ms: nowMs,
    deadline_at_ms: nowMs + sliceMs,
    estimated_subrequests: 0,
    subrequest_budget: subrequestBudget,
  };
}

export function hasSafeMarketDataBudget(
  budget: MarketDataWorkBudget,
  input: {
    nowMs?: number;
    nextEstimatedSubrequests?: number;
    minimumRemainingMs?: number;
  } = {},
) {
  const nowMs = input.nowMs ?? Date.now();
  const next = Math.max(0, input.nextEstimatedSubrequests ?? 1);
  const minimumRemainingMs = Math.max(0, input.minimumRemainingMs ?? 0);
  const remainingMs = budget.deadline_at_ms - nowMs;
  return remainingMs >= minimumRemainingMs
    && remainingMs > 0
    && budget.estimated_subrequests + next <= budget.subrequest_budget;
}

export function chargeMarketDataWorkBudget(budget: MarketDataWorkBudget, estimatedSubrequests: number) {
  budget.estimated_subrequests += Math.max(0, estimatedSubrequests);
  return budget;
}
