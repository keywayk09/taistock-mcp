import { readGitHubJson, updateGitHubJson } from "./github-data-store.ts";
import { setMarketDataCapturePolicy, setMarketDataCaptureTradeDate } from "./market-data-capture-context.ts";
import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner.ts";
import {
  MARKET_DATA_BACKFILL_STATE_VERSION,
  initialMarketDataBackfillState,
  refreshBackfillAnchor,
  shiftIsoDate,
  shouldAdvanceBackfillCursor,
  type MarketDataBackfillState,
} from "./market-data-backfill-policy.ts";

export { MARKET_DATA_BACKFILL_HORIZON_DAYS } from "./market-data-backfill-policy.ts";

export function marketDataBackfillStatePath() {
  return "data/market-data/backfill/360d-state.json";
}

async function persistState(env: Env, state: MarketDataBackfillState, message: string) {
  return await updateGitHubJson<MarketDataBackfillState>(env, {
    path: marketDataBackfillStatePath(),
    defaultValue: state,
    message,
    retries: 3,
    merge: () => state,
  });
}

export async function runMarketData360dBackfillStep(env: Env, input: { anchorTradeDate: string; now?: Date }) {
  const now = input.now ?? new Date();
  const path = marketDataBackfillStatePath();
  const read = await readGitHubJson<MarketDataBackfillState>(env, path);
  const existing = read.value?.schema_version === MARKET_DATA_BACKFILL_STATE_VERSION ? read.value : null;
  let state = existing
    ? refreshBackfillAnchor(existing, input.anchorTradeDate, now)
    : initialMarketDataBackfillState(input.anchorTradeDate, now);

  // COMPLETE is permanently terminal. Do not rewrite the marker and do not
  // perform any provider/index work on later cron wakes.
  if (state.status === "COMPLETE") {
    return { status: "BACKFILL_COMPLETE" as const, terminal: true, state };
  }

  if (!existing) {
    await persistState(env, state, "data(market): start one-shot 360d backfill");
  }

  if (state.cursor_date < state.target_start_date) {
    state = {
      ...state,
      status: "COMPLETE",
      completed_at: state.completed_at ?? now.toISOString(),
      updated_at: now.toISOString(),
    };
    await persistState(env, state, "data(market): backfill 360d complete");
    return { status: "BACKFILL_COMPLETE" as const, terminal: true, state };
  }

  const tradeDate = state.cursor_date;
  setMarketDataCapturePolicy(null);
  setMarketDataCaptureTradeDate(tradeDate);
  let capture: any;
  try {
    // Exactly one atomic capture/index work unit per call. The outer scheduler
    // decides dynamically how many calls fit in the current safe work budget.
    capture = await runSubrequestSafeMarketDataCapture(env, { tradeDate, now });
  } finally {
    setMarketDataCapturePolicy(null);
    setMarketDataCaptureTradeDate(null);
  }

  if (shouldAdvanceBackfillCursor(String(capture?.status ?? ""))) {
    const next = shiftIsoDate(tradeDate, -1);
    const complete = next < state.target_start_date;
    state = {
      ...state,
      cursor_date: next,
      processed_dates: state.processed_dates + 1,
      status: complete ? "COMPLETE" : "RUNNING",
      completed_at: complete ? (state.completed_at ?? now.toISOString()) : null,
      updated_at: now.toISOString(),
    };
    await persistState(
      env,
      state,
      complete ? "data(market): backfill 360d complete" : `data(market): backfill cursor ${tradeDate}`,
    );
  }

  const captureStatus = String(capture?.status ?? "");
  const waiting = captureStatus === "NOOP_NOT_DUE" || captureStatus === "INDEX_WAITING_FOR_COMPLETE_DAY";
  return {
    status: state.status === "COMPLETE"
      ? "BACKFILL_COMPLETE" as const
      : waiting
        ? "BACKFILL_WAITING" as const
        : "BACKFILL_PROGRESS" as const,
    terminal: state.status === "COMPLETE",
    trade_date: tradeDate,
    captures: [capture],
    steps_run: 1,
    state,
  };
}
