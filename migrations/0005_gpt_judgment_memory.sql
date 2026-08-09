CREATE TABLE IF NOT EXISTS gpt_judgments (
  judgment_id TEXT NOT NULL,
  judgment_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  judgment_ts_ms INTEGER NOT NULL,
  knowledge_cutoff_ts_ms INTEGER NOT NULL,
  data_watermark_ts_ms INTEGER NOT NULL,
  direction TEXT NOT NULL,
  confidence REAL NOT NULL,
  thesis TEXT NOT NULL,
  risk_reward_score REAL,
  structures_json TEXT NOT NULL,
  support_levels_json TEXT NOT NULL,
  resistance_levels_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (judgment_id, judgment_version)
);
CREATE INDEX IF NOT EXISTS idx_gpt_judgments_market_date ON gpt_judgments(market, trade_date, judgment_ts_ms);
CREATE INDEX IF NOT EXISTS idx_gpt_judgments_symbol_date ON gpt_judgments(symbol, trade_date, judgment_ts_ms);

CREATE TABLE IF NOT EXISTS gpt_judgment_reasons (
  judgment_id TEXT NOT NULL,
  judgment_version TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  family TEXT,
  weight REAL,
  note TEXT,
  PRIMARY KEY (judgment_id, judgment_version, reason_code)
);
CREATE INDEX IF NOT EXISTS idx_gpt_judgment_reasons_code ON gpt_judgment_reasons(reason_code);

CREATE TABLE IF NOT EXISTS gpt_judgment_trendlines (
  trendline_id TEXT NOT NULL,
  judgment_id TEXT NOT NULL,
  judgment_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  quality TEXT NOT NULL,
  anchor_count INTEGER NOT NULL,
  anchors_json TEXT NOT NULL,
  slope_price_per_bar REAL,
  slope_normalized REAL,
  touch_count INTEGER,
  false_break_count INTEGER,
  distance_atr REAL,
  distance_pct REAL,
  current_price REAL,
  projected_price REAL,
  expected_behavior TEXT,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY (trendline_id, judgment_id, judgment_version)
);
CREATE INDEX IF NOT EXISTS idx_gpt_trendlines_type ON gpt_judgment_trendlines(type, status, quality);

CREATE TABLE IF NOT EXISTS gpt_judgment_patterns (
  pattern_id TEXT NOT NULL,
  judgment_id TEXT NOT NULL,
  judgment_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  detected_at_ts_ms INTEGER NOT NULL,
  upper_boundary REAL,
  lower_boundary REAL,
  compression_atr REAL,
  volume_behavior TEXT,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY (pattern_id, judgment_id, judgment_version)
);
CREATE INDEX IF NOT EXISTS idx_gpt_patterns_type ON gpt_judgment_patterns(pattern_type, status);

CREATE TABLE IF NOT EXISTS gpt_judgment_reviews (
  review_id TEXT NOT NULL,
  review_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  judgment_id TEXT NOT NULL,
  judgment_version TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  outcome_horizon TEXT NOT NULL,
  outcome_ts_ms INTEGER NOT NULL,
  dataset_id TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  dataset_timeframe TEXT NOT NULL,
  return_pct REAL,
  mfe_pct REAL,
  mae_pct REAL,
  return_points REAL,
  mfe_points REAL,
  mae_points REAL,
  direction_correct INTEGER,
  location_quality TEXT,
  timing_quality TEXT,
  structure_correct INTEGER,
  pattern_correct INTEGER,
  trendline_correct INTEGER,
  risk_reward_correct INTEGER,
  attribution_json TEXT NOT NULL,
  failure_patterns_json TEXT NOT NULL,
  optimization_hypotheses_json TEXT NOT NULL,
  interpretation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (review_id, review_version)
);
CREATE INDEX IF NOT EXISTS idx_gpt_reviews_judgment ON gpt_judgment_reviews(judgment_id, judgment_version);
CREATE INDEX IF NOT EXISTS idx_gpt_reviews_market_symbol ON gpt_judgment_reviews(market, symbol, outcome_ts_ms);

CREATE TABLE IF NOT EXISTS gpt_trading_knowledge (
  knowledge_id TEXT NOT NULL,
  knowledge_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  market_scope TEXT NOT NULL,
  topic TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_count INTEGER NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  human_approved INTEGER NOT NULL,
  rationale TEXT,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (knowledge_id, knowledge_version)
);
CREATE INDEX IF NOT EXISTS idx_gpt_knowledge_topic_status ON gpt_trading_knowledge(topic, status, market_scope);
