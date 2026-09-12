import { SOURCE_DEFINITIONS, getSourceDefinition } from "./sources.js";
import { json, corsHeaders, isAuthorized } from "./lib/http.js";
import {
  createScanRun,
  createSourceCheck,
  finishScanRun,
  finishSourceCheck,
  persistObservations,
} from "./lib/db.js";
import {
  resolveObservationIdentities,
  listCanonicalCompanies,
} from "./lib/identity.js";
import {
  projectRegulatoryEvents,
  listIntelligenceEvents,
} from "./lib/events.js";
import { researchCommercialBatch } from "./lib/commercial.js";
import { scoreOpportunities, listOpportunities } from "./lib/scoring.js";
import { scanHiringBatch, listJobs, listHiringCoverage } from "./lib/hiring.js";
import { collectClinicalTrials } from "./collectors/clinicaltrials.js";
import { collectOpenFda } from "./collectors/openfda.js";
import { collectSecSubmissions } from "./collectors/sec.js";
import {
  collectAshby,
  collectGreenhouse,
  collectLever,
  collectWorkday,
} from "./collectors/ats.js";
import {
  collectCareersJsonLd,
  collectSmartRecruiters,
} from "./collectors/hiring_coverage.js";

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

async function runCollector(source, body, env) {
  switch (source) {
    case "clinicaltrials_gov":
      return collectClinicalTrials(body);
    case "openfda_drugsfda":
      return collectOpenFda(body);
    case "sec_edgar":
      return collectSecSubmissions(body, env);
    case "greenhouse":
      return collectGreenhouse(body);
    case "lever":
      return collectLever(body);
    case "ashby":
      return collectAshby(body);
    case "workday":
      return collectWorkday(body);
    case "smartrecruiters":
      return collectSmartRecruiters(body);
    case "careers_jsonld":
      return collectCareersJsonLd(body);
    default: {
      const def = getSourceDefinition(source);
      if (def && !def.implemented) {
        throw new Error(
          `${def.label} is registered for the deep-research layer but does not yet have a deterministic collector.`
        );
      }
      throw new Error(`Unknown source: ${source}`);
    }
  }
}

