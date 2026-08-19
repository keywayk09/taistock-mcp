CREATE TABLE IF NOT EXISTS tw_market_data_snapshot_index (
  dataset_version TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  market TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  source_date_verified INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tw_market_data_date_kind
  ON tw_market_data_snapshot_index(kind, trade_date, market, archived_at DESC);

CREATE INDEX IF NOT EXISTS idx_tw_market_data_status
  ON tw_market_data_snapshot_index(status, trade_date, kind);
