import { runMarketDataCloudflareCapture } from "./market-data-cloudflare-runner.ts";

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
  const date = `${p.year}-${p.month}-${p.day}`;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const dow = dayOfWeek(date);
  const weekday = dow >= 1 && dow <= 5;

  const previousDate = subtractDays(date, 1);
  const previousDow = dayOfWeek(previousDate);
  const previousWeekday = previousDow >= 1 && previousDow <= 5;

  // Keep retrying the previous trading day overnight. This removes the old
  // midnight gap: a Worker deploy/restart or a very late official release can
  // still be reconciled immediately instead of waiting until the next morning.
  // READY layers and COMPLETE days are idempotent NOOPs, so these wakes only
  // fetch layers that are still due.
  const overnightCatchup = hour < 8 || (hour === 8 && minute < 30);
  if (previousWeekday && overnightCatchup) {
    return {
      tradeDate: previousDate,
      finalAudit: false,
      reason: "PREVIOUS_DAY_OVERNIGHT_CATCHUP" as const,
    };
  }

  // 08:30 is the explicit final audit safety net for the previous weekday.
  if (hour === 8 && minute === 30 && previousWeekday) {
    return {
      tradeDate: previousDate,
      finalAudit: true,
      reason: "PREVIOUS_DAY_FINAL_AUDIT" as const,
    };
  }

  // From 18:15 through 23:55, wake every five minutes and let the incremental
  // controller decide whether anything is due. READY layers remain monotonic.
  const eveningWindow = weekday && ((hour === 18 && minute >= 15) || (hour >= 19 && hour <= 23));
  if (eveningWindow) {
    return {
      tradeDate: date,
      finalAudit: false,
      reason: "TRADING_EVENING_EXTENDED" as const,
    };
  }

  // Weekend preflight writes the terminal no-trading-day receipt once.
  if (!weekday && hour === 18 && minute === 15) {
    return {
      tradeDate: date,
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
