PRAGMA foreign_keys = ON;

INSERT INTO source_registry
(
  source_key,
  display_name,
  tier,
  source_class,
  access_mode,
  base_url,
  is_primary,
  active,
  notes,
  created_at,
  updated_at
)
VALUES
(
  'workday',
  'Workday Public Careers',
  'A',
  'hiring',
  'api',
  'https://myworkdayjobs.com',
  1,
  1,
  'Published company job postings via the public Workday CXS careers endpoint.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(source_key) DO UPDATE SET
  display_name = excluded.display_name,
  tier = excluded.tier,
  source_class = excluded.source_class,
  access_mode = excluded.access_mode,
  base_url = excluded.base_url,
  is_primary = excluded.is_primary,
  active = excluded.active,
  notes = excluded.notes,
  updated_at = CURRENT_TIMESTAMP;
