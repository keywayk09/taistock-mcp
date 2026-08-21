import { runMarketData360dBackfillStep } from "./market-data-360d-backfill";
import { setMarketDataCapturePolicy, setMarketDataCaptureTradeDate } from "./market-data-capture-context";
import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner";
import { runMarketDataPublisher } from "./market-data-publisher";
import { decideExtendedMarketDataSchedule } from "./market-data-schedule";
import {
  chargeMarketDataWorkBudget,
  createMarketDataWorkBudget,
  hasSafeMarketDataBudget,
} from "./market-data-work-budget";

export { decideExtendedMarketDataSchedule } from "./market-data-schedule";

function statusOf(value: any) {
  return String(value?.status ?? "");
}

function estimateCaptureSubrequests(result: any) {
  const status = statusOf(result);
  if (["NOOP_NOT_DUE", "NOOP_ALREADY_COMPLETE", "NOOP_NO_TRADING_DAY"].includes(status)) return 2;
  if (["INDEX_PROGRESS", "INDEX_COMPLETE", "INDEX_WAITING_FOR_COMPLETE_DAY"].includes(status)) return 7;
  if (status === "NO_TRADING_DAY") return 5;
  if (Array.isArray(result?.attempted_layers) && result.attempted_layers.length) return 9;
  return 6;
}

function estimatePublisherSubrequests(result: any) {
  const status = statusOf(result);
  if (["PUBLISH_WAITING_MANIFEST", "PUBLISH_WAITING_CANONICAL", "PUBLISH_WAITING_INDEX", "PUBLISH_NO_TRADING_DAY"].includes(status)) return 2;
  if (status === "PUBLISHED") return 8;
  if (status === "PUBLISH_PROGRESS") return 10;
  return 5;
}

function estimateBackfillSubrequests(result: any) {
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
  });
  try {
    while (hasSafeMarketDataBudget(budget, { nextEstimatedSubrequests: 4 })) {
      const result = await runSubrequestSafeMarketDataCapture(env, {
        tradeDate: decision.tradeDate,
        finalAudit: decision.finalAudit,
        now: new Date(),
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
      ].includes(status)) break;
    }
  } finally {
    setMarketDataCapturePolicy(null);
    setMarketDataCaptureTradeDate(null);
  }

  while (hasSafeMarketDataBudget(budget, { nextEstimatedSubrequests: 4 })) {
    const publication = await runMarketDataPublisher(env, {
      tradeDate: decision.tradeDate,
      now: new Date(),
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

  while (hasSafeMarketDataBudget(budget, { nextEstimatedSubrequests: 4 })) {
    const backfill = await runMarketData360dBackfillStep(env, {
      anchorTradeDate: decision.tradeDate,
      now: new Date(),
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
