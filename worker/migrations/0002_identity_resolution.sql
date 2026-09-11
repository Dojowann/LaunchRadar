PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS observation_identity (
  observation_id TEXT PRIMARY KEY REFERENCES source_observations(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  resolution_status TEXT NOT NULL DEFAULT 'resolved',
  resolution_method TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.75 CHECK (confidence >= 0 AND confidence <= 1),
  resolved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_observation_identity_company
  ON observation_identity(company_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_observation_identity_asset
  ON observation_identity(asset_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_observation_identity_status
  ON observation_identity(resolution_status, resolved_at DESC);
