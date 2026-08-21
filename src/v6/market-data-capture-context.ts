import type { MarketDataKind } from "./market-data-incremental-controller";

export type MarketDataCaptureStorageMode = "DAILY_JSON" | "HISTORY_COMPRESSED";

let requestedTradeDate: string | null = null;
let allowedKinds: MarketDataKind[] | null = null;
let checkpointStartedAt: string | null = null;
// Compatibility note: HISTORY_COMPRESSED is now the safe default for all heavy
// immutable Market Data artifacts (raw evidence + daily snapshots), including
// current-day capture. Small control-plane JSON remains plain/readable because
// github-data-store only applies this mode to the heavy canonical path classes.
let storageMode: MarketDataCaptureStorageMode = "HISTORY_COMPRESSED";

export function setMarketDataCaptureTradeDate(tradeDate: string | null) {
  requestedTradeDate = tradeDate;
}

export function getMarketDataCaptureTradeDate() {
  return requestedTradeDate;
}

export function setMarketDataCapturePolicy(input: {
  allowedKinds?: MarketDataKind[] | null;
  checkpointStartedAt?: string | null;
  storageMode?: MarketDataCaptureStorageMode | null;
} | null) {
  allowedKinds = input?.allowedKinds?.length ? [...input.allowedKinds] : null;
  checkpointStartedAt = input?.checkpointStartedAt ?? null;
  storageMode = input?.storageMode ?? "HISTORY_COMPRESSED";
}

export function getMarketDataCapturePolicy() {
  return {
    allowedKinds: allowedKinds ? [...allowedKinds] : null,
    checkpointStartedAt,
    storageMode,
  };
}
