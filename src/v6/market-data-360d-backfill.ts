import { readGitHubJson, updateGitHubJson } from "./github-data-store.ts";
import { setMarketDataCapturePolicy, setMarketDataCaptureTradeDate } from "./market-data-capture-context.ts";
import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner.ts";
import { promoteLegacyCompleteManifest } from "./market-data-legacy-manifest.ts";
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

function dailyManifestPath(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
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

async function prepareHistoryManifest(env: Env, tradeDate: string, capturedAt: string) {
  const path = dailyManifestPath(tradeDate);
  const read = await readGitHubJson<any>(env, path);
  const promoted = promoteLegacyCompleteManifest(read.value, capturedAt);
  if (!promoted) return read.value;
  await updateGitHubJson<any>(env, {
    path,
    defaultValue: promoted,
    message: `data(market): promote legacy complete ${tradeDate}`,
    retries: 3,
    merge: (current) => promoteLegacyCompleteManifest(current, capturedAt) ?? current,
  });
  return promoted;
}

function historyCaptureComplete(tradeDate: string) {
  return {
    trade_date: tradeDate,
    status: "HISTORY_CAPTURE_COMPLETE" as const,
    day_status: "COMPLETE" as const,
    terminal: true,
    index_status: "DEFERRED_TO_HISTORY_BUILDER_V2" as const,
    estimated_subrequests: 0,
  };
}

function waitingForBuilder(state: MarketDataBackfillState, estimatedSubrequests = 1) {
  return {
    status: "BACKFILL_WAITING" as const,
    reason: "WAITING_HISTORY_BUILDER_V2" as const,
    terminal: false,
    state,
    captures: [],
    steps_run: 0,
    estimated_subrequests: estimatedSubrequests,
  };
}

export async function runMarketData360dBackfillStep(env: Env, input: {
  anchorTradeDate: string;
  now?: Date;
  deadlineAtMs?: number;
  subrequestBudget?: number;
}) {
  const now = input.now ?? new Date();
  const path = marketDataBackfillStatePath();
  const read = await readGitHubJson<MarketDataBackfillState>(env, path);
  const existing = read.value?.schema_version === MARKET_DATA_BACKFILL_STATE_VERSION ? read.value : null;
  let state = existing
    ? refreshBackfillAnchor(existing, input.anchorTradeDate, now)
    : initialMarketDataBackfillState(input.anchorTradeDate, now);

  // History Builder V2 is the only component allowed to turn BUILD -> COMPLETE.
  // Once COMPLETE is observed from canonical state, the one-shot bootstrap is terminal.
  if (state.status === "COMPLETE") {
    return { status: "BACKFILL_COMPLETE" as const, terminal: true, state, estimated_subrequests: 1 };
  }

  if (!existing) {
    await persistState(env, state, "data(market): start one-shot retention backfill");
  } else if (state.target_start_date !== existing.target_start_date) {
    await persistState(env, state, "data(market): apply shortened history retention");
  } else if (state.phase !== existing.phase) {
    await persistState(env, state, "data(market): migrate History Builder V2 phase");
  }

  if (state.phase === "BUILD") {
    return waitingForBuilder(state);
  }

  // Crossing the retention target means capture is finished, not bootstrap complete.
  // The canonical-repo History Builder V2 must still rebuild/audit every required month.
  if (state.cursor_date < state.target_start_date) {
    state = {
      ...state,
      phase: "BUILD",
      status: "RUNNING",
      completed_at: null,
      updated_at: now.toISOString(),
    };
    await persistState(env, state, "data(market): History capture phase complete; waiting month builder");
    return waitingForBuilder(state, 3);
  }

  const tradeDate = state.cursor_date;
  const preparedManifest = await prepareHistoryManifest(env, tradeDate, now.toISOString());

  setMarketDataCapturePolicy({ storageMode: "HISTORY_COMPRESSED" });
  setMarketDataCaptureTradeDate(tradeDate);
  let capture: any;
  try {
    // Bulk historical indexing is intentionally NOT performed inside Cloudflare.
    // A terminal canonical day is enough to advance the capture cursor; the
    // canonical-repo History Builder V2 later rebuilds the whole month locally.
    if (preparedManifest?.terminal === true && preparedManifest?.day_status === "COMPLETE") {
      capture = historyCaptureComplete(tradeDate);
    } else {
      capture = await runSubrequestSafeMarketDataCapture(env, { tradeDate, now });
    }
  } finally {
    setMarketDataCapturePolicy(null);
    setMarketDataCaptureTradeDate(null);
  }

  const captureStatus = String(capture?.status ?? "");
  if (shouldAdvanceBackfillCursor(captureStatus)) {
    const next = shiftIsoDate(tradeDate, -1);
    const captureFinished = next < state.target_start_date;
    state = {
      ...state,
      cursor_date: next,
      processed_dates: state.processed_dates + 1,
      phase: captureFinished ? "BUILD" : "CAPTURE",
      status: "RUNNING",
      completed_at: null,
      updated_at: now.toISOString(),
    };
    await persistState(
      env,
      state,
      captureFinished
        ? "data(market): History capture phase complete; waiting month builder"
        : `data(market): backfill cursor ${tradeDate}`,
    );
  }

  const waiting = captureStatus === "NOOP_NOT_DUE"
    || captureStatus === "INDEX_WAITING_FOR_COMPLETE_DAY"
    || captureStatus === "INDEX_YIELD"
    || state.phase === "BUILD";
  const estimatedSubrequests = 2
    + Number(capture?.estimated_subrequests ?? 6)
    + (shouldAdvanceBackfillCursor(captureStatus) ? 2 : 0);

  return {
    status: waiting ? "BACKFILL_WAITING" as const : "BACKFILL_PROGRESS" as const,
    reason: state.phase === "BUILD" ? "WAITING_HISTORY_BUILDER_V2" as const : undefined,
    terminal: false,
    trade_date: tradeDate,
    captures: [capture],
    steps_run: 1,
    state,
    history_builder: "diamond-market-data-history-builder/v2",
    estimated_subrequests: estimatedSubrequests,
  };
}
