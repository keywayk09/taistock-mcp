import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner";
import { decideExtendedMarketDataSchedule } from "./market-data-schedule";

export { decideExtendedMarketDataSchedule } from "./market-data-schedule";

export async function runExtendedScheduledMarketDataController(env: Env, scheduledTime: number) {
  const now = new Date(scheduledTime);
  const decision = decideExtendedMarketDataSchedule(now);
  if (!decision) return { status: "NOOP_OUTSIDE_MARKET_DATA_WINDOW" as const };

  const result = await runSubrequestSafeMarketDataCapture(env, {
    tradeDate: decision.tradeDate,
    finalAudit: decision.finalAudit,
    now,
  });
  console.log("market-data-cloudflare-cron-subrequest-safe", { decision, result });
  return { decision, result };
}
