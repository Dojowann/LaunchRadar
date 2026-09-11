import { isoNow, makeId, sha256Hex } from "./normalize.js";

export async function createScanRun(DB, scanType, parameters = {}) {
  const id = makeId("scan");
  const startedAt = isoNow();

  await DB.prepare(
    `INSERT INTO scan_runs
      (id, scan_type, status, started_at, parameters_json, sources_targeted)
     VALUES (?, ?, 'running', ?, ?, 1)`
  )
    .bind(id, scanType, startedAt, JSON.stringify(parameters))
    .run();

  return { id, startedAt };
}

export async function finishScanRun(
  DB,
  scanRunId,
  { status = "complete", observationsFound = 0, errorText = null } = {}
) {
  await DB.prepare(
    `UPDATE scan_runs
       SET status = ?,
           completed_at = ?,
           sources_completed = CASE WHEN ? = 'complete' THEN 1 ELSE sources_completed END,
           observations_found = ?,
           error_count = CASE WHEN ? IS NULL THEN error_count ELSE error_count + 1 END,
           error_text = COALESCE(?, error_text)
     WHERE id = ?`
  )
    .bind(
      status,
      isoNow(),
      status,
      observationsFound,
      errorText,
      errorText,
      scanRunId
    )
    .run();
}

export async function createSourceCheck(
  DB,
  { sourceKey, scanRunId, query = {} }
) {
  const id = makeId("check");
  await DB.prepare(
    `INSERT INTO source_checks
      (id, source_key, scan_run_id, status, started_at, query_json)
     VALUES (?, ?, ?, 'running', ?, ?)`
  )
    .bind(id, sourceKey, scanRunId, isoNow(), JSON.stringify(query))
    .run();
  return id;
}

export async function finishSourceCheck(
  DB,
  id,
  { status = "complete", recordsFound = 0, errorText = null, latestSourceDate = null } = {}
) {
  await DB.prepare(
    `UPDATE source_checks
       SET status = ?,
           completed_at = ?,
           records_found = ?,
           error_text = ?,
           latest_source_date = ?
     WHERE id = ?`
  )
    .bind(
      status,
      isoNow(),
      recordsFound,
      errorText,
      latestSourceDate,
      id
    )
    .run();
}

export async function persistObservations(DB, sourceKey, tier, scanRunId, observations) {
  let inserted = 0;
  let duplicates = 0;

  for (const obs of observations) {
    const observedAt = obs.observedAt || isoNow();
    const payload = obs.payload ?? {};
    const contentHash =
      obs.contentHash ||
      (await sha256Hex({
        sourceKey,
        externalId: obs.externalId,
        title: obs.title || "",
        url: obs.url || "",
        publishedAt: obs.publishedAt || null,
        payload,
      }));

    const result = await DB.prepare(
      `INSERT OR IGNORE INTO source_observations
        (id, source_key, scan_run_id, external_id, observation_type,
         company_name_raw, asset_name_raw, title, url, published_at,
         observed_at, source_tier, payload_json, content_hash, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
      .bind(
        makeId("obs"),
        sourceKey,
        scanRunId,
        obs.externalId,
        obs.observationType,
        obs.companyNameRaw || null,
        obs.assetNameRaw || null,
        obs.title || null,
        obs.url || null,
        obs.publishedAt || null,
        observedAt,
        tier,
        JSON.stringify(payload),
        contentHash
      )
      .run();

    if (result.meta?.changes) inserted += result.meta.changes;
    else duplicates += 1;
  }

  return { inserted, duplicates, total: observations.length };
}
