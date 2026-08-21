import type { MarketDataKind } from "./market-data-incremental-controller";

export type MarketDataCaptureStorageMode = "DAILY_JSON" | "HISTORY_COMPRESSED";

let requestedTradeDate: string | null = null;
let allowedKinds: MarketDataKind[] | null = null;
let checkpointStartedAt: string | null = null;
let storageMode: MarketDataCaptureStorageMode = "DAILY_JSON";

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
  storageMode = input?.storageMode ?? "DAILY_JSON";
}

export function getMarketDataCapturePolicy() {
  return {
    allowedKinds: allowedKinds ? [...allowedKinds] : null,
    checkpointStartedAt,
    storageMode,
  };
}
