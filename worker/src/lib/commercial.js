import {
  isoNow,
  makeId,
  normalizeName,
  normalizeWhitespace,
  sha256Hex,
} from "./normalize.js";

const COMMERCIAL_EVENT_TYPES = new Set([
  "US_RIGHTS_INTERNAL",
  "US_RIGHTS_ACQUIRED",
  "US_RIGHTS_PARTNERED",
  "CO_COMMERCIALIZATION",
  "INTERNAL_US_LAUNCH_PLANNED",
  "CSO_SELECTED",
  "LAUNCH_DELAYED",
  "LAUNCH_TIMING_DISCLOSED",
  "CCO_APPOINTED",
  "HEAD_COMMERCIAL_APPOINTED",
  "VP_SALES_APPOINTED",
  "NATIONAL_SALES_LEADER_APPOINTED",
  "MARKET_ACCESS_BUILD",
  "COMMERCIAL_OPERATIONS_BUILD",
  "RBD_JOB_POSTED",
  "SALES_MANAGER_JOB_POSTED",
  "KAM_JOB_POSTED",
  "FIELD_SALES_JOB_POSTED",
  "FIELD_FORCE_SIZE_DISCLOSED",
  "FIELD_FORCE_ESTABLISHED",
  "FINANCING_COMPLETED",
  "FINANCING_FOR_COMMERCIALIZATION",
  "CASH_RUNWAY_DISCLOSED",
  "COMMERCIAL_SPEND_GUIDANCE",
  "RESTRUCTURING",
  "LAYOFF",
]);

