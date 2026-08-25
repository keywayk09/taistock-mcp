export const SELECTION_SCHEDULE_VERSION = "diamond-selection-schedule/v1.1.0";

export type SelectionScheduleAction = "INTRADAY_REVIEW" | "NIGHT_SELECTION" | "NONE";

export type SelectionScheduleDecision = {
  version: typeof SELECTION_SCHEDULE_VERSION;
  action: SelectionScheduleAction;
  source_trade_date: string;
  target_session_date: string;
  slot: "EOD_1800" | "FULL_2230" | null;
  reason: string;
};

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

function dateParts(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  return { value, dow: value.getUTCDay() };
}

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function previousWeekday(date: string) {
  let cursor = shiftDays(date, -1);
  while ([0, 6].includes(dateParts(cursor).dow)) cursor = shiftDays(cursor, -1);
  return cursor;
}

export function nextWeekday(date: string) {
  let cursor = shiftDays(date, 1);
  while ([0, 6].includes(dateParts(cursor).dow)) cursor = shiftDays(cursor, 1);
  return cursor;
}

function inWindow(hour: number, minute: number, targetHour: number, startMinute: number, endMinute: number) {
  return hour === targetHour && minute >= startMinute && minute <= endMinute;
}

export function decideSelectionSchedule(now = new Date()): SelectionScheduleDecision {
  const p = taipeiParts(now);
  const date = `${p.year}-${p.month}-${p.day}`;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const dow = dateParts(date).dow;
  const weekday = dow >= 1 && dow <= 5;

  // Intraday review becomes eligible at 18:00. The 18:00-18:25 market-data
  // institutional checkpoint remains authoritative; 18:30-18:55 are catch-up
  // wakes only. The immutable journal makes repeated wakes idempotent.
  if (weekday && inWindow(hour, minute, 18, 0, 55)) {
    return {
      version: SELECTION_SCHEDULE_VERSION,
      action: "INTRADAY_REVIEW",
      source_trade_date: date,
      target_session_date: date,
      slot: "EOD_1800",
      reason: "18:00_INTRADAY_REVIEW_ELIGIBLE_AFTER_CLOSE_WITH_INSTITUTIONAL_READINESS_GATE",
    };
  }

  // 22:30 is the earliest eligible time for swing and next-day intraday
  // selection. Canonical market-data recovery continues through 22:55; the
  // selector itself must remain PENDING until all required same-date layers are
  // READY. No prior-day substitution is allowed.
  if (weekday && inWindow(hour, minute, 22, 30, 55)) {
    return {
      version: SELECTION_SCHEDULE_VERSION,
      action: "NIGHT_SELECTION",
      source_trade_date: date,
      target_session_date: nextWeekday(date),
      slot: "FULL_2230",
      reason: "22:30_SWING_AND_NEXT_DAY_INTRADAY_AFTER_LATE_MARKET_DATA",
    };
  }

  // Selection has no next-morning rewrite/audit lane. The canonical market-data
  // controller keeps its own 08:30-08:55 final audit, but point-in-time
  // selections remain immutable for honest backtests.
  return {
    version: SELECTION_SCHEDULE_VERSION,
    action: "NONE",
    source_trade_date: weekday ? date : previousWeekday(date),
    target_session_date: weekday ? nextWeekday(date) : date,
    slot: null,
    reason: "NO_SELECTION_WORK_DUE",
  };
}
