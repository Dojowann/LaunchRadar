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
  'smartrecruiters',
  'SmartRecruiters Public Posting API',
  'A',
  'hiring',
  'api',
  'https://api.smartrecruiters.com',
  1,
  1,
  'Published active jobs from the official SmartRecruiters Posting API.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'careers_jsonld',
  'Official Careers Structured Data',
  'A',
  'hiring',
  'html',
  NULL,
  1,
  1,
  'JobPosting JSON-LD extracted directly from verified official company careers pages; used as a vendor-neutral fallback.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(source_key)
DO UPDATE SET
  display_name = excluded.display_name,
  tier = excluded.tier,
  source_class = excluded.source_class,
  access_mode = excluded.access_mode,
  base_url = excluded.base_url,
  is_primary = excluded.is_primary,
  active = excluded.active,
  notes = excluded.notes,
  updated_at = CURRENT_TIMESTAMP;
