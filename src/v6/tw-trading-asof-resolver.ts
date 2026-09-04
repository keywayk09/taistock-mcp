import { resolveTwseTradingWindowStart } from "./twse-trading-calendar-on-demand.ts";

export type TradingAsOfResolutionMode =
  | "EXPLICIT_EXACT_TRADING_DAY"
  | "IMPLICIT_CURRENT_TRADING_DAY"
  | "IMPLICIT_LATEST_TRADING_DAY";

export type TradingWindowResolver = (input: {
  as_of: string;
  trading_days: number;
}) => Promise<{
  start_date: string;
  end_date: string;
  trading_days: number;
}>;

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Canonical date rule for current credit/SBL reads.
 *
 * - Explicit user dates are authoritative and fail closed when they are not a
 *   TWSE trading day. They are never silently replaced with a prior session.
 * - Only implicit "current/latest" reads may walk backward across a weekend or
 *   holiday to the latest official trading day.
 */
export async function resolveTradingAsOf(input: {
  as_of: string;
  explicit: boolean;
  resolve_window?: TradingWindowResolver;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.as_of)) throw new Error("invalid_as_of_date");
  const resolveWindow = input.resolve_window ?? ((value) => resolveTwseTradingWindowStart(value));

  if (input.explicit) {
    const exact = await resolveWindow({ as_of: input.as_of, trading_days: 1 });
    if (exact.end_date !== input.as_of) throw new Error(`resolved_as_of_mismatch:${exact.end_date}`);
    return {
      resolved_as_of: input.as_of,
      mode: "EXPLICIT_EXACT_TRADING_DAY" as const,
    };
  }

  let candidate = input.as_of;
  for (let guard = 0; guard < 14; guard += 1) {
    try {
      const exact = await resolveWindow({ as_of: candidate, trading_days: 1 });
      return {
        resolved_as_of: exact.end_date,
        mode: candidate === input.as_of
          ? "IMPLICIT_CURRENT_TRADING_DAY" as const
          : "IMPLICIT_LATEST_TRADING_DAY" as const,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/requested_as_of_not_trading_day/.test(message)) throw error;
      candidate = shiftDays(candidate, -1);
    }
  }
  throw new Error("unable_to_resolve_latest_trading_day");
}
