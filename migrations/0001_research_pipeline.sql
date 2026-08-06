CREATE TABLE IF NOT EXISTS research_runs (
  run_id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  mode TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  selected_count INTEGER NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  error_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_research_runs_date ON research_runs(trade_date, started_at DESC);

CREATE TABLE IF NOT EXISTS research_universe (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  name TEXT,
  close REAL,
  change_percent REAL,
  trade_volume REAL,
  trade_value REAL,
  range_percent REAL,
  selected_rank INTEGER,
  selected_reasons_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, symbol)
);
CREATE INDEX IF NOT EXISTS idx_research_universe_rank ON research_universe(trade_date, selected_rank);

CREATE TABLE IF NOT EXISTS research_candle_sets (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source TEXT NOT NULL,
  bar_count INTEGER NOT NULL DEFAULT 0,
  first_time TEXT,
  last_time TEXT,
  missing_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_ohlc_count INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  status TEXT NOT NULL,
  error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, symbol, timeframe)
);
CREATE INDEX IF NOT EXISTS idx_research_candles_status ON research_candle_sets(trade_date, timeframe, status);

CREATE TABLE IF NOT EXISTS engine_labels (
  id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  event_time TEXT NOT NULL,
  strategy TEXT NOT NULL,
  side TEXT NOT NULL,
  price REAL,
  stage TEXT,
  reason_codes_json TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engine_labels_lookup ON engine_labels(trade_date, symbol, event_time);

CREATE TABLE IF NOT EXISTS research_cases (
  id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  verdict TEXT NOT NULL,
  strategy TEXT,
  event_time TEXT,
  score REAL,
  mfe_r REAL,
  mae_r REAL,
  evidence_json TEXT,
  created_at TEXT NOT NULL
);
