export const SELECTION_SCHEDULE_VERSION = "diamond-selection-schedule/v1.0.0";

export type SelectionScheduleAction = "INTRADAY_REVIEW" | "NIGHT_SELECTION" | "AUDIT_DELTA" | "NONE";

export type SelectionScheduleDecision = {
  version: typeof SELECTION_SCHEDULE_VERSION;
  action: SelectionScheduleAction;
  source_trade_date: string;
  target_session_date: string;
  slot: "EOD_1830" | "FULL_2230" | null;
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

  if (weekday && inWindow(hour, minute, 18, 30, 55)) {
    return {
      version: SELECTION_SCHEDULE_VERSION,
      action: "INTRADAY_REVIEW",
      source_trade_date: date,
      target_session_date: date,
      slot: "EOD_1830",
      reason: "18:30_INTRADAY_REVIEW_AFTER_INSTITUTIONAL_CHECKPOINT",
    };
  }

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

  // The underlying market-data final audit starts at 08:30. Selection audit
  // is deliberately written only at the end of that window so late official
  // corrections cannot rewrite the previous evening's immutable prediction.
  if (dow !== 0 && inWindow(hour, minute, 8, 55, 59)) {
    const prior = previousWeekday(date);
    return {
      version: SELECTION_SCHEDULE_VERSION,
      action: "AUDIT_DELTA",
      source_trade_date: prior,
      target_session_date: date,
      slot: null,
      reason: "08:55_POST_FINAL_AUDIT_DELTA_ONLY",
    };
  }

  return {
    version: SELECTION_SCHEDULE_VERSION,
    action: "NONE",
    source_trade_date: weekday ? date : previousWeekday(date),
    target_session_date: weekday ? nextWeekday(date) : date,
    slot: null,
    reason: "NO_SELECTION_WORK_DUE",
  };
}