async function collectAndPersist(body, env) {
  if (!env.DB) throw new Error("D1 binding DB is not configured.");

  const source = body?.source;
  const def = getSourceDefinition(source);
  if (!def) throw new Error("A valid source key is required.");

  const scan = await createScanRun(env.DB, `collector:${source}`, body);
  const checkId = await createSourceCheck(env.DB, {
    sourceKey: source,
    scanRunId: scan.id,
    query: body,
  });

  try {
    const result = await runCollector(source, body, env);
    const persisted = await persistObservations(
      env.DB,
      result.sourceKey,
      result.tier,
      scan.id,
      result.observations
    );

    const identityResolution = await resolveObservationIdentities(env.DB, { limit: 5000 });
    const regulatoryProjection = await projectRegulatoryEvents(env.DB, { limit: 5000 });
    const latestSourceDate =
      result.observations.map((x) => x.publishedAt).filter(Boolean).sort().at(-1) || null;

    await finishSourceCheck(env.DB, checkId, {
      status: "complete",
      recordsFound: result.observations.length,
      latestSourceDate,
    });

    await finishScanRun(env.DB, scan.id, {
      status: "complete",
      observationsFound: result.observations.length,
    });

    return {
      ok: true,
      scanRunId: scan.id,
      source,
      fetched: result.observations.length,
      inserted: persisted.inserted,
      duplicates: persisted.duplicates,
      nextPageToken: result.nextPageToken || null,
      totalCount: result.totalCount ?? null,
      upstreamUrl: result.upstreamUrl || null,
      identityResolution,
      regulatoryProjection,
      query: result.query || null,
    };
  } catch (error) {
    const message = error?.message || String(error);

    await finishSourceCheck(env.DB, checkId, {
      status: "error",
      recordsFound: 0,
      errorText: message,
    }).catch(() => {});

    await finishScanRun(env.DB, scan.id, {
      status: "error",
      observationsFound: 0,
      errorText: message,
    }).catch(() => {});

    throw error;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (
      env.ALLOWED_ORIGIN &&
      env.ALLOWED_ORIGIN !== "*" &&
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== env.ALLOWED_ORIGIN
    ) {
      return json({ error: "Origin not allowed." }, 403, env);
    }

    if ((path === "/" || path === "/health") && request.method === "GET") {
      return json(
        {
          ok: true,
          service: "commercial-launch-radar-v3-foundation",
          status: "online",
          d1_configured: Boolean(env.DB),
          openai_configured: Boolean(env.OPENAI_API_KEY),
          scan_password_required: Boolean(env.RADAR_ACCESS_TOKEN),
          sec_user_agent_configured: Boolean(env.SEC_USER_AGENT),
          stage: "phase-7-hiring-coverage",
          endpoints: {
            sources: "GET /api/source-registry",
            scans: "GET /api/scan-runs",
            observations: "GET /api/observations",
            companies: "GET /api/companies",
            events: "GET /api/events",
            opportunities: "GET /api/opportunities",
            jobs: "GET /api/jobs",
            hiringCoverage: "GET /api/hiring-coverage",
            collect: "POST /api/collect",
            resolveIdentities: "POST /api/resolve-identities",
            projectEvents: "POST /api/project-events",
            researchCommercial: "POST /api/research-commercial",
            scanHiring: "POST /api/scan-hiring",
            scoreOpportunities: "POST /api/score-opportunities",
          },
        },
        200,
        env
      );
    }

    if (path === "/api/source-registry" && request.method === "GET") {
      if (env.DB) {
        const result = await env.DB.prepare(
          `SELECT source_key, display_name, tier, source_class, access_mode,
                  base_url, is_primary, active, notes
             FROM source_registry
            ORDER BY tier, display_name`
        ).all();
        return json({ ok: true, sources: result.results || [] }, 200, env);
      }

      return json(
        {
          ok: true,
          sources: Object.values(SOURCE_DEFINITIONS),
          warning: "D1 is not configured; returning code registry only.",
        },
        200,
        env
      );
    }

    if (path === "/api/scan-runs" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 30, 100));
      const result = await env.DB.prepare(
        `SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?`
      ).bind(limit).all();
      return json({ ok: true, scanRuns: result.results || [] }, 200, env);
    }

    if (path === "/api/observations" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 50, 200));
      const source = url.searchParams.get("source") || "";
      const stmt = source
        ? env.DB.prepare(
            `SELECT id, source_key, external_id, observation_type,
                    company_name_raw, asset_name_raw, title, url,
                    published_at, observed_at, source_tier
               FROM source_observations
              WHERE source_key = ?
              ORDER BY observed_at DESC
              LIMIT ?`
          ).bind(source, limit)
        : env.DB.prepare(
            `SELECT id, source_key, external_id, observation_type,
                    company_name_raw, asset_name_raw, title, url,
                    published_at, observed_at, source_tier
               FROM source_observations
              ORDER BY observed_at DESC
              LIMIT ?`
          ).bind(limit);
      const result = await stmt.all();
      return json({ ok: true, observations: result.results || [] }, 200, env);
    }

    if (path === "/api/companies" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 200, 500));
      try {
        return json({ ok: true, companies: await listCanonicalCompanies(env.DB, { limit }) }, 200, env);
      } catch (error) {
        return json({
          error: "Canonical company identity layer is not ready. Apply migration 0002_identity_resolution.sql first.",
          detail: error?.message || String(error),
        }, 500, env);
      }
    }

    if (path === "/api/events" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 100, 500));
      const eventType = String(url.searchParams.get("type") || "").trim();
      try {
        const events = await listIntelligenceEvents(env.DB, { limit, eventType });
        return json({ ok: true, events }, 200, env);
      } catch (error) {
        return json({ error: "Could not read intelligence events.", detail: error?.message || String(error) }, 500, env);
      }
    }

    if (path === "/api/opportunities" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 200, 500));
      try {
        return json({ ok: true, opportunities: await listOpportunities(env.DB, { limit }) }, 200, env);
      } catch (error) {
        return json({ error: "Could not read recruiting opportunities.", detail: error?.message || String(error) }, 500, env);
      }
    }

    if (path === "/api/jobs" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 200, 500));
      const status = String(url.searchParams.get("status") || "active").trim();
      try {
        return json({ ok: true, jobs: await listJobs(env.DB, { limit, status }) }, 200, env);
      } catch (error) {
        return json({ error: "Could not read job inventory.", detail: error?.message || String(error) }, 500, env);
      }
    }

    if (path === "/api/hiring-coverage" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 200, 500));
      try {
        return json({ ok: true, coverage: await listHiringCoverage(env.DB, { limit }) }, 200, env);
      } catch (error) {
        return json({ error: "Could not read hiring-source coverage.", detail: error?.message || String(error) }, 500, env);
      }
    }

    if (path === "/api/collect" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "Unauthorized scan request." }, 401, env);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400, env); }
      try { return json(await collectAndPersist(body, env), 200, env); }
      catch (error) { return json({ error: error?.message || String(error) }, 500, env); }
    }

    if (path === "/api/resolve-identities" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "Unauthorized identity-resolution request." }, 401, env);
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      let body = {};
      try { body = await request.json(); } catch {}
      try {
        return json({ ok: true, ...(await resolveObservationIdentities(env.DB, { limit: body?.limit || 500 })) }, 200, env);
      } catch (error) {
        return json({
          error: "Identity resolution failed. Confirm migration 0002_identity_resolution.sql has been applied.",
          detail: error?.message || String(error),
        }, 500, env);
      }
    }

    if (path === "/api/project-events" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "Unauthorized event-projection request." }, 401, env);
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      try { return json({ ok: true, ...(await projectRegulatoryEvents(env.DB, { limit: 5000 })) }, 200, env); }
      catch (error) { return json({ error: "Regulatory event projection failed.", detail: error?.message || String(error) }, 500, env); }
    }

    if (path === "/api/research-commercial" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "Unauthorized commercial-research request." }, 401, env);
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured." }, 500, env);
      let body = {};
      try { body = await request.json(); } catch {}
      try {
        return json({ ok: true, ...(await researchCommercialBatch(env.DB, env, { batchSize: body?.batchSize || 5 })) }, 200, env);
      } catch (error) {
        return json({ error: "Commercial research failed.", detail: error?.message || String(error) }, 500, env);
      }
    }

    if (path === "/api/scan-hiring" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "Unauthorized hiring-scan request." }, 401, env);
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured." }, 500, env);
      let body = {};
      try { body = await request.json(); } catch {}
      try {
        return json({ ok: true, ...(await scanHiringBatch(env.DB, env, { batchSize: body?.batchSize || 5 })) }, 200, env);
      } catch (error) {
        return json({ error: "Hiring scan failed.", detail: error?.message || String(error) }, 500, env);
      }
    }

    if (path === "/api/score-opportunities" && request.method === "POST") {
      if (!isAuthorized(request, env)) return json({ error: "Unauthorized opportunity-scoring request." }, 401, env);
      if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500, env);
      let body = {};
      try { body = await request.json(); } catch {}
      try {
        return json({ ok: true, ...(await scoreOpportunities(env.DB, { limit: body?.limit || 500 })) }, 200, env);
      } catch (error) {
        return json({ error: "Opportunity scoring failed.", detail: error?.message || String(error) }, 500, env);
      }
    }

    return json(
      {
        error: "Not found.",
        requested_path: path,
        method: request.method,
        available: [
          "GET /",
          "GET /health",
          "GET /api/source-registry",
          "GET /api/scan-runs",
          "GET /api/observations",
          "GET /api/companies",
          "GET /api/events",
          "GET /api/opportunities",
          "GET /api/jobs",
          "GET /api/hiring-coverage",
          "POST /api/collect",
          "POST /api/resolve-identities",
          "POST /api/project-events",
          "POST /api/research-commercial",
          "POST /api/scan-hiring",
          "POST /api/score-opportunities",
        ],
      },
      404,
      env
    );
  },
};
