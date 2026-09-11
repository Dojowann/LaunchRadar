import { isoNow, makeId, sha256Hex } from "./normalize.js";

function parsePayload(value) {
  if (!value) return {};
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

async function ensureEvidenceForFdaApproval(DB, observation) {
  const payload = parsePayload(observation.payload_json);
  const approval = payload?.originalApproval || {};
  const applicationNumber = payload?.applicationNumber || observation.external_id;
  const eventDate = approval?.statusDate || observation.published_at || null;
  const factValue = `${applicationNumber}|${eventDate || ""}`;

  const existing = await DB.prepare(
    `SELECT id
       FROM evidence
      WHERE source_observation_id = ?
        AND fact_key = 'fda.original_approval'
        AND fact_value = ?
      LIMIT 1`
  )
    .bind(observation.id, factValue)
    .first();

  if (existing?.id) return { id: existing.id, created: false };

  const id = makeId("evd");
  const brands = Array.isArray(payload?.brands) ? payload.brands : [];
  const assetLabel =
    observation.asset_name_raw || brands[0] || applicationNumber || "application";

  await DB.prepare(
    `INSERT INTO evidence
      (id, source_key, source_observation_id, company_id, asset_id,
       fact_key, fact_value, title, url, claim, source_tier, is_primary,
       published_at, observed_at, confidence, content_hash, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1)`
  )
    .bind(
      id,
      observation.source_key,
      observation.id,
      observation.company_id,
      observation.asset_id || null,
      "fda.original_approval",
      factValue,
      observation.title || `${applicationNumber} FDA original approval`,
      observation.url,
      `FDA Drugs@FDA lists ${assetLabel} (${applicationNumber}) with an approved original submission${
        eventDate ? ` dated ${eventDate}` : ""
      }.`,
      observation.source_tier || "A",
      eventDate,
      observation.observed_at || isoNow(),
      0.99,
      await sha256Hex({
        sourceObservationId: observation.id,
        factKey: "fda.original_approval",
        factValue,
      })
    )
    .run();

  return { id, created: true };
}

export async function projectRegulatoryEvents(DB, { limit = 1000 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const result = await DB.prepare(
    `SELECT o.id, o.source_key, o.external_id, o.observation_type,
            o.company_name_raw, o.asset_name_raw, o.title, o.url,
            o.published_at, o.observed_at, o.source_tier, o.payload_json,
            oi.company_id, oi.asset_id
       FROM source_observations o
       JOIN observation_identity oi
         ON oi.observation_id = o.id
        AND oi.resolution_status = 'resolved'
      WHERE o.source_key = 'openfda_drugsfda'
        AND o.observation_type = 'fda_original_approval'
      ORDER BY o.observed_at ASC
      LIMIT ?`
  )
    .bind(safeLimit)
    .all();

  let examined = 0;
  let eventsInserted = 0;
  let evidenceCreated = 0;
  let linksCreated = 0;

  for (const observation of result.results || []) {
    examined += 1;
    const payload = parsePayload(observation.payload_json);
    const approval = payload?.originalApproval || {};
    const applicationNumber =
      payload?.applicationNumber || observation.external_id || null;
    const eventDate = approval?.statusDate || observation.published_at || null;

    if (
      String(approval?.submissionType || "").toUpperCase() !== "ORIG" ||
      String(approval?.status || "").toUpperCase() !== "AP" ||
      !applicationNumber
    ) {
      continue;
    }

    const evidence = await ensureEvidenceForFdaApproval(DB, observation);
    if (evidence.created) evidenceCreated += 1;

    const eventHash = await sha256Hex({
      eventType: "FDA_APPROVED",
      companyId: observation.company_id,
      assetId: observation.asset_id || null,
      applicationNumber,
      eventDate,
      submissionNumber: approval?.submissionNumber || null,
    });

    const brands = Array.isArray(payload?.brands) ? payload.brands : [];
    const valueText = [
      brands[0] || observation.asset_name_raw || null,
      applicationNumber,
    ]
      .filter(Boolean)
      .join(" — ");

    const inserted = await DB.prepare(
      `INSERT OR IGNORE INTO intelligence_events
        (id, company_id, asset_id, event_type, event_date, observed_at,
         status, value_text, value_json, evidence_confidence,
         source_count, primary_source_count, event_hash, active)
       VALUES (?, ?, ?, 'FDA_APPROVED', ?, ?, 'supported', ?, ?,
               0.99, 1, 1, ?, 1)`
    )
      .bind(
        makeId("event"),
        observation.company_id,
        observation.asset_id || null,
        eventDate,
        observation.observed_at || isoNow(),
        valueText || applicationNumber,
        JSON.stringify({
          applicationNumber,
          applicationType: payload?.applicationType || null,
          brands,
          activeIngredients: payload?.activeIngredients || [],
          reviewPriority: approval?.reviewPriority || null,
          submissionNumber: approval?.submissionNumber || null,
          submissionClassCode: approval?.submissionClassCode || null,
          submissionClassCodeDescription:
            approval?.submissionClassCodeDescription || null,
        }),
        eventHash
      )
      .run();

    if (inserted.meta?.changes) eventsInserted += inserted.meta.changes;

    const event = await DB.prepare(
      `SELECT id FROM intelligence_events WHERE event_hash = ? LIMIT 1`
    )
      .bind(eventHash)
      .first();

    if (event?.id) {
      const link = await DB.prepare(
        `INSERT OR IGNORE INTO event_evidence (event_id, evidence_id)
         VALUES (?, ?)`
      )
        .bind(event.id, evidence.id)
        .run();
      if (link.meta?.changes) linksCreated += link.meta.changes;
    }
  }

  return { examined, eventsInserted, evidenceCreated, linksCreated };
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
