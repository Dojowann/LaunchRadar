export async function projectRegulatoryEvents(DB, { limit = 1000 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));

  const eligible = await DB.prepare(
    `SELECT COUNT(*) AS n
       FROM source_observations o
       JOIN observation_identity oi
         ON oi.observation_id = o.id
        AND oi.resolution_status = 'resolved'
      WHERE o.source_key = 'openfda_drugsfda'
        AND o.observation_type = 'fda_original_approval'`
  ).first();

  const evidenceInsert = await DB.prepare(
    `INSERT INTO evidence
      (id, source_key, source_observation_id, company_id, asset_id,
       fact_key, fact_value, title, url, claim, source_tier, is_primary,
       published_at, observed_at, confidence, content_hash, is_current)
     SELECT
       'evd_fda_' || o.id,
       o.source_key,
       o.id,
       oi.company_id,
       oi.asset_id,
       'fda.original_approval',
       o.external_id,
       COALESCE(o.title, o.external_id),
       o.url,
       'FDA Drugs@FDA original approval: ' || COALESCE(o.title, o.external_id),
       o.source_tier,
       1,
       o.published_at,
       o.observed_at,
       0.99,
       'fda.original_approval|' || o.id,
       1
      FROM source_observations o
      JOIN observation_identity oi
        ON oi.observation_id = o.id
       AND oi.resolution_status = 'resolved'
     WHERE o.source_key = 'openfda_drugsfda'
       AND o.observation_type = 'fda_original_approval'
       AND o.url IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM evidence e
          WHERE e.source_observation_id = o.id
            AND e.fact_key = 'fda.original_approval'
       )
     LIMIT ?`
  )
    .bind(safeLimit)
    .run();

  const eventInsert = await DB.prepare(
    `INSERT OR IGNORE INTO intelligence_events
      (id, company_id, asset_id, event_type, event_date, observed_at,
       status, value_text, value_json, evidence_confidence,
       source_count, primary_source_count, event_hash, active)
     SELECT
       'event_fda_' || o.id,
       oi.company_id,
       oi.asset_id,
       'FDA_APPROVED',
       o.published_at,
       o.observed_at,
       'supported',
       COALESCE(o.asset_name_raw, o.external_id),
       o.payload_json,
       0.99,
       1,
       1,
       'FDA_APPROVED|' || o.id,
       1
      FROM source_observations o
      JOIN observation_identity oi
        ON oi.observation_id = o.id
       AND oi.resolution_status = 'resolved'
     WHERE o.source_key = 'openfda_drugsfda'
       AND o.observation_type = 'fda_original_approval'
     LIMIT ?`
  )
    .bind(safeLimit)
    .run();

  const linkInsert = await DB.prepare(
    `INSERT OR IGNORE INTO event_evidence (event_id, evidence_id)
     SELECT ie.id, e.id
       FROM source_observations o
       JOIN observation_identity oi
         ON oi.observation_id = o.id
        AND oi.resolution_status = 'resolved'
       JOIN intelligence_events ie
         ON ie.event_hash = 'FDA_APPROVED|' || o.id
       JOIN evidence e
         ON e.source_observation_id = o.id
        AND e.fact_key = 'fda.original_approval'
      WHERE o.source_key = 'openfda_drugsfda'
        AND o.observation_type = 'fda_original_approval'
      LIMIT ?`
  )
    .bind(safeLimit)
    .run();

  return {
    eligible: Number(eligible?.n || 0),
    evidenceCreated: Number(evidenceInsert.meta?.changes || 0),
    eventsInserted: Number(eventInsert.meta?.changes || 0),
    linksCreated: Number(linkInsert.meta?.changes || 0),
  };
}

export async function listIntelligenceEvents(
  DB,
  { limit = 100, eventType = "" } = {}
) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const sqlBase = `
    SELECT ie.id, ie.event_type, ie.event_date, ie.observed_at, ie.status,
           ie.value_text, ie.value_json, ie.evidence_confidence,
           ie.source_count, ie.primary_source_count,
           c.canonical_name AS company_name,
           a.canonical_name AS asset_name,
           MIN(e.url) AS source_url,
           MIN(e.claim) AS evidence_claim
      FROM intelligence_events ie
      JOIN companies c ON c.id = ie.company_id
      LEFT JOIN assets a ON a.id = ie.asset_id
      LEFT JOIN event_evidence ee ON ee.event_id = ie.id
      LEFT JOIN evidence e ON e.id = ee.evidence_id
     WHERE ie.active = 1`;

  const stmt = eventType
    ? DB.prepare(
        `${sqlBase}
           AND ie.event_type = ?
         GROUP BY ie.id
         ORDER BY COALESCE(ie.event_date, ie.observed_at) DESC
         LIMIT ?`
      ).bind(eventType, safeLimit)
    : DB.prepare(
        `${sqlBase}
         GROUP BY ie.id
         ORDER BY COALESCE(ie.event_date, ie.observed_at) DESC
         LIMIT ?`
      ).bind(safeLimit);

  const result = await stmt.all();
  return result.results || [];
}
