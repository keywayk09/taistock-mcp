import type { MarketDataBackfillState } from "./market-data-backfill-policy.ts";

export const MARKET_DATA_BACKFILL_STATE_PATH = "data/market-data/backfill/360d-state.json";

// Published generation shards copy the whole current-month index shard. While
// the one-shot history cursor is still inside that same month, publishing now
// would freeze an incomplete month into an immutable generation. Wait until
// the cursor has crossed into the prior month (or bootstrap is COMPLETE).
export function shouldWaitForHistoryMonth(
  state: MarketDataBackfillState | null | undefined,
  tradeDate: string,
) {
  if (!state || state.status === "COMPLETE") return false;
  return state.cursor_date.slice(0, 7) === tradeDate.slice(0, 7);
}
