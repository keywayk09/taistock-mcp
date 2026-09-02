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

function retryEpochCheckpointIso(date: string, hour: number, minute: number) {
  // Late official data needs bounded retries, not an hour-long one-attempt fence.
  // A 15-minute epoch still requires each layer's next_retry_at to be due and the
  // global retry-attempt cap to remain open, so this cannot create a five-minute
  // provider polling storm.
  const bucketMinute = Math.floor(minute / 15) * 15;
  return checkpointIso(date, hour, bucketMinute);
}

function inMinuteWindow(hour: number, minute: number, targetHour: number, startMinute: number, endMinute: number) {
  return hour === targetHour && minute >= startMinute && minute <= endMinute;
}

function inSameDayRecoveryWindow(hour: number, minute: number) {
  // Keep same-day recovery available from 22:15 through the final scheduled
  // wake at 23:55. Midnight still closes the epoch family so the prior trade
  // date cannot keep mutating indefinitely.
  return (hour === 22 && minute >= 15) || hour === 23;
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
  // Within this late window, each 15-minute epoch may retry a still-missing
  // layer only after its persisted next_retry_at is due. This lets a relay that
  // becomes complete after an earlier attempt be consumed before 22:30.
  if (weekday && inMinuteWindow(hour, minute, 21, 15, 55)) {
    return {
      tradeDate: date,
      finalAudit: false,
      lane: "DAILY",
      allowedKinds: [...LATE_KINDS],
      checkpointStartedAt: retryEpochCheckpointIso(date, hour, minute),
      reason: "DAILY_LATE",
    };
  }

  // Same-day missing-only recovery remains bounded through 23:55. Quarter-hour
  // retry epochs reopen only the checkpoint fence; dueLayerKeys still enforces
  // next_retry_at and MAX_AUTOMATIC_RETRY_ATTEMPTS for every actual provider
  // request. This preserves fail-closed semantics without stranding late data.
  if (weekday && inSameDayRecoveryWindow(hour, minute)) {
    return {
      tradeDate: date,
      finalAudit: false,
      lane: "DAILY",
      allowedKinds: [...ALL_KINDS],
      checkpointStartedAt: retryEpochCheckpointIso(date, hour, minute),
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
