import type { TwMarketDataKind } from "./tw-market-data";

const ALL_KINDS: TwMarketDataKind[] = ["institutional", "margin", "securities_lending", "sbl_short_sale"];
const LATE_KINDS: TwMarketDataKind[] = ["margin", "securities_lending", "sbl_short_sale"];

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

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function previousWeekday(date: string) {
  let cursor = shiftDays(date, -1);
  while ([0, 6].includes(dayOfWeek(cursor))) cursor = shiftDays(cursor, -1);
  return cursor;
}

function checkpointIso(date: string, hour: number, minute: number) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00+08:00`).toISOString();
}

function inMinuteWindow(hour: number, minute: number, targetHour: number, startMinute: number, endMinute: number) {
  return hour === targetHour && minute >= startMinute && minute <= endMinute;
}

export type MarketDataScheduleDecision = {
  tradeDate: string;
  finalAudit: boolean;
  lane: "DAILY" | "HISTORY";
  allowedKinds: TwMarketDataKind[];
  checkpointStartedAt: string | null;
  reason:
    | "DAILY_INSTITUTIONAL"
    | "DAILY_LATE"
    | "DAILY_RECOVERY"
    | "PREVIOUS_DAY_FINAL_AUDIT"
    | "HISTORY_BOOTSTRAP";
};

export function decideExtendedMarketDataSchedule(now = new Date()): MarketDataScheduleDecision {
  const p = taipeiParts(now);
  const date = `${p.year}-${p.month}-${p.day}`;
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const dow = dayOfWeek(date);
  const weekday = dow >= 1 && dow <= 5;

  // One previous-day final-audit checkpoint. Saturday is allowed so Friday can
  // be closed cleanly; Sunday is history-only and does not repeat Friday audit.
  if (dow !== 0 && inMinuteWindow(hour, minute, 8, 30, 55)) {
    return {
      tradeDate: previousWeekday(date),
      finalAudit: true,
      lane: "DAILY",
      allowedKinds: [...ALL_KINDS],
      checkpointStartedAt: checkpointIso(date, 8, 30),
      reason: "PREVIOUS_DAY_FINAL_AUDIT",
    };
  }

  // 18:00 institutional checkpoint. 18:05..18:25 are continuation wakes for
  // unfinished units from the same checkpoint, not new retry epochs.
  if (weekday && inMinuteWindow(hour, minute, 18, 0, 25)) {
    return {
      tradeDate: date,
      finalAudit: false,
      lane: "DAILY",
      allowedKinds: ["institutional"],
      checkpointStartedAt: checkpointIso(date, 18, 0),
      reason: "DAILY_INSTITUTIONAL",
    };
  }

  // Margin / lending / SBL are intentionally delayed until 21:15 so the
  // Worker does not keep polling official endpoints before the data is ready.
  if (weekday && inMinuteWindow(hour, minute, 21, 15, 55)) {
    return {
      tradeDate: date,
      finalAudit: false,
      lane: "DAILY",
      allowedKinds: [...LATE_KINDS],
      checkpointStartedAt: checkpointIso(date, 21, 15),
      reason: "DAILY_LATE",
    };
  }

  // One missing-only recovery epoch later in the evening. Each missing layer
  // can be attempted at most once inside this checkpoint window.
  if (weekday && inMinuteWindow(hour, minute, 22, 15, 55)) {
    return {
      tradeDate: date,
      finalAudit: false,
      lane: "DAILY",
      allowedKinds: [...ALL_KINDS],
      checkpointStartedAt: checkpointIso(date, 22, 15),
      reason: "DAILY_RECOVERY",
    };
  }

  // Every spare five-minute wake belongs to the one-shot history bootstrap.
  // On weekends use the latest prior weekday as the anchor. The persisted
  // bootstrap state freezes its original anchor and cannot be reopened later.
  return {
    tradeDate: weekday ? date : previousWeekday(date),
    finalAudit: false,
    lane: "HISTORY",
    allowedKinds: [],
    checkpointStartedAt: null,
    reason: "HISTORY_BOOTSTRAP",
  };
}
