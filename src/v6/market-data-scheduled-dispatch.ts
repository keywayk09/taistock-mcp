import { runMarketData360dBackfillStep } from "./market-data-360d-backfill";
import { setMarketDataCapturePolicy, setMarketDataCaptureTradeDate } from "./market-data-capture-context";
import { runAdaptiveDailyMarketDataCapture } from "./market-data-daily-capture";
import { recordHistoryBackfillFailure } from "./market-data-history-diagnostic";
import { runOneShotMarketDataRepair20260831 } from "./market-data-one-shot-repair-20260831";
import { runMarketDataPublisher } from "./market-data-publisher";
import { decideExtendedMarketDataSchedule } from "./market-data-schedule";
import {
  chargeMarketDataWorkBudget,
  createMarketDataWorkBudget,
  hasSafeMarketDataBudget,
} from "./market-data-work-budget";

export { decideExtendedMarketDataSchedule } from "./market-data-schedule";

const CAPTURE_UNIT_RESERVE = 10;
// Leave enough wall-window headroom for the complete immutable raw/snapshot/
// manifest persistence unit once it has been started. These are admission
// guards, not fixed step limits: fast work can still perform multiple units.
const CAPTURE_UNIT_MIN_REMAINING_MS = 8_000;
// Publisher v5 needs enough room for at least one audited prefix plus the
// worst-case final generation-manifest + pointer transaction.
const PUBLISH_UNIT_RESERVE = 23;
const PUBLISH_UNIT_MIN_REMAINING_MS = 12_000;
const BACKFILL_UNIT_RESERVE = 13;
const BACKFILL_UNIT_MIN_REMAINING_MS = 10_000;
// This headroom is intentionally not handed to the backfill worker. It covers
// coordinator reads and, on failure, the small idempotent Production diagnostic
// write so the original runtime error can be identified without Cloudflare log access.
const BACKFILL_COORDINATOR_HEADROOM = 5;

function statusOf(value: any) {
  return String(value?.status ?? "");
}

function estimateCaptureSubrequests(result: any) {
  if (Number.isFinite(Number(result?.estimated_subrequests))) return Number(result.estimated_subrequests);
  const preflight = Math.max(0, Number(result?.preflight_subrequests ?? 0));
  const status = statusOf(result);
  if (["NOOP_NOT_DUE", "NOOP_ALREADY_COMPLETE", "NOOP_NO_TRADING_DAY"].includes(status)) return 2 + preflight;
  if (["INDEX_PROGRESS", "INDEX_COMPLETE", "INDEX_WAITING_FOR_COMPLETE_DAY", "INDEX_YIELD"].includes(status)) return 7 + preflight;
  if (status === "NO_TRADING_DAY") return 5 + preflight;
  if (Array.isArray(result?.attempted_layers) && result.attempted_layers.length) return 9 + preflight;
  return 6 + preflight;
}

function estimatePublisherSubrequests(result: any) {
  if (Number.isFinite(Number(result?.estimated_subrequests))) return Number(result.estimated_subrequests);
  const status = statusOf(result);
  if (["PUBLISH_WAITING_MANIFEST", "PUBLISH_WAITING_CANONICAL", "PUBLISH_WAITING_INDEX", "PUBLISH_NO_TRADING_DAY", "PUBLISH_WAITING_HISTORY_MONTH", "PUBLISH_YIELD"].includes(status)) return 2;
  if (status === "PUBLISHED") return 23;
  if (status === "PUBLISH_PROGRESS") return 23;
  return 5;
}

function estimateBackfillSubrequests(result: any) {
  if (Number.isFinite(Number(result?.estimated_subrequests))) return Number(result.estimated_subrequests);
  const status = statusOf(result);
  if (status === "BACKFILL_COMPLETE") return 2;
  if (status === "BACKFILL_WAITING") return 4;
  const capture = Array.isArray(result?.captures) ? result.captures.at(-1) : null;
  return 3 + estimateCaptureSubrequests(capture);
}

