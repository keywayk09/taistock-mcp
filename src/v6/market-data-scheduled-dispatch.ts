import { runMarketData360dBackfillStep } from "./market-data-360d-backfill";
import { setMarketDataCapturePolicy, setMarketDataCaptureTradeDate } from "./market-data-capture-context";
import { runAdaptiveDailyMarketDataCapture } from "./market-data-daily-capture";
import { runMarketDataPublisher } from "./market-data-publisher";
import { decideExtendedMarketDataSchedule } from "./market-data-schedule";
import {
  chargeMarketDataWorkBudget,
  createMarketDataWorkBudget,
  hasSafeMarketDataBudget,
} from "./market-data-work-budget";

export { decideExtendedMarketDataSchedule } from "./market-data-schedule";

const CAPTURE_UNIT_RESERVE = 10;
// Publisher v5 needs enough room for at least one audited prefix plus the
// worst-case final generation-manifest + pointer transaction.
const PUBLISH_UNIT_RESERVE = 23;
const BACKFILL_UNIT_RESERVE = 13;
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
    while (hasSafeMarketDataBudget(budget, { nextEstimatedSubrequests: CAPTURE_UNIT_RESERVE })) {
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

  while (hasSafeMarketDataBudget(budget, { nextEstimatedSubrequests: PUBLISH_UNIT_RESERVE })) {
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

  while (hasSafeMarketDataBudget(budget, { nextEstimatedSubrequests: BACKFILL_UNIT_RESERVE })) {
    const remainingSubrequests = Math.max(
      0,
      budget.subrequest_budget - budget.estimated_subrequests - BACKFILL_COORDINATOR_HEADROOM,
    );
    const backfill = await runMarketData360dBackfillStep(env, {
      anchorTradeDate: decision.tradeDate,
      now: new Date(),
      deadlineAtMs: budget.deadline_at_ms,
      subrequestBudget: remainingSubrequests,
    });
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
  const decision = decideExtendedMarketDataSchedule(now);
  return decision.lane === "HISTORY"
    ? await runHistoryLane(env, decision, now)
    : await runDailyLane(env, decision, now);
}
