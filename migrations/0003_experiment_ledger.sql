CREATE TABLE IF NOT EXISTS experiment_ledger (
  experiment_ledger_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  experiment_version TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  hypothesis_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  strategy_id TEXT,
  strategy_version TEXT,
  signal_refs_json TEXT NOT NULL,
  dataset_refs_json TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  profit_factor REAL,
  win_rate REAL,
  expectancy_pct REAL,
  mfe_pct REAL,
  mae_pct REAL,
  regime TEXT,
  validation_status TEXT NOT NULL,
  rejection_reason TEXT,
  content_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(experiment_id, experiment_version)
);

CREATE INDEX IF NOT EXISTS idx_experiment_hypothesis_hash
  ON experiment_ledger(hypothesis_hash, recorded_at);
CREATE INDEX IF NOT EXISTS idx_experiment_strategy
  ON experiment_ledger(strategy_id, strategy_version, recorded_at);
CREATE INDEX IF NOT EXISTS idx_experiment_validation
  ON experiment_ledger(validation_status, recorded_at);

CREATE TABLE IF NOT EXISTS experiment_decision_ledger (
  decision_ledger_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  decision_version TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  experiment_version TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  rationale TEXT,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(decision_id, decision_version)
);

CREATE INDEX IF NOT EXISTS idx_experiment_decision_target
  ON experiment_decision_ledger(experiment_id, experiment_version, recorded_at);