async function runDailyLane(env: Env, decision: ReturnType<typeof decideExtendedMarketDataSchedule>, now: Date) {
  const budget = createMarketDataWorkBudget();
  const hotResults: any[] = [];
  const publications: any[] = [];

  setMarketDataCaptureTradeDate(decision.tradeDate);
  setMarketDataCapturePolicy({
    allowedKinds: decision.allowedKinds,
    checkpointStartedAt: decision.checkpointStartedAt,
    storageMode: "HISTORY_COMPRESSED",
  });
  try {
    while (hasSafeMarketDataBudget(budget, {
      nextEstimatedSubrequests: CAPTURE_UNIT_RESERVE,
      minimumRemainingMs: CAPTURE_UNIT_MIN_REMAINING_MS,
    })) {
      const remainingSubrequests = Math.max(
        0,
        budget.subrequest_budget - budget.estimated_subrequests,
      );
      const result = await runAdaptiveDailyMarketDataCapture(env, {
        tradeDate: decision.tradeDate,
        finalAudit: decision.finalAudit,
        now: new Date(),
        deadlineAtMs: budget.deadline_at_ms,
        subrequestBudget: remainingSubrequests,
      });
      hotResults.push(result);
      chargeMarketDataWorkBudget(budget, estimateCaptureSubrequests(result));
      const status = statusOf(result);
      if ([
        "NOOP_NOT_DUE",
        "NOOP_ALREADY_COMPLETE",
        "NOOP_NO_TRADING_DAY",
        "NO_TRADING_DAY",
        "INDEX_COMPLETE",
        "INDEX_WAITING_FOR_COMPLETE_DAY",
        "INDEX_YIELD",
      ].includes(status)) break;
    }
  } finally {
    setMarketDataCapturePolicy(null);
    setMarketDataCaptureTradeDate(null);
  }

  while (hasSafeMarketDataBudget(budget, {
    nextEstimatedSubrequests: PUBLISH_UNIT_RESERVE,
    minimumRemainingMs: PUBLISH_UNIT_MIN_REMAINING_MS,
  })) {
    const remainingSubrequests = Math.max(
      0,
      budget.subrequest_budget - budget.estimated_subrequests,
    );
    const publication = await runMarketDataPublisher(env, {
      tradeDate: decision.tradeDate,
      now: new Date(),
      deadlineAtMs: budget.deadline_at_ms,
      subrequestBudget: remainingSubrequests,
    });
    publications.push(publication);
    chargeMarketDataWorkBudget(budget, estimatePublisherSubrequests(publication));
    const status = statusOf(publication);
    if (status !== "PUBLISH_PROGRESS") break;
  }

  const result = hotResults.at(-1) ?? null;
  const publication = publications.at(-1) ?? null;
  console.log("market-data-daily-budgeted", {
    decision,
    result,
    publication,
    capture_units: hotResults.length,
    publish_units: publications.length,
    budget,
  });
  return { decision, result, publication, hotResults, publications, backfill: null, budget };
}

async function runHistoryLane(env: Env, decision: ReturnType<typeof decideExtendedMarketDataSchedule>, now: Date) {
  const budget = createMarketDataWorkBudget();
  const backfillResults: any[] = [];

  while (hasSafeMarketDataBudget(budget, {
    nextEstimatedSubrequests: BACKFILL_UNIT_RESERVE,
    minimumRemainingMs: BACKFILL_UNIT_MIN_REMAINING_MS,
  })) {
    const remainingSubrequests = Math.max(
      0,
      budget.subrequest_budget - budget.estimated_subrequests - BACKFILL_COORDINATOR_HEADROOM,
    );
    let backfill: any;
    try {
      backfill = await runMarketData360dBackfillStep(env, {
        anchorTradeDate: decision.tradeDate,
        now: new Date(),
        deadlineAtMs: budget.deadline_at_ms,
        subrequestBudget: remainingSubrequests,
      });
    } catch (error) {
      // Persist only a changed fingerprint. Repeated identical five-minute
      // failures are idempotent and therefore do not create Git commit churn.
      // Diagnostic failure must never mask the original Production failure.
      try {
        const diagnostic = await recordHistoryBackfillFailure(env, {
          error,
          stage: "HISTORY_BACKFILL_STEP",
          anchorTradeDate: decision.tradeDate,
        });
        console.error("market-data-history-failure-recorded", diagnostic);
      } catch (diagnosticError) {
        console.error("market-data-history-failure-diagnostic-failed", {
          original_error: String(error),
          diagnostic_error: String(diagnosticError),
        });
      }
      throw error;
    }
    backfillResults.push(backfill);
    chargeMarketDataWorkBudget(budget, estimateBackfillSubrequests(backfill));
    const status = statusOf(backfill);
    if (status === "BACKFILL_COMPLETE" || status === "BACKFILL_WAITING") break;
  }

  const backfill = backfillResults.at(-1) ?? null;
  console.log("market-data-history-budgeted", {
    decision,
    backfill,
    work_units: backfillResults.length,
    budget,
  });
  return {
    decision,
    result: null,
    publication: null,
    hotResults: [],
    publications: [],
    backfill,
    backfillResults,
    budget,
  };
}

export async function runExtendedScheduledMarketDataController(env: Env, scheduledTime: number) {
  const now = new Date(scheduledTime);

  // Explicitly reviewed, self-disabling historical repair. It may pre-empt only
  // while the exact 2026-08-31 manifest is in the known safe 5/8..8/8 state.
  // Any unexpected canonical state fails closed and normal current-day work is
  // allowed to continue rather than being held hostage by a repair diagnostic.
  const repair = await runOneShotMarketDataRepair20260831(env, {
    now,
    deadlineAtMs: Date.now() + 22_000,
    subrequestBudget: 37,
  });
  if (repair.prioritize_repair === true) {
    console.log("market-data-one-shot-repair-20260831", repair);
    return {
      decision: {
        lane: "ONE_SHOT_REPAIR" as const,
        tradeDate: "2026-08-31",
      },
      one_shot_repair: repair,
      result: repair.capture,
      publication: null,
      hotResults: repair.capture ? [repair.capture] : [],
      publications: [],
      backfill: null,
      budget: null,
    };
  }
  if (repair.status === "REPAIR_BLOCKED") {
    console.error("market-data-one-shot-repair-20260831-blocked", repair);
  }

  const decision = decideExtendedMarketDataSchedule(now);
  return decision.lane === "HISTORY"
    ? await runHistoryLane(env, decision, now)
    : await runDailyLane(env, decision, now);
}
