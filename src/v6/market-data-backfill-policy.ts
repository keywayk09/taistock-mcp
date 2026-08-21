export const MARKET_DATA_BACKFILL_HORIZON_DAYS = 360;
export const MARKET_DATA_BACKFILL_STEPS_PER_CRON = 3;
export const MARKET_DATA_BACKFILL_STATE_VERSION = "diamond-market-data-backfill-state/v1";

export type MarketDataBackfillState = {
  schema_version: typeof MARKET_DATA_BACKFILL_STATE_VERSION;
  anchor_trade_date: string;
  target_start_date: string;
  cursor_date: string;
  status: "RUNNING" | "COMPLETE";
  processed_dates: number;
  updated_at: string;
};

function assertDate(value: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid_backfill_date:${value}`);
}

export function shiftIsoDate(date: string, deltaDays: number) {
  assertDate(date);
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

export function marketDataBackfillStart(anchorTradeDate: string) {
  return shiftIsoDate(anchorTradeDate, -(MARKET_DATA_BACKFILL_HORIZON_DAYS - 1));
}

export function initialMarketDataBackfillState(anchorTradeDate: string, now = new Date()): MarketDataBackfillState {
  assertDate(anchorTradeDate);
  return {
    schema_version: MARKET_DATA_BACKFILL_STATE_VERSION,
    anchor_trade_date: anchorTradeDate,
    target_start_date: marketDataBackfillStart(anchorTradeDate),
    cursor_date: shiftIsoDate(anchorTradeDate, -1),
    status: "RUNNING",
    processed_dates: 0,
    updated_at: now.toISOString(),
  };
}

export function refreshBackfillAnchor(state: MarketDataBackfillState, anchorTradeDate: string, now = new Date()) {
  assertDate(anchorTradeDate);
  if (state.anchor_trade_date === anchorTradeDate) return state;
  const targetStart = marketDataBackfillStart(anchorTradeDate);
  if (state.status === "COMPLETE") {
    return {
      ...state,
      anchor_trade_date: anchorTradeDate,
      target_start_date: targetStart,
      cursor_date: shiftIsoDate(targetStart, -1),
      status: "COMPLETE" as const,
      updated_at: now.toISOString(),
    };
  }
  return {
    ...state,
    anchor_trade_date: anchorTradeDate,
    target_start_date: targetStart,
    status: state.cursor_date < targetStart ? "COMPLETE" as const : "RUNNING" as const,
    updated_at: now.toISOString(),
  };
}

export function shouldAdvanceBackfillCursor(status: string) {
  return [
    "NOOP_ALREADY_COMPLETE",
    "INDEX_COMPLETE",
    "NOOP_NO_TRADING_DAY",
    "NO_TRADING_DAY",
  ].includes(status);
}
