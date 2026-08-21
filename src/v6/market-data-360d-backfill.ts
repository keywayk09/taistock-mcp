import { readGitHubJson, updateGitHubJson } from "./github-data-store.ts";
import { setMarketDataCaptureTradeDate } from "./market-data-capture-context.ts";
import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner.ts";
import {
  MARKET_DATA_BACKFILL_STATE_VERSION,
  MARKET_DATA_BACKFILL_STEPS_PER_CRON,
  initialMarketDataBackfillState,
  refreshBackfillAnchor,
  shiftIsoDate,
  shouldAdvanceBackfillCursor,
  type MarketDataBackfillState,
} from "./market-data-backfill-policy.ts";

export { MARKET_DATA_BACKFILL_HORIZON_DAYS, MARKET_DATA_BACKFILL_STEPS_PER_CRON } from "./market-data-backfill-policy.ts";

export function marketDataBackfillStatePath() {
  return "data/market-data/backfill/360d-state.json";
}

export async function runMarketData360dBackfillStep(env: Env, input: { anchorTradeDate: string; now?: Date }) {
  const now = input.now ?? new Date();
  const path = marketDataBackfillStatePath();
  const read = await readGitHubJson<MarketDataBackfillState>(env, path);
  let state = read.value?.schema_version === MARKET_DATA_BACKFILL_STATE_VERSION
    ? refreshBackfillAnchor(read.value, input.anchorTradeDate, now)
    : initialMarketDataBackfillState(input.anchorTradeDate, now);

  if (state.status === "COMPLETE" || state.cursor_date < state.target_start_date) {
    state = { ...state, status: "COMPLETE", updated_at: now.toISOString() };
    await updateGitHubJson<MarketDataBackfillState>(env, {
      path,
      defaultValue: state,
      message: "data(market): backfill 360d complete",
      retries: 3,
      merge: () => state,
    });
    return { status: "BACKFILL_COMPLETE" as const, state };
  }

  const tradeDate = state.cursor_date;
  setMarketDataCaptureTradeDate(tradeDate);
  const captures: any[] = [];
  try {
    for (let step = 0; step < MARKET_DATA_BACKFILL_STEPS_PER_CRON; step++) {
      const result = await runSubrequestSafeMarketDataCapture(env, { tradeDate, now });
      captures.push(result);
      if (shouldAdvanceBackfillCursor(String((result as any).status ?? ""))) break;
    }
  } finally {
    setMarketDataCaptureTradeDate(null);
  }

  const last = captures.at(-1) ?? { status: "BACKFILL_NO_CAPTURE" };
  if (shouldAdvanceBackfillCursor(String(last.status ?? ""))) {
    const next = shiftIsoDate(tradeDate, -1);
    state = {
      ...state,
      cursor_date: next,
      processed_dates: state.processed_dates + 1,
      status: next < state.target_start_date ? "COMPLETE" : "RUNNING",
      updated_at: now.toISOString(),
    };
    await updateGitHubJson<MarketDataBackfillState>(env, {
      path,
      defaultValue: state,
      message: `data(market): backfill cursor ${tradeDate}`,
      retries: 3,
      merge: () => state,
    });
  }

  return {
    status: state.status === "COMPLETE" ? "BACKFILL_COMPLETE" as const : "BACKFILL_PROGRESS" as const,
    trade_date: tradeDate,
    captures,
    steps_run: captures.length,
    state,
  };
}
