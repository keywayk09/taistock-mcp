import type { MarketDataKind } from "./market-data-incremental-controller";

let requestedTradeDate: string | null = null;
let allowedKinds: MarketDataKind[] | null = null;
let checkpointStartedAt: string | null = null;

export function setMarketDataCaptureTradeDate(tradeDate: string | null) {
  requestedTradeDate = tradeDate;
}

export function getMarketDataCaptureTradeDate() {
  return requestedTradeDate;
}

export function setMarketDataCapturePolicy(input: {
  allowedKinds?: MarketDataKind[] | null;
  checkpointStartedAt?: string | null;
} | null) {
  allowedKinds = input?.allowedKinds?.length ? [...input.allowedKinds] : null;
  checkpointStartedAt = input?.checkpointStartedAt ?? null;
}

export function getMarketDataCapturePolicy() {
  return {
    allowedKinds: allowedKinds ? [...allowedKinds] : null,
    checkpointStartedAt,
  };
}
