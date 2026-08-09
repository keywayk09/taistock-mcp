CREATE TABLE IF NOT EXISTS supply_chain_snapshot_index (
  dataset_version TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  source_dataset TEXT,
  formal_research_eligible INTEGER NOT NULL,
  entity_count INTEGER NOT NULL,
  instrument_count INTEGER NOT NULL,
  evidence_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  verified_edge_count INTEGER NOT NULL,
  candidate_edge_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  archive_actor TEXT NOT NULL,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_supply_chain_snapshot_asof ON supply_chain_snapshot_index(as_of, archived_at);
CREATE INDEX IF NOT EXISTS idx_supply_chain_snapshot_eligible ON supply_chain_snapshot_index(formal_research_eligible, as_of);

CREATE TABLE IF NOT EXISTS supply_chain_instrument_index (
  dataset_version TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT,
  primary_listing INTEGER NOT NULL,
  PRIMARY KEY(dataset_version, instrument_id)
);
CREATE INDEX IF NOT EXISTS idx_supply_chain_instrument_symbol ON supply_chain_instrument_index(symbol, market, dataset_version);

CREATE TABLE IF NOT EXISTS supply_chain_edge_index (
  dataset_version TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  confidence REAL,
  effective_from TEXT,
  effective_to TEXT,
  PRIMARY KEY(dataset_version, edge_id)
);
CREATE INDEX IF NOT EXISTS idx_supply_chain_edge_source ON supply_chain_edge_index(source_entity_id, dataset_version);
CREATE INDEX IF NOT EXISTS idx_supply_chain_edge_target ON supply_chain_edge_index(target_entity_id, dataset_version);
