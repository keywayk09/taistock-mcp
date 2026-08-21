let requestedTradeDate: string | null = null;

export function setMarketDataCaptureTradeDate(tradeDate: string | null) {
  requestedTradeDate = tradeDate;
}

export function getMarketDataCaptureTradeDate() {
  return requestedTradeDate;
}
