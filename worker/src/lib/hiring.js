import {
  collectAshby,
  collectGreenhouse,
  collectLever,
  collectWorkday,
} from "../collectors/ats.js";
import { persistObservations } from "./db.js";
import {
  classifyCommercialRole,
  isoNow,
  makeId,
  normalizeWhitespace,
  sha256Hex,
} from "./normalize.js";

const DISCOVERY_VERSION = "workday-v1";

const DISCOVERY_SCHEMA = {
  type: "object",
  properties: {
    targets: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          company_index: { type: "integer", minimum: 0, maximum: 9 },
          provider: {
            type: "string",
            enum: ["greenhouse", "lever", "ashby", "workday", "none"],
          },
          board_url: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["company_index", "provider", "board_url", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["targets"],
  additionalProperties: false,
};

function responseText(payload) {
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function searchedUrls(payload) {
  const urls = new Set();

  for (const item of payload?.output || []) {
    if (item?.type === "web_search_call") {
      const sources = item?.action?.sources || item?.results || [];
      for (const source of sources) {
        const url = cleanUrl(source?.url);
        if (url) urls.add(url);
      }
    }

    if (item?.type === "message") {
      for (const content of item?.content || []) {
        for (const annotation of content?.annotations || []) {
          if (annotation?.type === "url_citation") {
            const url = cleanUrl(annotation?.url);
            if (url) urls.add(url);
          }
        }
      }
    }
  }

  return urls;
}

function urlWasSearched(url, sources) {
  const target = cleanUrl(url);
  if (!target) return false;
  if (sources.has(target)) return true;

  let parsedTarget;
  try {
    parsedTarget = new URL(target);
  } catch {
    return false;
  }

  for (const candidate of sources) {
    try {
      const parsed = new URL(candidate);
      if (
        parsed.hostname === parsedTarget.hostname &&
        (parsed.pathname === parsedTarget.pathname ||
          parsed.pathname.startsWith(parsedTarget.pathname) ||
          parsedTarget.pathname.startsWith(parsed.pathname))
      ) {
        return true;
      }
    } catch {}
  }

  return false;
}

function parseAtsTarget(provider, rawUrl) {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return null;

  let url;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (provider === "greenhouse") {
    const allowed = [
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "boards-api.greenhouse.io",
    ];
    if (!allowed.includes(host)) return null;

    let key = null;
    if (host === "boards-api.greenhouse.io") {
      const boardIndex = parts.indexOf("boards");
      if (boardIndex >= 0) key = parts[boardIndex + 1] || null;
    } else {
      key = parts[0] || null;
    }

    return key
      ? { sourceKey: "greenhouse", targetKey: key, targetUrl: cleaned }
      : null;
  }

  if (provider === "lever") {
    const allowed = ["jobs.lever.co", "api.lever.co", "api.eu.lever.co"];
    if (!allowed.includes(host)) return null;

    let key = null;
    if (host === "jobs.lever.co") {
      key = parts[0] || null;
    } else {
      const postingsIndex = parts.indexOf("postings");
      if (postingsIndex >= 0) key = parts[postingsIndex + 1] || null;
    }

    return key
      ? {
          sourceKey: "lever",
          targetKey: key,
          targetUrl: cleaned,
          region: host === "api.eu.lever.co" ? "eu" : "global",
        }
      : null;
  }

  if (provider === "ashby") {
    const allowed = ["jobs.ashbyhq.com", "api.ashbyhq.com"];
    if (!allowed.includes(host)) return null;

    let key = null;
    if (host === "jobs.ashbyhq.com") {
      key = parts[0] || null;
    } else {
      const boardIndex = parts.indexOf("job-board");
      if (boardIndex >= 0) key = parts[boardIndex + 1] || null;
    }

    return key
      ? { sourceKey: "ashby", targetKey: key, targetUrl: cleaned }
      : null;
  }

  if (provider === "workday") {
    if (!host.endsWith(".myworkdayjobs.com")) return null;

    const origin = `${url.protocol}//${url.host}`;
    let tenant = host.split(".")[0] || null;
    let site = null;
    let locale = "en-US";

    if (parts[0] === "wday" && parts[1] === "cxs") {
      tenant = parts[2] || tenant;
      site = parts[3] || null;
    } else {
      const localeMatch = parts[0] && /^[a-z]{2}-[a-z]{2}$/i.test(parts[0]);
      if (localeMatch) {
        locale = parts[0];
        site = parts[1] || null;
      } else {
        site = parts[0] || null;
      }
    }

    if (!tenant || !site || ["job", "jobs", "wday"].includes(site.toLowerCase())) {
      return null;
    }

    return {
      sourceKey: "workday",
      targetKey: `${tenant}:${site}`,
      targetUrl: `${origin}/${locale}/${site}`,
      workdayOrigin: origin,
      workdayTenant: tenant,
      workdaySite: site,
      workdayLocale: locale,
    };
  }

  return null;
}

async function ensureWorkdaySourceRegistry(DB) {
  await DB.prepare(
    `INSERT INTO source_registry
      (source_key, display_name, tier, source_class, access_mode, base_url,
       is_primary, active, notes, created_at, updated_at)
     VALUES
      ('workday', 'Workday Public Careers', 'A', 'hiring', 'api',
       'https://myworkdayjobs.com', 1, 1,
       'Published company job postings via the public Workday CXS careers endpoint.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(source_key) DO UPDATE SET
       display_name = excluded.display_name,
       tier = excluded.tier,
       source_class = excluded.source_class,
       access_mode = excluded.access_mode,
       base_url = excluded.base_url,
       is_primary = excluded.is_primary,
       active = excluded.active,
       notes = excluded.notes,
       updated_at = CURRENT_TIMESTAMP`
  ).run();
}

async function chooseCompanies(DB, batchSize) {
  const safe = Math.max(1, Math.min(Number(batchSize) || 5, 10));

  const result = await DB.prepare(
    `SELECT
       c.id,
       c.canonical_name,
       c.website,
       MAX(sc.started_at) AS last_hiring_check,
       MAX(o.opportunity_score) AS opportunity_score
     FROM companies c
     LEFT JOIN source_checks sc
       ON sc.company_id = c.id
      AND sc.source_key = 'company_careers'
      AND json_extract(sc.query_json, '$.discoveryVersion') = ?
     LEFT JOIN opportunities o
       ON o.company_id = c.id
     GROUP BY c.id, c.canonical_name, c.website
     ORDER BY
       CASE WHEN MAX(sc.started_at) IS NULL THEN 0 ELSE 1 END ASC,
       COALESCE(MAX(o.opportunity_score), 0) DESC,
       COALESCE(MAX(sc.started_at), '') ASC,
       c.canonical_name ASC
     LIMIT ?`
  )
    .bind(DISCOVERY_VERSION, safe)
    .all();

  return result.results || [];
}

async function existingTargets(DB, companyIds) {
  if (!companyIds.length) return [];

  const placeholders = companyIds.map(() => "?").join(",");
  const result = await DB.prepare(
    `SELECT
       st.id,
       st.company_id,
       st.source_key,
       st.target_key,
       st.target_url,
       st.metadata_json,
       c.canonical_name AS company_name
     FROM source_targets st
     JOIN companies c
       ON c.id = st.company_id
     WHERE st.enabled = 1
       AND st.source_key IN ('greenhouse','lever','ashby','workday')
       AND st.company_id IN (${placeholders})`
  )
    .bind(...companyIds)
    .all();

  return result.results || [];
}

async function discoverMissingTargets(env, companies) {
  if (!companies.length) return [];
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

  const companyText = companies
    .map(
      (company, index) =>
        `${index}. ${company.canonical_name}\n   Website: ${company.website || "unknown"}`
    )
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      reasoning: { effort: "medium" },
      tools: [{ type: "web_search", search_context_size: "medium" }],
      include: ["web_search_call.action.sources"],
      input: [
        {
          role: "system",
          content:
            "Find the current official careers job board for each company. Report only Greenhouse, Lever, Ashby, or Workday (myworkdayjobs.com). Prefer a board reached from the company's official careers site. For Workday, return the actual myworkdayjobs.com board or job URL so the tenant and career-site name are visible. Never guess a board slug, Workday tenant, or Workday site. Return provider=none when none of these four systems can be verified. board_url must be a real URL found during web research.",
        },
        {
          role: "user",
          content: `Current date: ${new Date().toISOString().slice(0, 10)}\n\nCompanies:\n\n${companyText}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "launch_radar_ats_discovery",
          strict: true,
          schema: DISCOVERY_SCHEMA,
        },
      },
    }),
  });

  const raw = await response.text();
  let payload;

  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI ATS discovery returned non-JSON HTTP ${response.status}.`);
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `OpenAI ATS discovery returned ${response.status}.`
    );
  }

  const text = responseText(payload);
  if (!text) throw new Error("OpenAI ATS discovery returned no structured output.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("ATS discovery output was not valid JSON.");
  }

  const sources = searchedUrls(payload);
  const output = [];

  for (const target of parsed?.targets || []) {
    const company = companies[Number(target?.company_index)];
    if (!company || target?.provider === "none") continue;
    if (!urlWasSearched(target?.board_url, sources)) continue;

    const parsedTarget = parseAtsTarget(target.provider, target.board_url);
    if (!parsedTarget) continue;

    output.push({
      companyId: company.id,
      companyName: company.canonical_name,
      confidence: Number(target.confidence) || 0,
      ...parsedTarget,
    });
  }

  return output;
}

async function upsertTarget(DB, target) {
  const existing = await DB.prepare(
    `SELECT id
       FROM source_targets
      WHERE company_id = ?
        AND source_key = ?
        AND target_key = ?
      LIMIT 1`
  )
    .bind(target.companyId, target.sourceKey, target.targetKey)
    .first();

  const metadata = JSON.stringify({
    discoveryConfidence: target.confidence ?? null,
    region: target.region || null,
    workdayOrigin: target.workdayOrigin || null,
    workdayTenant: target.workdayTenant || null,
    workdaySite: target.workdaySite || null,
    workdayLocale: target.workdayLocale || null,
  });

  if (existing?.id) {
    await DB.prepare(
      `UPDATE source_targets
          SET target_url = ?,
              enabled = 1,
              metadata_json = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(target.targetUrl, metadata, isoNow(), existing.id)
      .run();

    return existing.id;
  }

  const id = makeId("target");

  await DB.prepare(
    `INSERT INTO source_targets
      (id, company_id, source_key, target_key, target_url, enabled,
       metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  )
    .bind(
      id,
      target.companyId,
      target.sourceKey,
      target.targetKey,
      target.targetUrl,
      metadata,
      isoNow(),
      isoNow()
    )
    .run();

  return id;
}

async function writeCompanyCareersCheck(
  DB,
  scanRunId,
  companyId,
  recordsFound,
  errorText = null
) {
  const stamp = isoNow();

  await DB.prepare(
    `INSERT INTO source_checks
      (id, source_key, scan_run_id, company_id, asset_id, status,
       started_at, completed_at, records_found, query_json, error_text,
       latest_source_date)
     VALUES (?, 'company_careers', ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`
  )
    .bind(
      makeId("check"),
      scanRunId,
      companyId,
      errorText ? "error" : "complete",
      stamp,
      stamp,
      recordsFound,
      JSON.stringify({
        purpose: "ATS discovery",
        discoveryVersion: DISCOVERY_VERSION,
      }),
      errorText
    )
    .run();
}

async function writeProviderCheck(
  DB,
  scanRunId,
  target,
  recordsFound,
  latestSourceDate,
  errorText = null
) {
  const stamp = isoNow();

  await DB.prepare(
    `INSERT INTO source_checks
      (id, source_key, scan_run_id, company_id, asset_id, status,
       started_at, completed_at, records_found, query_json, error_text,
       latest_source_date)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      makeId("check"),
      target.sourceKey,
      scanRunId,
      target.companyId,
      errorText ? "error" : "complete",
      stamp,
      stamp,
      recordsFound,
      JSON.stringify({
        targetKey: target.targetKey,
        targetUrl: target.targetUrl,
        discoveryVersion: DISCOVERY_VERSION,
      }),
      errorText,
      latestSourceDate || null
    )
    .run();
}

function targetMetadata(target) {
  try {
    return JSON.parse(target.metadata_json || "{}");
  } catch {
    return {};
  }
}

async function collectTarget(target) {
  if (target.sourceKey === "greenhouse") {
    return collectGreenhouse({
      boardToken: target.targetKey,
      companyName: target.companyName,
    });
  }

  if (target.sourceKey === "lever") {
    const metadata = targetMetadata(target);
    return collectLever({
      site: target.targetKey,
      companyName: target.companyName,
      region: metadata.region || "global",
    });
  }

  if (target.sourceKey === "ashby") {
    return collectAshby({
      boardName: target.targetKey,
      companyName: target.companyName,
    });
  }

  if (target.sourceKey === "workday") {
    const metadata = targetMetadata(target);
    const [tenantFromKey, siteFromKey] = String(target.targetKey || "").split(":");

    let origin = metadata.workdayOrigin || "";
    if (!origin) {
      try {
        const targetUrl = new URL(target.targetUrl);
        origin = `${targetUrl.protocol}//${targetUrl.host}`;
      } catch {}
    }

    return collectWorkday({
      companyName: target.companyName,
      origin,
      tenant: metadata.workdayTenant || tenantFromKey,
      site: metadata.workdaySite || siteFromKey,
      locale: metadata.workdayLocale || "en-US",
      maxJobs: 400,
    });
  }

  throw new Error(`Unsupported ATS source: ${target.sourceKey}`);
}

function dateOnly(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function eventTypeForJob(title, roleFamily) {
  const t = normalizeWhitespace(title).toLowerCase();

  if (roleFamily === "sales_leadership") {
    if (
      /regional business director|regional sales director|area business director|area sales director/.test(
        t
      )
    ) {
      return "RBD_JOB_POSTED";
    }
    return "SALES_MANAGER_JOB_POSTED";
  }

  if (roleFamily === "market_access") return "MARKET_ACCESS_BUILD";

  if (roleFamily === "field_sales") {
    if (/key account manager|strategic account manager|\bkam\b/.test(t)) {
      return "KAM_JOB_POSTED";
    }
    return "FIELD_SALES_JOB_POSTED";
  }

  return null;
}

async function upsertJobInventory(DB, target, observation) {
  const payload = observation.payload || {};
  const role = classifyCommercialRole(observation.title || "");
  const stamp = isoNow();
  const payloadHash = await sha256Hex(payload);
  const externalId = String(observation.externalId || observation.url || "");

  if (!externalId || !observation.url) return null;

  const existing = await DB.prepare(
    `SELECT id, first_seen_at
       FROM job_postings
      WHERE company_id = ?
        AND source_key = ?
        AND external_job_id = ?
      LIMIT 1`
  )
    .bind(target.companyId, target.sourceKey, externalId)
    .first();

  const id = existing?.id || makeId("job");

  await DB.prepare(
    `INSERT INTO job_postings
      (id, company_id, source_key, external_job_id, title, normalized_title,
       role_family, role_level, department, location, url, posted_at,
       first_seen_at, last_seen_at, removed_at, status, payload_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?)
     ON CONFLICT(company_id, source_key, external_job_id)
     DO UPDATE SET
       title = excluded.title,
       normalized_title = excluded.normalized_title,
       role_family = excluded.role_family,
       role_level = excluded.role_level,
       department = excluded.department,
       location = excluded.location,
       url = excluded.url,
       posted_at = COALESCE(excluded.posted_at, job_postings.posted_at),
       last_seen_at = excluded.last_seen_at,
       removed_at = NULL,
       status = 'active',
       payload_hash = excluded.payload_hash`
  )
    .bind(
      id,
      target.companyId,
      target.sourceKey,
      externalId,
      normalizeWhitespace(observation.title || "Job posting"),
      normalizeWhitespace(observation.title || "").toLowerCase(),
      role.family,
      role.level,
      payload.department || null,
      payload.location || null,
      observation.url,
      observation.publishedAt || null,
      existing?.first_seen_at || stamp,
      stamp,
      payloadHash
    )
    .run();

  return {
    id,
    externalId,
    role,
    isNew: !existing,
    title: observation.title || "Job posting",
    url: observation.url,
    postedAt: observation.publishedAt || null,
    location: payload.location || null,
  };
}

async function evidenceAndEventForJob(DB, target, job) {
  if (!job?.role?.commercial) {
    return { eventCreated: false, evidenceCreated: false };
  }

  const eventType = eventTypeForJob(job.title, job.role.family);
  if (!eventType) return { eventCreated: false, evidenceCreated: false };

  const sourceObservation = await DB.prepare(
    `SELECT id
       FROM source_observations
      WHERE source_key = ?
        AND external_id = ?
      ORDER BY observed_at DESC
      LIMIT 1`
  )
    .bind(target.sourceKey, job.externalId)
    .first();

  const factKey = `job.${eventType.toLowerCase()}`;
  const contentHash = await sha256Hex({
    companyId: target.companyId,
    sourceKey: target.sourceKey,
    externalId: job.externalId,
    factKey,
  });

  let evidence = await DB.prepare(
    `SELECT id FROM evidence WHERE content_hash = ? LIMIT 1`
  )
    .bind(contentHash)
    .first();

  let evidenceCreated = false;

  if (!evidence?.id) {
    const id = makeId("evd");

    await DB.prepare(
      `INSERT INTO evidence
        (id, source_key, source_observation_id, company_id, asset_id, fact_key,
         fact_value, title, url, claim, source_tier, is_primary, published_at,
         observed_at, confidence, content_hash, is_current)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'A', 1, ?, ?, 0.98, ?, 1)`
    )
      .bind(
        id,
        target.sourceKey,
        sourceObservation?.id || null,
        target.companyId,
        factKey,
        job.title,
        job.title,
        job.url,
        `${target.companyName} posted ${job.title}${
          job.location ? ` — ${job.location}` : ""
        }.`,
        dateOnly(job.postedAt),
        isoNow(),
        contentHash
      )
      .run();

    evidence = { id };
    evidenceCreated = true;
  }

  const eventHash = await sha256Hex({
    type: eventType,
    companyId: target.companyId,
    sourceKey: target.sourceKey,
    externalId: job.externalId,
  });

  let event = await DB.prepare(
    `SELECT id FROM intelligence_events WHERE event_hash = ? LIMIT 1`
  )
    .bind(eventHash)
    .first();

  let eventCreated = false;

  if (!event?.id) {
    const id = makeId("event");

    await DB.prepare(
      `INSERT INTO intelligence_events
        (id, company_id, asset_id, event_type, event_date, observed_at, status,
         value_text, value_json, evidence_confidence, source_count,
         primary_source_count, event_hash, active)
       VALUES (?, ?, NULL, ?, ?, ?, 'supported', ?, ?, 0.98, 1, 1, ?, 1)`
    )
      .bind(
        id,
        target.companyId,
        eventType,
        dateOnly(job.postedAt),
        isoNow(),
        job.title,
        JSON.stringify({
          title: job.title,
          location: job.location,
          sourceKey: target.sourceKey,
          externalJobId: job.externalId,
          jobPostingId: job.id,
        }),
        eventHash
      )
      .run();

    event = { id };
    eventCreated = true;
  }

  await DB.prepare(
    `INSERT OR IGNORE INTO event_evidence(event_id, evidence_id) VALUES (?, ?)`
  )
    .bind(event.id, evidence.id)
    .run();

  return { eventCreated, evidenceCreated };
}

async function scanTarget(DB, scanRunId, target) {
  const collected = await collectTarget(target);

  if (collected.completeInventory !== false) {
    await DB.prepare(
      `UPDATE job_postings
          SET status = 'removed', removed_at = COALESCE(removed_at, ?)
        WHERE company_id = ?
          AND source_key = ?
          AND status = 'active'`
    )
      .bind(isoNow(), target.companyId, target.sourceKey)
      .run();
  }

  const persisted = await persistObservations(
    DB,
    collected.sourceKey,
    collected.tier,
    scanRunId,
    collected.observations
  );

  let activeCommercial = 0;
  let newCommercial = 0;
  let eventsInserted = 0;
  let evidenceCreated = 0;

  for (const observation of collected.observations) {
    const job = await upsertJobInventory(DB, target, observation);
    if (!job?.role?.commercial) continue;

    activeCommercial += 1;
    if (job.isNew) newCommercial += 1;

    const projected = await evidenceAndEventForJob(DB, target, job);
    if (projected.eventCreated) eventsInserted += 1;
    if (projected.evidenceCreated) evidenceCreated += 1;
  }

  const latestSourceDate =
    collected.observations
      .map((x) => x.publishedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

  await writeProviderCheck(
    DB,
    scanRunId,
    target,
    collected.observations.length,
    latestSourceDate
  );

  return {
    sourceKey: target.sourceKey,
    companyName: target.companyName,
    jobsFound: collected.observations.length,
    activeCommercial,
    newCommercial,
    eventsInserted,
    evidenceCreated,
    observationsInserted: persisted.inserted,
    completeInventory: collected.completeInventory !== false,
  };
}

export async function scanHiringBatch(DB, env, { batchSize = 5 } = {}) {
  await ensureWorkdaySourceRegistry(DB);

  const companies = await chooseCompanies(DB, batchSize);

  if (!companies.length) {
    return {
      companiesChecked: 0,
      targetsScanned: 0,
      jobsFound: 0,
      activeCommercialJobs: 0,
      newCommercialJobs: 0,
      eventsInserted: 0,
      evidenceCreated: 0,
      targetsDiscovered: 0,
      results: [],
    };
  }

  const scanRunId = makeId("scan");
  const startedAt = isoNow();

  await DB.prepare(
    `INSERT INTO scan_runs
      (id, scan_type, status, started_at, parameters_json, sources_targeted)
     VALUES (?, 'hiring_scan', 'running', ?, ?, ?)`
  )
    .bind(
      scanRunId,
      startedAt,
      JSON.stringify({
        batchSize,
        discoveryVersion: DISCOVERY_VERSION,
        companyIds: companies.map((x) => x.id),
      }),
      companies.length
    )
    .run();

  try {
    const companyIds = companies.map((x) => x.id);
    const existing = await existingTargets(DB, companyIds);
    const existingByCompany = new Map();

    for (const target of existing) {
      if (!existingByCompany.has(target.company_id)) {
        existingByCompany.set(target.company_id, []);
      }
      existingByCompany.get(target.company_id).push(target);
    }

    const missing = companies.filter(
      (company) => !existingByCompany.has(company.id)
    );

    const discovered = await discoverMissingTargets(env, missing);

    for (const target of discovered) {
      await upsertTarget(DB, target);
    }

    const discoveredByCompany = new Map();
    for (const target of discovered) {
      if (!discoveredByCompany.has(target.companyId)) {
        discoveredByCompany.set(target.companyId, []);
      }
      discoveredByCompany.get(target.companyId).push(target);
    }

    for (const company of companies) {
      const count =
        (existingByCompany.get(company.id)?.length || 0) +
        (discoveredByCompany.get(company.id)?.length || 0);

      await writeCompanyCareersCheck(DB, scanRunId, company.id, count);
    }

    const refreshed = await existingTargets(DB, companyIds);
    const results = [];

    for (const row of refreshed) {
      const target = {
        companyId: row.company_id,
        companyName: row.company_name,
        sourceKey: row.source_key,
        targetKey: row.target_key,
        targetUrl: row.target_url,
        metadata_json: row.metadata_json,
      };

      try {
        results.push(await scanTarget(DB, scanRunId, target));
      } catch (error) {
        await writeProviderCheck(
          DB,
          scanRunId,
          target,
          0,
          null,
          error?.message || String(error)
        );

        results.push({
          sourceKey: target.sourceKey,
          companyName: target.companyName,
          error: error?.message || String(error),
          jobsFound: 0,
          activeCommercial: 0,
          newCommercial: 0,
          eventsInserted: 0,
          evidenceCreated: 0,
          observationsInserted: 0,
        });
      }
    }

    const totals = results.reduce(
      (acc, row) => {
        acc.jobsFound += Number(row.jobsFound || 0);
        acc.activeCommercialJobs += Number(row.activeCommercial || 0);
        acc.newCommercialJobs += Number(row.newCommercial || 0);
        acc.eventsInserted += Number(row.eventsInserted || 0);
        acc.evidenceCreated += Number(row.evidenceCreated || 0);
        return acc;
      },
      {
        jobsFound: 0,
        activeCommercialJobs: 0,
        newCommercialJobs: 0,
        eventsInserted: 0,
        evidenceCreated: 0,
      }
    );

    await DB.prepare(
      `UPDATE scan_runs
          SET status = 'complete',
              completed_at = ?,
              sources_completed = ?,
              observations_found = ?
        WHERE id = ?`
    )
      .bind(isoNow(), refreshed.length, totals.jobsFound, scanRunId)
      .run();

    return {
      scanRunId,
      discoveryVersion: DISCOVERY_VERSION,
      companiesChecked: companies.length,
      targetsScanned: refreshed.length,
      targetsDiscovered: discovered.length,
      ...totals,
      results,
    };
  } catch (error) {
    await DB.prepare(
      `UPDATE scan_runs
          SET status = 'error', completed_at = ?, error_count = 1, error_text = ?
        WHERE id = ?`
    )
      .bind(isoNow(), error?.message || String(error), scanRunId)
      .run()
      .catch(() => {});

    throw error;
  }
}

export async function listJobs(DB, { limit = 200, status = "active" } = {}) {
  const safe = Math.max(1, Math.min(Number(limit) || 200, 500));
  const normalizedStatus = normalizeWhitespace(status || "active");

  const result = await DB.prepare(
    `SELECT
       j.id,
       j.company_id,
       c.canonical_name AS company_name,
       j.source_key,
       j.external_job_id,
       j.title,
       j.role_family,
       j.role_level,
       j.department,
       j.location,
       j.url,
       j.posted_at,
       j.first_seen_at,
       j.last_seen_at,
       j.removed_at,
       j.status
     FROM job_postings j
     JOIN companies c
       ON c.id = j.company_id
     WHERE (? = 'all' OR j.status = ?)
     ORDER BY
       CASE WHEN j.status = 'active' THEN 0 ELSE 1 END,
       COALESCE(j.posted_at, j.first_seen_at) DESC
     LIMIT ?`
  )
    .bind(normalizedStatus, normalizedStatus, safe)
    .all();

  return result.results || [];
}
