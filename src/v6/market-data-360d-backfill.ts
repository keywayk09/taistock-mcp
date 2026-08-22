import { readGitHubJson, updateGitHubJson } from "./github-data-store.ts";
import { setMarketDataCapturePolicy, setMarketDataCaptureTradeDate } from "./market-data-capture-context.ts";
import { runSubrequestSafeMarketDataCapture } from "./market-data-cloudflare-chunked-runner.ts";
import {
  HISTORY_BUILDER_V2_VERSION,
  runHistoryMonthBuildV2,
  stageHistoryDayV2,
} from "./market-data-history-builder-v2.ts";
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
    merge: (current) => {
      // COMPLETE is terminal and may only be produced after Builder V2 audit.
      if (current?.status === "COMPLETE") return current;
      return state;
    },
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

function historyCaptureComplete(tradeDate: string, stage: any) {
  return {
    ...stage,
    trade_date: tradeDate,
    status: "HISTORY_CAPTURE_COMPLETE" as const,
    day_status: "COMPLETE" as const,
    terminal: true,
    index_status: "STAGED_FOR_HISTORY_BUILDER_V2" as const,
  };
}

function migrationYield(state: MarketDataBackfillState) {
  return {
    status: "BACKFILL_WAITING" as const,
    reason: "HISTORY_V2_STATE_MIGRATED" as const,
    terminal: false,
    state,
    captures: [],
    steps_run: 0,
    estimated_subrequests: 3,
  };
}

async function runBuildPhase(env: Env, state: MarketDataBackfillState, now: Date) {
  const build = await runHistoryMonthBuildV2(env, {
    state,
    capturedAt: now.toISOString(),
  });
  const buildStatus = String(build.status ?? "");
  if (buildStatus === "HISTORY_V2_ALL_MONTHS_READY") {
    const complete: MarketDataBackfillState = {
      ...state,
      phase: "BUILD",
      status: "COMPLETE",
      completed_at: state.completed_at ?? now.toISOString(),
      updated_at: now.toISOString(),
      history_builder: HISTORY_BUILDER_V2_VERSION,
    };
    await persistState(env, complete, "data(market): History Builder V2 bootstrap complete");
    return {
      status: "BACKFILL_COMPLETE" as const,
      terminal: true,
      state: complete,
      builder: build,
      estimated_subrequests: Number(build.estimated_subrequests ?? 0) + 2,
    };
  }
  const waiting = buildStatus === "HISTORY_V2_BUILD_YIELD" || buildStatus.includes("WAITING");
  return {
    status: waiting ? "BACKFILL_WAITING" as const : "BACKFILL_PROGRESS" as const,
    reason: buildStatus,
    terminal: false,
    state,
    builder: build,
    captures: [],
    steps_run: 1,
    estimated_subrequests: Number(build.estimated_subrequests ?? 0),
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

  if (state.status === "COMPLETE") {
    return { status: "BACKFILL_COMPLETE" as const, terminal: true, state, estimated_subrequests: 1 };
  }

  if (!existing) {
    await persistState(env, state, "data(market): start one-shot retention backfill");
    return migrationYield(state);
  }
  if (state.target_start_date !== existing.target_start_date) {
    await persistState(env, state, "data(market): apply shortened history retention");
    return migrationYield(state);
  }
  if (state.phase !== existing.phase) {
    await persistState(env, state, "data(market): migrate History Builder V2 phase");
    return migrationYield(state);
  }

  if (state.phase === "BUILD") {
    return await runBuildPhase(env, state, now);
  }

  // Crossing the retention target means capture+staging is finished. Builder V2
  // then compacts one month-prefix/finalize batch per wake and performs the
  // terminal audit before the bootstrap can become COMPLETE.
  if (state.cursor_date < state.target_start_date) {
    state = {
      ...state,
      phase: "BUILD",
      status: "RUNNING",
      completed_at: null,
      updated_at: now.toISOString(),
      history_builder: HISTORY_BUILDER_V2_VERSION,
    };
    await persistState(env, state, "data(market): History V2 capture staging complete; start month build");
    return {
      status: "BACKFILL_WAITING" as const,
      reason: "HISTORY_V2_BUILD_PHASE_STARTED" as const,
      terminal: false,
      state,
      captures: [],
      steps_run: 0,
      estimated_subrequests: 3,
    };
  }

  const tradeDate = state.cursor_date;
  const preparedManifest = await prepareHistoryManifest(env, tradeDate, now.toISOString());

  setMarketDataCapturePolicy({ storageMode: "HISTORY_COMPRESSED" });
  setMarketDataCaptureTradeDate(tradeDate);
  let capture: any;
  try {
    if (preparedManifest?.terminal === true && preparedManifest?.day_status === "COMPLETE") {
      if (preparedManifest?.index_state?.status === "READY") {
        // Dates already compacted by the legacy indexer do not need V2 staging;
        // their rows are preserved when later V2 staged dates are merged.
        capture = {
          trade_date: tradeDate,
          status: "NOOP_ALREADY_COMPLETE",
          day_status: "COMPLETE",
          terminal: true,
          index_status: "READY",
          estimated_subrequests: 0,
        };
      } else {
        const staged = await stageHistoryDayV2(env, {
          tradeDate,
          manifest: preparedManifest,
          capturedAt: now.toISOString(),
        });
        if (staged.status === "HISTORY_V2_STAGE_YIELD") {
          capture = staged;
        } else {
          capture = historyCaptureComplete(tradeDate, staged);
        }
      }
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
      history_builder: HISTORY_BUILDER_V2_VERSION,
    };
    await persistState(
      env,
      state,
      captureFinished
        ? "data(market): History V2 capture staging complete; start month build"
        : `data(market): backfill cursor ${tradeDate}`,
    );
  }

  const waiting = captureStatus === "NOOP_NOT_DUE"
    || captureStatus === "CALENDAR_UNKNOWN"
    || captureStatus === "INDEX_WAITING_FOR_COMPLETE_DAY"
    || captureStatus === "INDEX_YIELD"
    || captureStatus === "HISTORY_V2_STAGE_YIELD"
    || state.phase === "BUILD";
  const estimatedSubrequests = 2
    + Number(capture?.estimated_subrequests ?? 6)
    + (shouldAdvanceBackfillCursor(captureStatus) ? 2 : 0);

  return {
    status: waiting ? "BACKFILL_WAITING" as const : "BACKFILL_PROGRESS" as const,
    reason: captureStatus === "CALENDAR_UNKNOWN"
      ? "OFFICIAL_CALENDAR_UNAVAILABLE"
      : captureStatus === "HISTORY_V2_STAGE_YIELD"
        ? "HISTORY_V2_STAGE_CAS_CONFLICT"
        : state.phase === "BUILD"
          ? "HISTORY_V2_BUILD_PHASE_STARTED"
          : undefined,
    terminal: false,
    trade_date: tradeDate,
    captures: [capture],
    steps_run: 1,
    state,
    history_builder: HISTORY_BUILDER_V2_VERSION,
    estimated_subrequests: estimatedSubrequests,
  };
}
