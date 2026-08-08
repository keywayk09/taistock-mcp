CREATE TABLE IF NOT EXISTS event_ledger (
  ledger_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_version TEXT NOT NULL,
  symbol TEXT,
  event_type TEXT NOT NULL,
  event_ts_ms INTEGER NOT NULL,
  available_ts_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (event_id, event_version)
);
CREATE INDEX IF NOT EXISTS idx_event_ledger_symbol_time ON event_ledger(symbol, available_ts_ms);
CREATE INDEX IF NOT EXISTS idx_event_ledger_type_time ON event_ledger(event_type, available_ts_ms);

CREATE TABLE IF NOT EXISTS signal_ledger (
  ledger_id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  signal_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  side TEXT NOT NULL,
  strategy TEXT NOT NULL,
  stage TEXT NOT NULL,
  signal_ts_ms INTEGER NOT NULL,
  knowledge_cutoff_ts_ms INTEGER NOT NULL,
  data_watermark_ts_ms INTEGER NOT NULL,
  price REAL,
  atr REAL,
  source TEXT NOT NULL,
  dataset_id TEXT,
  dataset_version TEXT,
  dataset_hash TEXT,
  event_refs_json TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (signal_id, signal_version)
);
CREATE INDEX IF NOT EXISTS idx_signal_ledger_date_symbol ON signal_ledger(trade_date, symbol, signal_ts_ms);
CREATE INDEX IF NOT EXISTS idx_signal_ledger_strategy ON signal_ledger(strategy, trade_date, signal_ts_ms);
CREATE INDEX IF NOT EXISTS idx_signal_ledger_stage ON signal_ledger(stage, trade_date, signal_ts_ms);
