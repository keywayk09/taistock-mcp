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

  // 08:30 remains the explicit previous-day final-audit checkpoint.
  if (hour === 8 && minute === 30 && previousWeekday) {
    return {
      tradeDate: previousDate,
      finalAudit: true,
      reason: "PREVIOUS_DAY_FINAL_AUDIT" as const,
    };
  }

  // Continue the previous trading day's resumable capture/index/publish work until
  // the current day's official evening window begins. COMPLETE/READY/PUBLISHED
  // stages are idempotent, so this primarily drains unfinished compaction and
  // generation publishing instead of stranding a partially built day at 08:30.
  const previousDayCatchup = previousWeekday && (hour < 18 || (hour === 18 && minute < 15));
  if (previousDayCatchup) {
    return {
      tradeDate: previousDate,
      finalAudit: false,
      reason: "PREVIOUS_DAY_OVERNIGHT_CATCHUP" as const,
    };
  }

  const eveningWindow = weekday && ((hour === 18 && minute >= 15) || (hour >= 19 && hour <= 23));
  if (eveningWindow) {
    return {
      tradeDate: date,
      finalAudit: false,
      reason: "TRADING_EVENING_EXTENDED" as const,
    };
  }

  if (!weekday && hour === 18 && minute === 15) {
    return {
      tradeDate: date,
      finalAudit: false,
      reason: "WEEKEND_PREFLIGHT" as const,
    };
  }

  return null;
}
