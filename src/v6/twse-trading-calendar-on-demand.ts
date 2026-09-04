export const TWSE_TRADING_CALENDAR_ON_DEMAND_VERSION = "twse-trading-calendar-on-demand/v1.0.0";

type FetchLike = typeof fetch;
type YearCalendar = {
  year: number;
  closed_dates: Set<string>;
  source_url: string;
};
type CalendarCacheEntry = { expires_at: number; promise: Promise<YearCalendar> };

const CALENDAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const calendarCache = new Map<number, CalendarCacheEntry>();

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayOfWeek(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function isWeekend(date: string) {
  return [0, 6].includes(dayOfWeek(date));
}

function calendarUrl(year: number) {
  const rocYear = year - 1911;
  if (!Number.isInteger(rocYear) || rocYear <= 0) throw new Error(`unsupported_twse_calendar_year:${year}`);
  return `https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&queryYear=${rocYear}`;
}

async function loadYearCalendar(year: number, fetcher: FetchLike) {
  const now = Date.now();
  const existing = calendarCache.get(year);
  if (existing && existing.expires_at > now) return existing.promise;

  const promise = (async (): Promise<YearCalendar> => {
    const sourceUrl = calendarUrl(year);
    const response = await fetcher(sourceUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Diamond-TWSE-Trading-Calendar-ReadOnly/1.0",
      },
    });
    if (!response.ok) throw new Error(`twse_calendar_http_${response.status}`);
    const payload = await response.json() as Record<string, any>;
    if (payload?.stat !== "ok" || !Array.isArray(payload?.data)) {
      throw new Error("twse_calendar_invalid_payload");
    }
    const observedYear = Number(payload?.queryYear ?? String(payload?.date ?? "").slice(0, 4));
    if (observedYear !== year) {
      throw new Error(`twse_calendar_year_mismatch:${observedYear || "unknown"}`);
    }

    const closedDates = new Set<string>();
    for (const row of payload.data as unknown[]) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const date = String(row[0] ?? "").trim();
      const name = String(row[1] ?? "").trim();
      if (!validIsoDate(date) || Number(date.slice(0, 4)) !== year) continue;
      if (isWeekend(date)) continue;
      // TWSE's schedule also lists explicit first/last trading days around long
      // holidays. Those rows are open sessions and must not be marked closed.
      if (/開始交易日|最後交易日/.test(name)) continue;
      closedDates.add(date);
    }

    return { year, closed_dates: closedDates, source_url: sourceUrl };
  })();

  calendarCache.set(year, { expires_at: now + CALENDAR_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    calendarCache.delete(year);
    throw error;
  }
}

export async function resolveTwseTradingWindowStart(input: {
  as_of: string;
  trading_days: number;
  fetcher?: FetchLike;
}) {
  if (!validIsoDate(input.as_of)) throw new Error("invalid_as_of_date");
  if (!Number.isInteger(input.trading_days) || input.trading_days < 1 || input.trading_days > 240) {
    throw new Error("invalid_trading_window_days");
  }

  const fetcher = input.fetcher ?? fetch;
  const calendars = new Map<number, YearCalendar>();
  async function calendarFor(date: string) {
    const year = Number(date.slice(0, 4));
    const existing = calendars.get(year);
    if (existing) return existing;
    const loaded = await loadYearCalendar(year, fetcher);
    calendars.set(year, loaded);
    return loaded;
  }
  async function isTradingDay(date: string) {
    if (isWeekend(date)) return false;
    const calendar = await calendarFor(date);
    return !calendar.closed_dates.has(date);
  }

  if (!await isTradingDay(input.as_of)) {
    throw new Error(`requested_as_of_not_trading_day:${input.as_of}`);
  }

  let cursor = input.as_of;
  let seen = 0;
  for (let guard = 0; guard < 800; guard += 1) {
    if (await isTradingDay(cursor)) {
      seen += 1;
      if (seen === input.trading_days) {
        return {
          version: TWSE_TRADING_CALENDAR_ON_DEMAND_VERSION,
          start_date: cursor,
          end_date: input.as_of,
          trading_days: input.trading_days,
          calendar_years: [...calendars.keys()].sort((a, b) => a - b),
          source: "TWSE official historical holiday schedule",
          source_urls: [...calendars.values()].map((item) => item.source_url),
          persistence: "NONE" as const,
          previous_day_substitution: false,
        };
      }
    }
    cursor = shiftDays(cursor, -1);
  }
  throw new Error(`unable_to_resolve_trading_window:${input.trading_days}`);
}

export function resetTwseTradingCalendarCacheForTests() {
  calendarCache.clear();
}
