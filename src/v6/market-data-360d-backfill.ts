import { readGitHubJson, updateGitHubJson } from "./github-data-store.ts";
import { setMarketDataCapturePolicy, setMarketDataCaptureTradeDate } from "./market-data-capture-context.ts";
import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner.ts";
import { runAdaptiveHistoryIndexSlice } from "./market-data-history-index.ts";
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

  if (state.status === "COMPLETE") {
    return { status: "BACKFILL_COMPLETE" as const, terminal: true, state, estimated_subrequests: 1 };
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
    return { status: "BACKFILL_COMPLETE" as const, terminal: true, state, estimated_subrequests: 3 };
  }

  const tradeDate = state.cursor_date;
  const preparedManifest = await prepareHistoryManifest(env, tradeDate, now.toISOString());

  setMarketDataCapturePolicy(null);
  setMarketDataCaptureTradeDate(tradeDate);
  let capture: any;
  try {
    if (
      preparedManifest?.terminal === true
      && preparedManifest?.day_status === "COMPLETE"
      && preparedManifest?.index_state?.status !== "READY"
    ) {
      capture = await runAdaptiveHistoryIndexSlice(env, {
        tradeDate,
        manifest: preparedManifest,
        capturedAt: now.toISOString(),
        deadlineAtMs: input.deadlineAtMs ?? (Date.now() + 30_000),
        subrequestBudget: Math.max(12, Math.floor(input.subrequestBudget ?? 32)),
      });
    } else {
      capture = await runSubrequestSafeMarketDataCapture(env, { tradeDate, now });
    }
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
  const waiting = captureStatus === "NOOP_NOT_DUE"
    || captureStatus === "INDEX_WAITING_FOR_COMPLETE_DAY"
    || captureStatus === "INDEX_YIELD";
  const estimatedSubrequests = 2
    + Number(capture?.estimated_subrequests ?? 6)
    + (shouldAdvanceBackfillCursor(captureStatus) ? 2 : 0);
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
    estimated_subrequests: estimatedSubrequests,
  };
}
