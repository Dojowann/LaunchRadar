PRAGMA foreign_keys = ON;

-- Remove duplicate FDA_APPROVED intelligence events created by earlier
-- projector versions. Keep the oldest non event_fda_obs_* row when present.
DELETE FROM intelligence_events
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          json_extract(value_json, '$.applicationNumber'),
          event_date
        ORDER BY
          CASE
            WHEN id LIKE 'event_fda_obs_%' THEN 1
            ELSE 0
          END,
          observed_at ASC
      ) AS rn
    FROM intelligence_events
    WHERE event_type = 'FDA_APPROVED'
  )
  WHERE rn > 1
);

-- Enforce one supported FDA approval event per application/date combination.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_fda_approval
ON intelligence_events (
  event_type,
  json_extract(value_json, '$.applicationNumber'),
  event_date
)
WHERE
  event_type = 'FDA_APPROVED'
  AND json_extract(value_json, '$.applicationNumber') IS NOT NULL;
