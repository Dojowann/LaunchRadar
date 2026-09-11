PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_registry (
  source_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('A','B','C')),
  source_class TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  base_url TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  cik TEXT,
  ticker TEXT,
  website TEXT,
  company_type TEXT,
  headquarters TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_companies_cik ON companies(cik);
CREATE INDEX IF NOT EXISTS idx_companies_ticker ON companies(ticker);

CREATE TABLE IF NOT EXISTS company_aliases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_company_aliases_norm ON company_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  indication TEXT,
  therapeutic_area TEXT,
  modality TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS asset_aliases (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_asset_aliases_norm ON asset_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  scan_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  requested_by TEXT,
  parameters_json TEXT,
  sources_targeted INTEGER NOT NULL DEFAULT 0,
  sources_completed INTEGER NOT NULL DEFAULT 0,
  observations_found INTEGER NOT NULL DEFAULT 0,
  companies_discovered INTEGER NOT NULL DEFAULT 0,
  new_opportunities INTEGER NOT NULL DEFAULT 0,
  updated_opportunities INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS scan_steps (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  source_key TEXT REFERENCES source_registry(source_key),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  records_found INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_steps_run ON scan_steps(scan_run_id, started_at);

CREATE TABLE IF NOT EXISTS source_checks (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES source_registry(source_key),
  scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  records_found INTEGER NOT NULL DEFAULT 0,
  query_json TEXT,
  error_text TEXT,
  latest_source_date TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_checks_company ON source_checks(company_id, source_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_checks_run ON source_checks(scan_run_id, started_at);

CREATE TABLE IF NOT EXISTS source_targets (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL REFERENCES source_registry(source_key),
  target_key TEXT,
  target_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, source_key, target_key)
);

CREATE TABLE IF NOT EXISTS source_observations (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES source_registry(source_key),
  scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  observation_type TEXT NOT NULL,
  company_name_raw TEXT,
  asset_name_raw TEXT,
  title TEXT,
  url TEXT,
  published_at TEXT,
  observed_at TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  UNIQUE(source_key, external_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_observations_source ON source_observations(source_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_company_raw ON source_observations(company_name_raw);
CREATE INDEX IF NOT EXISTS idx_observations_published ON source_observations(published_at DESC);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES source_registry(source_key),
  source_observation_id TEXT REFERENCES source_observations(id) ON DELETE SET NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  fact_key TEXT,
  fact_value TEXT,
  title TEXT,
  url TEXT NOT NULL,
  claim TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  published_at TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  conflict_group TEXT,
  content_hash TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_evidence_company ON evidence(company_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_asset ON evidence(asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_fact ON evidence(fact_key, fact_value);

CREATE TABLE IF NOT EXISTS intelligence_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date TEXT,
  observed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'supported',
  value_text TEXT,
  value_number REAL,
  value_json TEXT,
  evidence_confidence REAL NOT NULL DEFAULT 0.5 CHECK (evidence_confidence >= 0 AND evidence_confidence <= 1),
  source_count INTEGER NOT NULL DEFAULT 0,
  primary_source_count INTEGER NOT NULL DEFAULT 0,
  event_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  superseded_by TEXT REFERENCES intelligence_events(id)
);

CREATE INDEX IF NOT EXISTS idx_events_company ON intelligence_events(company_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_asset ON intelligence_events(asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON intelligence_events(event_type, event_date DESC);

CREATE TABLE IF NOT EXISTS event_evidence (
  event_id TEXT NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY(event_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS job_postings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL REFERENCES source_registry(source_key),
  external_job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  role_family TEXT,
  role_level TEXT,
  department TEXT,
  location TEXT,
  url TEXT NOT NULL,
  posted_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  removed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  payload_hash TEXT,
  UNIQUE(company_id, source_key, external_job_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_company ON job_postings(company_id, status, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_family ON job_postings(role_family, status);

CREATE TABLE IF NOT EXISTS rights_relationships (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  territory TEXT NOT NULL DEFAULT 'US',
  rights_holder_company_id TEXT REFERENCES companies(id),
  partner_name_raw TEXT,
  rights_type TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rights_asset ON rights_relationships(asset_id, territory, status);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  hiring_phase INTEGER NOT NULL DEFAULT 0 CHECK (hiring_phase BETWEEN 0 AND 6),
  hiring_phase_label TEXT NOT NULL DEFAULT 'Early',
  regulatory_score REAL NOT NULL DEFAULT 0,
  commercial_ownership_score REAL NOT NULL DEFAULT 0,
  org_build_score REAL NOT NULL DEFAULT 0,
  hiring_score REAL NOT NULL DEFAULT 0,
  timing_score REAL NOT NULL DEFAULT 0,
  execution_capacity_score REAL NOT NULL DEFAULT 0,
  opportunity_score REAL NOT NULL DEFAULT 0,
  evidence_confidence REAL NOT NULL DEFAULT 0,
  source_coverage REAL NOT NULL DEFAULT 0,
  recommended_action TEXT NOT NULL DEFAULT 'MONITOR',
  next_expected_hiring_event TEXT,
  rationale TEXT,
  scored_at TEXT,
  scoring_version TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_action ON opportunities(recommended_action, opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_phase ON opportunities(hiring_phase, opportunity_score DESC);

CREATE TABLE IF NOT EXISTS opportunity_snapshots (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  hiring_phase INTEGER NOT NULL,
  opportunity_score REAL NOT NULL,
  evidence_confidence REAL NOT NULL,
  source_coverage REAL NOT NULL,
  recommended_action TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_opp ON opportunity_snapshots(opportunity_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES intelligence_events(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  detected_at TEXT NOT NULL,
  acknowledged_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_changes_detected ON changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_company ON changes(company_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  note TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, asset_id)
);

INSERT OR REPLACE INTO source_registry
(source_key, display_name, tier, source_class, access_mode, base_url, is_primary, active, notes)
VALUES
('clinicaltrials_gov','ClinicalTrials.gov','A','clinical','api','https://clinicaltrials.gov',1,1,'Official NIH/NLM clinical-trial registry.'),
('sec_edgar','SEC EDGAR','A','corporate','api','https://data.sec.gov',1,1,'Official SEC submissions and filing metadata.'),
('openfda_drugsfda','openFDA / Drugs@FDA','A','regulatory','api','https://api.fda.gov/drug/drugsfda.json',1,1,'Official FDA-derived approved-drug/application data.'),
('fda_adcom','FDA Advisory Committee Calendar','A','regulatory','web','https://www.fda.gov/advisory-committees/advisory-committee-calendar',1,1,'Official FDA Advisory Committee calendar.'),
('company_ir','Company Investor Relations','A','company','web_research',NULL,1,1,'Primary company releases, presentations, earnings materials, and launch guidance.'),
('company_careers','Company Careers','A','hiring','web_research',NULL,1,1,'Primary company careers pages when no structured ATS feed is available.'),
('greenhouse','Greenhouse Public Job Board','A','hiring','api','https://boards-api.greenhouse.io',1,1,'Published company job postings.'),
('lever','Lever Public Postings','A','hiring','api','https://api.lever.co',1,1,'Published company job postings.'),
('ashby','Ashby Public Job Board','A','hiring','api','https://api.ashbyhq.com/posting-api/job-board',1,1,'Published company job postings.'),
('fda_tracker','FDA Tracker','B','regulatory','web_research','https://www.fdatracker.com/fda-calendar/',0,1,'Discovery source for PDUFA and AdCom catalysts; corroborate with primary sources.'),
('trade_press','Life-Sciences Trade Press','B','media','web_research',NULL,0,1,'Discovery/context; corroborate material facts.'),
('general_web','Other Public Web','C','web','web_research',NULL,0,1,'Lead generation only; high-impact claims require corroboration.');