const RIGHTS_EVENT_MAP = {
  US_RIGHTS_INTERNAL: "internal",
  US_RIGHTS_ACQUIRED: "acquired",
  US_RIGHTS_PARTNERED: "partnered",
  CO_COMMERCIALIZATION: "co-commercialization",
};

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    researched_summary: { type: "string" },
    signals: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          company_index: { type: "integer", minimum: 0, maximum: 9 },
          event_type: {
            type: "string",
            enum: [...COMMERCIAL_EVENT_TYPES],
          },
          asset_name: { type: ["string", "null"] },
          event_date: { type: ["string", "null"] },
          claim: { type: "string" },
          value_text: { type: ["string", "null"] },
          partner_name: { type: ["string", "null"] },
          territory: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sources: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                title: { type: "string" },
                source_tier: { type: "string", enum: ["A", "B", "C"] },
                is_primary: { type: "boolean" },
              },
              required: ["url", "title", "source_tier", "is_primary"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "company_index",
          "event_type",
          "asset_name",
          "event_date",
          "claim",
          "value_text",
          "partner_name",
          "territory",
          "confidence",
          "sources",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["researched_summary", "signals"],
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

function sourceUrls(payload) {
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

function sourceKeyFor(source) {
  const url = cleanUrl(source?.url);
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {}

  if (host === "sec.gov" || host.endsWith(".sec.gov")) return "sec_edgar";
  if (host.includes("greenhouse.io")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  if (host.includes("ashbyhq.com")) return "ashby";
  if (source?.is_primary) return "company_ir";
  if (source?.source_tier === "B") return "trade_press";
  return "general_web";
}

function evidenceConfidence(source) {
  if (source?.is_primary && source?.source_tier === "A") return 0.92;
  if (source?.source_tier === "A") return 0.82;
  if (source?.source_tier === "B") return 0.72;
  return 0.55;
}

function urlWasSearched(url, searchedUrls) {
  const clean = cleanUrl(url);
  if (!clean) return false;
  if (searchedUrls.has(clean)) return true;

  let target;
  try {
    target = new URL(clean);
  } catch {
    return false;
  }

  for (const candidate of searchedUrls) {
    try {
      const parsed = new URL(candidate);
      if (
        parsed.hostname === target.hostname &&
        (parsed.pathname === target.pathname ||
          parsed.pathname.startsWith(target.pathname) ||
          target.pathname.startsWith(parsed.pathname))
      ) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function chooseResearchCompanies(DB, batchSize) {
  const safe = Math.max(1, Math.min(Number(batchSize) || 5, 10));
  const result = await DB.prepare(
    `SELECT
       c.id,
       c.canonical_name,
       c.website,
       GROUP_CONCAT(DISTINCT a.canonical_name) AS assets,
       MAX(sc.started_at) AS last_researched,
       MAX(o.published_at) AS latest_source_date
     FROM companies c
     LEFT JOIN assets a
       ON a.company_id = c.id
     LEFT JOIN observation_identity oi
       ON oi.company_id = c.id
      AND oi.resolution_status = 'resolved'
     LEFT JOIN source_observations o
       ON o.id = oi.observation_id
     LEFT JOIN source_checks sc
       ON sc.company_id = c.id
      AND sc.source_key = 'company_ir'
     GROUP BY c.id, c.canonical_name, c.website
     ORDER BY
       CASE WHEN MAX(sc.started_at) IS NULL THEN 0 ELSE 1 END ASC,
       COALESCE(MAX(o.published_at), '') DESC,
       COALESCE(MAX(sc.started_at), '') ASC,
       c.canonical_name ASC
     LIMIT ?`
  )
    .bind(safe)
    .all();

  return (result.results || []).map((row) => ({
    ...row,
    assetList: String(row.assets || "")
      .split(",")
      .map((x) => normalizeWhitespace(x))
      .filter(Boolean),
  }));
}

async function callOpenAI(env, companies) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const currentDate = new Date().toISOString().slice(0, 10);
  const companyText = companies
    .map(
      (company, index) =>
        `${index}. ${company.canonical_name}\n` +
        `   Known assets: ${company.assetList.join(", ") || "none listed"}\n` +
        `   Known website: ${company.website || "unknown"}`
    )
    .join("\n\n");

  const system = `You are the evidence-research layer for a U.S. life-sciences commercial recruiting intelligence product.\n\nYour job is to find factual, source-backed commercial signals. You do NOT score recruiting opportunities.\n\nRules:\n- Search the public web and prioritize official company investor-relations/newsroom pages, official company career pages, SEC filings, and public ATS job postings.\n- Prefer primary sources. Use reputable life-sciences trade press only for corroboration or when a primary source is unavailable.\n- Never infer U.S. rights from silence. Report a rights event only when ownership, partnership, licensing, co-commercialization, or U.S. launch responsibility is explicit.\n- Never infer a job exists from generic careers language. Job events require an identifiable posting or explicit company announcement.\n- Focus on U.S. commercialization and field-commercial organization buildout.\n- Return only facts that are materially relevant to launch timing, U.S. rights, commercial leadership, market access, sales leadership, field sales hiring, outsourcing, financing for commercialization, restructuring, or field-force scale.\n- For leadership/job events, prefer evidence from the last 24 months. For rights relationships, older evidence is acceptable when it clearly remains current.\n- Each source URL must be a real URL found during web research.\n- company_index must match the numbered company list exactly.\n- event_date should be YYYY-MM-DD when the exact date is supported, otherwise null.\n- If evidence is ambiguous, omit the signal rather than guessing.`;

  const user = `Current date: ${currentDate}\n\nResearch these companies:\n\n${companyText}\n\nReturn all supported commercial signals you can verify. For each signal, include the strongest source plus corroborating sources when available.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      reasoning: { effort: "medium" },
      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
        },
      ],
      include: ["web_search_call.action.sources"],
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "commercial_launch_radar_research",
          strict: true,
          schema: RESEARCH_SCHEMA,
        },
      },
    }),
  });

  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI returned non-JSON HTTP ${response.status}.`);
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `OpenAI Responses API returned ${response.status}.`
    );
  }

  const text = responseText(payload);
  if (!text) throw new Error("OpenAI returned no structured research output.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI commercial research output was not valid JSON.");
  }

  return {
    parsed,
    searchedUrls: sourceUrls(payload),
    responseId: payload?.id || null,
    model: payload?.model || "gpt-5.6-luna",
  };
}

async function findAsset(DB, companyId, assetName) {
  const normalized = normalizeName(assetName);
  if (!normalized) return null;

  const exact = await DB.prepare(
    `SELECT id, canonical_name, normalized_name
       FROM assets
      WHERE company_id = ?
        AND normalized_name = ?
      LIMIT 1`
  )
    .bind(companyId, normalized)
    .first();

  if (exact) return exact;

  return DB.prepare(
    `SELECT a.id, a.canonical_name, a.normalized_name
       FROM asset_aliases aa
       JOIN assets a ON a.id = aa.asset_id
      WHERE a.company_id = ?
        AND aa.normalized_alias = ?
      LIMIT 1`
  )
    .bind(companyId, normalized)
    .first();
}

async function upsertEvidence(DB, { companyId, assetId, signal, source }) {
  const sourceUrl = cleanUrl(source?.url);
  const sourceKey = sourceKeyFor(source);
  const confidence = evidenceConfidence(source);
  const contentHash = await sha256Hex({
    companyId,
    assetId: assetId || null,
    eventType: signal.event_type,
    claim: signal.claim,
    url: sourceUrl,
  });

  const existing = await DB.prepare(
    `SELECT id
       FROM evidence
      WHERE content_hash = ?
      LIMIT 1`
  )
    .bind(contentHash)
    .first();

  if (existing?.id) {
    return { id: existing.id, created: false, confidence, sourceKey };
  }

  const evidenceId = makeId("evd");
  const observedAt = isoNow();

  await DB.prepare(
    `INSERT INTO evidence
      (id, source_key, source_observation_id, company_id, asset_id,
       fact_key, fact_value, title, url, claim, source_tier, is_primary,
       published_at, observed_at, confidence, content_hash, is_current)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      evidenceId,
      sourceKey,
      companyId,
      assetId || null,
      `commercial.${String(signal.event_type || "").toLowerCase()}`,
      normalizeWhitespace(signal.value_text || signal.partner_name || signal.claim),
      normalizeWhitespace(source?.title || signal.event_type),
      sourceUrl,
      normalizeWhitespace(signal.claim),
      source?.source_tier || "C",
      source?.is_primary ? 1 : 0,
      signal.event_date || null,
      observedAt,
      confidence,
      contentHash
    )
    .run();

  return { id: evidenceId, created: true, confidence, sourceKey };
}

async function ensureRightsRelationship(DB, {
  companyId,
  assetId,
  signal,
  evidenceId,
}) {
  const rightsType = RIGHTS_EVENT_MAP[signal.event_type];
  if (!rightsType) return false;

  const territory = normalizeWhitespace(signal.territory || "US") || "US";
  const partner = normalizeWhitespace(signal.partner_name || "") || null;

  const existing = await DB.prepare(
    `SELECT id
       FROM rights_relationships
      WHERE company_id = ?
        AND COALESCE(asset_id, '') = COALESCE(?, '')
        AND territory = ?
        AND rights_type = ?
        AND COALESCE(partner_name_raw, '') = COALESCE(?, '')
        AND status = 'active'
      LIMIT 1`
  )
    .bind(companyId, assetId || null, territory, rightsType, partner)
    .first();

  if (existing?.id) return false;

  await DB.prepare(
    `INSERT INTO rights_relationships
      (id, company_id, asset_id, territory, rights_holder_company_id,
       partner_name_raw, rights_type, start_date, status, evidence_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'active', ?, ?, ?)`
  )
    .bind(
      makeId("rights"),
      companyId,
      assetId || null,
      territory,
      partner,
      rightsType,
      signal.event_date || null,
      evidenceId || null,
      isoNow(),
      isoNow()
    )
    .run();

  return true;
}

async function persistSignal(DB, { company, signal, searchedUrls, researchMeta }) {
  if (!COMMERCIAL_EVENT_TYPES.has(signal?.event_type)) {
    return { accepted: false, reason: "unsupported_event_type" };
  }

  const asset = signal?.asset_name
    ? await findAsset(DB, company.id, signal.asset_name)
    : null;

  const validSources = [];
  for (const source of signal?.sources || []) {
    const url = cleanUrl(source?.url);
    if (!url || !urlWasSearched(url, searchedUrls)) continue;
    validSources.push({ ...source, url });
  }

  if (!validSources.length) {
    return { accepted: false, reason: "no_verified_source_url" };
  }

  const primaryCount = validSources.filter((source) => source.is_primary).length;
  const corroboratingAB = validSources.filter((source) =>
    ["A", "B"].includes(source.source_tier)
  ).length;
  const supported = primaryCount >= 1 || corroboratingAB >= 2;

  let evidenceCreated = 0;
  const evidenceRows = [];

  for (const source of validSources) {
    const evidence = await upsertEvidence(DB, {
      companyId: company.id,
      assetId: asset?.id || null,
      signal,
      source,
    });
    if (evidence.created) evidenceCreated += 1;
    evidenceRows.push({ ...evidence, source });
  }

  if (!supported) {
    return {
      accepted: false,
      reason: "secondary_only",
      evidenceCreated,
    };
  }

  const baseConfidence = Math.max(
    ...evidenceRows.map((row) => row.confidence),
    0.5
  );
  const corroborationBoost = evidenceRows.length >= 2 ? 0.05 : 0;
  const eventConfidence = Math.min(0.98, baseConfidence + corroborationBoost);
  const eventHash = await sha256Hex({
    companyId: company.id,
    assetId: asset?.id || null,
    eventType: signal.event_type,
    eventDate: signal.event_date || null,
    valueText: normalizeWhitespace(signal.value_text || signal.partner_name || signal.claim)
      .toLowerCase()
      .slice(0, 300),
  });

  let event = await DB.prepare(
    `SELECT id
       FROM intelligence_events
      WHERE event_hash = ?
      LIMIT 1`
  )
    .bind(eventHash)
    .first();

  let eventCreated = false;
  if (!event?.id) {
    const eventId = makeId("event");
    await DB.prepare(
      `INSERT INTO intelligence_events
        (id, company_id, asset_id, event_type, event_date, observed_at,
         status, value_text, value_json, evidence_confidence,
         source_count, primary_source_count, event_hash, active)
       VALUES (?, ?, ?, ?, ?, ?, 'supported', ?, ?, ?, ?, ?, ?, 1)`
    )
      .bind(
        eventId,
        company.id,
        asset?.id || null,
        signal.event_type,
        signal.event_date || null,
        isoNow(),
        normalizeWhitespace(signal.value_text || signal.partner_name || signal.claim),
        JSON.stringify({
          claim: normalizeWhitespace(signal.claim),
          partnerName: signal.partner_name || null,
          territory: signal.territory || null,
          researchModel: researchMeta.model,
          researchResponseId: researchMeta.responseId,
        }),
        eventConfidence,
        evidenceRows.length,
        primaryCount,
        eventHash
      )
      .run();
    event = { id: eventId };
    eventCreated = true;
  }

  for (const evidence of evidenceRows) {
    await DB.prepare(
      `INSERT OR IGNORE INTO event_evidence (event_id, evidence_id)
       VALUES (?, ?)`
    )
      .bind(event.id, evidence.id)
      .run();
  }

  let rightsCreated = false;
  if (RIGHTS_EVENT_MAP[signal.event_type]) {
    rightsCreated = await ensureRightsRelationship(DB, {
      companyId: company.id,
      assetId: asset?.id || null,
      signal,
      evidenceId: evidenceRows[0]?.id || null,
    });
  }

  return {
    accepted: true,
    eventCreated,
    evidenceCreated,
    rightsCreated,
  };
}

async function createResearchScan(DB, companies, batchSize) {
  const scanRunId = makeId("scan");
  const startedAt = isoNow();

  await DB.prepare(
    `INSERT INTO scan_runs
      (id, scan_type, status, started_at, parameters_json, sources_targeted)
     VALUES (?, 'commercial_research', 'running', ?, ?, ?)`
  )
    .bind(
      scanRunId,
      startedAt,
      JSON.stringify({
        batchSize,
        companyIds: companies.map((company) => company.id),
      }),
      companies.length
    )
    .run();

  return { scanRunId, startedAt };
}

async function writeSourceChecks(DB, { scanRunId, startedAt, companies, signalCounts, errorText = null }) {
  const completedAt = isoNow();

  for (const company of companies) {
    const count = Number(signalCounts.get(company.id) || 0);
    await DB.prepare(
      `INSERT INTO source_checks
        (id, source_key, scan_run_id, company_id, asset_id, status,
         started_at, completed_at, records_found, query_json, error_text,
         latest_source_date)
       VALUES (?, 'company_ir', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        makeId("check"),
        scanRunId,
        company.id,
        errorText ? "error" : "complete",
        startedAt,
        completedAt,
        count,
        JSON.stringify({ companyName: company.canonical_name }),
        errorText,
        null
      )
      .run();
  }
}

export async function researchCommercialBatch(DB, env, { batchSize = 5 } = {}) {
  const companies = await chooseResearchCompanies(DB, batchSize);
  if (!companies.length) {
    return {
      companiesResearched: 0,
      signalsReturned: 0,
      supportedSignals: 0,
      eventsInserted: 0,
      evidenceCreated: 0,
      rightsCreated: 0,
      secondaryOnly: 0,
      companies: [],
    };
  }

  const scan = await createResearchScan(DB, companies, batchSize);
  const signalCounts = new Map(companies.map((company) => [company.id, 0]));

  try {
    const research = await callOpenAI(env, companies);
    const signals = Array.isArray(research.parsed?.signals)
      ? research.parsed.signals
      : [];

    let supportedSignals = 0;
    let eventsInserted = 0;
    let evidenceCreated = 0;
    let rightsCreated = 0;
    let secondaryOnly = 0;
    let rejected = 0;

    for (const signal of signals) {
      const company = companies[Number(signal?.company_index)];
      if (!company) {
        rejected += 1;
        continue;
      }

      const persisted = await persistSignal(DB, {
        company,
        signal,
        searchedUrls: research.searchedUrls,
        researchMeta: research,
      });

      evidenceCreated += Number(persisted.evidenceCreated || 0);

      if (persisted.accepted) {
        supportedSignals += 1;
        signalCounts.set(company.id, Number(signalCounts.get(company.id) || 0) + 1);
        if (persisted.eventCreated) eventsInserted += 1;
        if (persisted.rightsCreated) rightsCreated += 1;
      } else if (persisted.reason === "secondary_only") {
        secondaryOnly += 1;
      } else {
        rejected += 1;
      }
    }

    await writeSourceChecks(DB, {
      scanRunId: scan.scanRunId,
      startedAt: scan.startedAt,
      companies,
      signalCounts,
    });

    await DB.prepare(
      `UPDATE scan_runs
          SET status = 'complete',
              completed_at = ?,
              sources_completed = ?,
              observations_found = ?
        WHERE id = ?`
    )
      .bind(isoNow(), companies.length, supportedSignals, scan.scanRunId)
      .run();

    return {
      scanRunId: scan.scanRunId,
      companiesResearched: companies.length,
      signalsReturned: signals.length,
      supportedSignals,
      eventsInserted,
      evidenceCreated,
      rightsCreated,
      secondaryOnly,
      rejected,
      researchedSummary: research.parsed?.researched_summary || "",
      companies: companies.map((company) => company.canonical_name),
    };
  } catch (error) {
    const message = error?.message || String(error);

    await writeSourceChecks(DB, {
      scanRunId: scan.scanRunId,
      startedAt: scan.startedAt,
      companies,
      signalCounts,
      errorText: message,
    }).catch(() => {});

    await DB.prepare(
      `UPDATE scan_runs
          SET status = 'error',
              completed_at = ?,
              error_count = 1,
              error_text = ?
        WHERE id = ?`
    )
      .bind(isoNow(), message, scan.scanRunId)
      .run()
      .catch(() => {});

    throw error;
  }
}
