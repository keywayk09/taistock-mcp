export const MARKET_DATA_BACKFILL_HORIZON_DAYS = 180;
export const MARKET_DATA_BACKFILL_STATE_VERSION = "diamond-market-data-backfill-state/v2";

export type MarketDataBackfillPhase = "CAPTURE" | "BUILD";

export type MarketDataBackfillState = {
  schema_version: typeof MARKET_DATA_BACKFILL_STATE_VERSION;
  anchor_trade_date: string;
  target_start_date: string;
  cursor_date: string;
  phase: MarketDataBackfillPhase;
  status: "RUNNING" | "COMPLETE";
  processed_dates: number;
  updated_at: string;
  completed_at: string | null;
  history_builder?: string;
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
    phase: "CAPTURE",
    status: "RUNNING",
    processed_dates: 0,
    updated_at: now.toISOString(),
    completed_at: null,
  };
}

function normalizedPhase(state: MarketDataBackfillState) {
  return state.phase ?? (state.cursor_date < state.target_start_date ? "BUILD" : "CAPTURE");
}

// The history bootstrap stays one-shot. COMPLETE is permanently terminal.
// A RUNNING legacy 360-day state may only shrink to the current retention
// window; it can never be extended by a newer daily anchor. Legacy v2 states
// without `phase` are migrated in place without resetting the cursor.
export function refreshBackfillAnchor(state: MarketDataBackfillState, anchorTradeDate: string, now = new Date()): MarketDataBackfillState {
  assertDate(anchorTradeDate);
  const normalized: MarketDataBackfillState = {
    ...state,
    phase: normalizedPhase(state),
  };
  if (normalized.status === "COMPLETE") return normalized;
  const desiredTarget = marketDataBackfillStart(normalized.anchor_trade_date);
  if (normalized.target_start_date >= desiredTarget) return normalized;
  return {
    ...normalized,
    target_start_date: desiredTarget,
    updated_at: now.toISOString(),
  };
}

export function shouldAdvanceBackfillCursor(status: string) {
  return [
    "HISTORY_CAPTURE_COMPLETE",
    "NOOP_ALREADY_COMPLETE",
    "INDEX_COMPLETE", // legacy already-indexed dates remain resumable.
    "NOOP_NO_TRADING_DAY",
    "NO_TRADING_DAY",
  ].includes(status);
}
