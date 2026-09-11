import { isoNow, makeId, normalizeName, normalizeWhitespace } from "./normalize.js";

function parsePayload(value) {
  if (!value) return {};
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

function eligibleForCompanyResolution(observation) {
  if (!normalizeWhitespace(observation.company_name_raw)) return false;

  // ClinicalTrials.gov contains universities, government agencies and hospitals.
  // For the recruiting product, only auto-promote INDUSTRY lead sponsors.
  if (observation.source_key === "clinicaltrials_gov") {
    const payload = parsePayload(observation.payload_json);
    return String(payload?.sponsorClass || "").toUpperCase() === "INDUSTRY";
  }

  return true;
}

async function resolveCompany(DB, rawName) {
  const canonicalName = normalizeWhitespace(rawName);
  const normalized = normalizeName(canonicalName);
  if (!normalized) return { status: "unresolved", company: null, method: "empty_name", confidence: 0 };

  const exact = await DB.prepare(
    `SELECT id, canonical_name, normalized_name
       FROM companies
      WHERE normalized_name = ?
      LIMIT 1`
  ).bind(normalized).first();

  if (exact) {
    return { status: "resolved", company: exact, method: "normalized_exact", confidence: 0.95 };
  }

  const aliases = await DB.prepare(
    `SELECT c.id, c.canonical_name, c.normalized_name
       FROM company_aliases a
       JOIN companies c ON c.id = a.company_id
      WHERE a.normalized_alias = ?
      LIMIT 3`
  ).bind(normalized).all();

  const aliasRows = aliases.results || [];
  if (aliasRows.length === 1) {
    return { status: "resolved", company: aliasRows[0], method: "alias_exact", confidence: 0.90 };
  }
  if (aliasRows.length > 1) {
    return { status: "ambiguous", company: null, method: "alias_conflict", confidence: 0.30 };
  }

  const id = makeId("co");
  await DB.prepare(
    `INSERT INTO companies
      (id, canonical_name, normalized_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, canonicalName, normalized, isoNow(), isoNow()).run();

  await DB.prepare(
    `INSERT OR IGNORE INTO company_aliases
      (id, company_id, alias, normalized_alias, alias_type)
     VALUES (?, ?, ?, ?, 'source_name')`
  ).bind(makeId("alias"), id, canonicalName, normalized).run();

  return {
    status: "resolved",
    company: { id, canonical_name: canonicalName, normalized_name: normalized },
    method: "created_from_primary_source",
    confidence: 0.80,
  };
}

async function ensureAlias(DB, companyId, rawName) {
  const alias = normalizeWhitespace(rawName);
  const normalizedAlias = normalizeName(alias);
  if (!alias || !normalizedAlias) return;

  await DB.prepare(
    `INSERT OR IGNORE INTO company_aliases
      (id, company_id, alias, normalized_alias, alias_type)
     VALUES (?, ?, ?, ?, 'source_name')`
  ).bind(makeId("alias"), companyId, alias, normalizedAlias).run();
}

async function resolveAsset(DB, companyId, rawName) {
  const canonicalName = normalizeWhitespace(rawName);
  const normalized = normalizeName(canonicalName);
  if (!companyId || !normalized) return null;

  const exact = await DB.prepare(
    `SELECT id, canonical_name, normalized_name
       FROM assets
      WHERE company_id = ? AND normalized_name = ?
      LIMIT 1`
  ).bind(companyId, normalized).first();

  if (exact) return exact;

  const alias = await DB.prepare(
    `SELECT a2.id, a2.canonical_name, a2.normalized_name
       FROM asset_aliases aa
       JOIN assets a2 ON a2.id = aa.asset_id
      WHERE a2.company_id = ? AND aa.normalized_alias = ?
      LIMIT 1`
  ).bind(companyId, normalized).first();

  if (alias) return alias;

  const id = makeId("asset");
  await DB.prepare(
    `INSERT INTO assets
      (id, company_id, canonical_name, normalized_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, companyId, canonicalName, normalized, isoNow(), isoNow()).run();

  await DB.prepare(
    `INSERT OR IGNORE INTO asset_aliases
      (id, asset_id, alias, normalized_alias, alias_type)
     VALUES (?, ?, ?, ?, 'source_name')`
  ).bind(makeId("asset_alias"), id, canonicalName, normalized).run();

  return { id, canonical_name: canonicalName, normalized_name: normalized };
}

export async function resolveObservationIdentities(DB, { limit = 500 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));

  const result = await DB.prepare(
    `SELECT o.id, o.source_key, o.company_name_raw, o.asset_name_raw,
            o.payload_json, o.observed_at
       FROM source_observations o
       LEFT JOIN observation_identity oi ON oi.observation_id = o.id
      WHERE oi.observation_id IS NULL
      ORDER BY o.observed_at ASC
      LIMIT ?`
  ).bind(safeLimit).all();

  const observations = result.results || [];
  let resolved = 0;
  let skipped = 0;
  let ambiguous = 0;
  let companiesCreated = 0;
  let assetsCreated = 0;

  for (const observation of observations) {
    if (!eligibleForCompanyResolution(observation)) {
      await DB.prepare(
        `INSERT OR IGNORE INTO observation_identity
          (observation_id, resolution_status, resolution_method, confidence, resolved_at, notes)
         VALUES (?, 'skipped', 'non_industry_or_missing_company', 1.0, ?, ?)`
      ).bind(
        observation.id,
        isoNow(),
        observation.source_key === "clinicaltrials_gov"
          ? "ClinicalTrials.gov lead sponsor is not classified as INDUSTRY."
          : "Observation has no resolvable company name."
      ).run();
      skipped += 1;
      continue;
    }

    const beforeCompany = await DB.prepare(`SELECT COUNT(*) AS n FROM companies`).first();
    const companyResult = await resolveCompany(DB, observation.company_name_raw);
    const afterCompany = await DB.prepare(`SELECT COUNT(*) AS n FROM companies`).first();
    if (Number(afterCompany?.n || 0) > Number(beforeCompany?.n || 0)) companiesCreated += 1;

    if (companyResult.status === "ambiguous") {
      await DB.prepare(
        `INSERT OR IGNORE INTO observation_identity
          (observation_id, resolution_status, resolution_method, confidence, resolved_at, notes)
         VALUES (?, 'ambiguous', ?, ?, ?, ?)`
      ).bind(
        observation.id,
        companyResult.method,
        companyResult.confidence,
        isoNow(),
        `Multiple companies share normalized alias: ${normalizeName(observation.company_name_raw)}`
      ).run();
      ambiguous += 1;
      continue;
    }

    const company = companyResult.company;
    if (!company) {
      skipped += 1;
      continue;
    }

    await ensureAlias(DB, company.id, observation.company_name_raw);

    let asset = null;
    if (normalizeWhitespace(observation.asset_name_raw)) {
      const beforeAsset = await DB.prepare(
        `SELECT COUNT(*) AS n FROM assets WHERE company_id = ?`
      ).bind(company.id).first();
      asset = await resolveAsset(DB, company.id, observation.asset_name_raw);
      const afterAsset = await DB.prepare(
        `SELECT COUNT(*) AS n FROM assets WHERE company_id = ?`
      ).bind(company.id).first();
      if (Number(afterAsset?.n || 0) > Number(beforeAsset?.n || 0)) assetsCreated += 1;
    }

    await DB.prepare(
      `INSERT OR REPLACE INTO observation_identity
        (observation_id, company_id, asset_id, resolution_status,
         resolution_method, confidence, resolved_at, notes)
       VALUES (?, ?, ?, 'resolved', ?, ?, ?, ?)`
    ).bind(
      observation.id,
      company.id,
      asset?.id || null,
      companyResult.method,
      companyResult.confidence,
      isoNow(),
      "Deterministic exact-name/alias resolution; no fuzzy matching."
    ).run();

    resolved += 1;
  }

  return {
    examined: observations.length,
    resolved,
    skipped,
    ambiguous,
    companiesCreated,
    assetsCreated,
  };
}

export async function listCanonicalCompanies(DB, { limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const result = await DB.prepare(
    `SELECT c.id,
            c.canonical_name,
            c.normalized_name,
            c.ticker,
            c.cik,
            c.website,
            COUNT(DISTINCT oi.observation_id) AS evidence_count,
            COUNT(DISTINCT a.id) AS asset_count,
            MAX(o.published_at) AS latest_source_date,
            MAX(o.observed_at) AS latest_observed_at
       FROM companies c
       LEFT JOIN observation_identity oi ON oi.company_id = c.id AND oi.resolution_status = 'resolved'
       LEFT JOIN source_observations o ON o.id = oi.observation_id
       LEFT JOIN assets a ON a.company_id = c.id
      GROUP BY c.id, c.canonical_name, c.normalized_name, c.ticker, c.cik, c.website
      ORDER BY latest_observed_at DESC, c.canonical_name ASC
      LIMIT ?`
  ).bind(safeLimit).all();

  return result.results || [];
}
