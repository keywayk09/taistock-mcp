CREATE TABLE IF NOT EXISTS tw_market_data_snapshot_d1 (
  dataset_version TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  market TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  source_date_verified INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tw_market_data_d1_date_kind
  ON tw_market_data_snapshot_d1(kind, trade_date, market, captured_at DESC);

CREATE TABLE IF NOT EXISTS tw_market_data_row_d1 (
  dataset_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(dataset_version, symbol)
);

CREATE INDEX IF NOT EXISTS idx_tw_market_data_d1_symbol
  ON tw_market_data_row_d1(symbol, dataset_version);
