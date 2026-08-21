import { runMarketData360dBackfillStep } from "./market-data-360d-backfill";
import { setMarketDataCaptureTradeDate } from "./market-data-capture-context";
import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner";
import { runMarketDataPublisher } from "./market-data-publisher";
import { decideExtendedMarketDataSchedule } from "./market-data-schedule";

export { decideExtendedMarketDataSchedule } from "./market-data-schedule";

export const MARKET_DATA_HOT_STEPS_PER_CRON = 3;
export const MARKET_DATA_PUBLISH_STEPS_PER_CRON = 2;

export async function runExtendedScheduledMarketDataController(env: Env, scheduledTime: number) {
  const now = new Date(scheduledTime);
  const decision = decideExtendedMarketDataSchedule(now);
  if (!decision) return { status: "NOOP_OUTSIDE_MARKET_DATA_WINDOW" as const };

  const hotResults: any[] = [];
  setMarketDataCaptureTradeDate(decision.tradeDate);
  try {
    for (let step = 0; step < MARKET_DATA_HOT_STEPS_PER_CRON; step++) {
      const result = await runSubrequestSafeMarketDataCapture(env, {
        tradeDate: decision.tradeDate,
        finalAudit: decision.finalAudit,
        now,
      });
      hotResults.push(result);
      if (["NOOP_ALREADY_COMPLETE", "NOOP_NO_TRADING_DAY", "NO_TRADING_DAY"].includes(String(result.status ?? ""))) break;
    }
  } finally {
    setMarketDataCaptureTradeDate(null);
  }

  const publications: any[] = [];
  for (let step = 0; step < MARKET_DATA_PUBLISH_STEPS_PER_CRON; step++) {
    const publication = await runMarketDataPublisher(env, {
      tradeDate: decision.tradeDate,
      now,
    });
    publications.push(publication);
    if (["PUBLISHED", "PUBLISH_WAITING_MANIFEST", "PUBLISH_WAITING_CANONICAL", "PUBLISH_WAITING_INDEX", "PUBLISH_NO_TRADING_DAY"].includes(String(publication.status ?? ""))) break;
  }

  const result = hotResults.at(-1) ?? null;
  const publication = publications.at(-1) ?? null;
  const backfill = publication?.status === "PUBLISHED"
    ? await runMarketData360dBackfillStep(env, { anchorTradeDate: decision.tradeDate, now })
    : { status: "BACKFILL_PAUSED_FOR_HOT_LANE" as const };

  console.log("market-data-cloudflare-cron-subrequest-safe", {
    decision,
    result,
    publication,
    hot_steps: hotResults.length,
    publish_steps: publications.length,
    backfill,
  });
  return { decision, result, publication, hotResults, publications, backfill };
}
