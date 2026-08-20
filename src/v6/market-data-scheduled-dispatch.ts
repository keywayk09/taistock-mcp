import { runMarketDataCloudflareCapture } from "./market-data-cloudflare-runner";

function taipeiParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

function dayOfWeek(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function decideExtendedMarketDataSchedule(now = new Date()) {
  const p = taipeiParts(now);
  const tradeDate = `${p.year}-${p.month}-${p.day}`;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const dow = dayOfWeek(tradeDate);
  const weekday = dow >= 1 && dow <= 5;

  // Previous trading-day audit. This remains a separate safety net even when
  // the prior evening already completed successfully (which becomes a NOOP).
  if (hour === 8 && minute === 30 && dow >= 2 && dow <= 6) {
    return {
      tradeDate: subtractDays(tradeDate, 1),
      finalAudit: true,
      reason: "PREVIOUS_DAY_FINAL_AUDIT" as const,
    };
  }

  // Do not impose a 22:30 hard stop. From 18:15 through 23:55, wake every
  // five minutes and let the incremental controller decide whether anything
  // is actually due. READY layers remain monotonic and complete days NOOP.
  const eveningWindow = weekday && ((hour === 18 && minute >= 15) || (hour >= 19 && hour <= 23));
  if (eveningWindow) {
    return {
      tradeDate,
      finalAudit: hour === 23 && minute === 55,
      reason: "TRADING_EVENING_EXTENDED" as const,
    };
  }

  // Weekend preflight writes the terminal no-trading-day receipt once.
  if (!weekday && hour === 18 && minute === 15) {
    return {
      tradeDate,
      finalAudit: false,
      reason: "WEEKEND_PREFLIGHT" as const,
    };
  }

  return null;
}

export async function runExtendedScheduledMarketDataController(env: Env, scheduledTime: number) {
  const now = new Date(scheduledTime);
  const decision = decideExtendedMarketDataSchedule(now);
  if (!decision) return { status: "NOOP_OUTSIDE_MARKET_DATA_WINDOW" as const };

  const result = await runMarketDataCloudflareCapture(env, {
    tradeDate: decision.tradeDate,
    finalAudit: decision.finalAudit,
    now,
  });
  console.log("market-data-cloudflare-cron-extended", { decision, result });
  return { decision, result };
}
