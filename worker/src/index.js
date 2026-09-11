import { SOURCE_DEFINITIONS, getSourceDefinition } from "./sources.js";
import { json, corsHeaders, isAuthorized } from "./lib/http.js";
import {
  createScanRun,
  createSourceCheck,
  finishScanRun,
  finishSourceCheck,
  persistObservations,
} from "./lib/db.js";
import { collectClinicalTrials } from "./collectors/clinicaltrials.js";
import { collectOpenFda } from "./collectors/openfda.js";
import { collectSecSubmissions } from "./collectors/sec.js";
import { collectAshby, collectGreenhouse, collectLever } from "./collectors/ats.js";

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

    const latestSourceDate = result.observations
      .map((x) => x.publishedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

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
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
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
          stage: "phase-0-to-2",
          endpoints: {
            sources: "GET /api/source-registry",
            scans: "GET /api/scan-runs",
            observations: "GET /api/observations",
            collect: "POST /api/collect",
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
        `SELECT *
           FROM scan_runs
          ORDER BY started_at DESC
          LIMIT ?`
      )
        .bind(limit)
        .all();
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

    if (path === "/api/collect" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized scan request." }, 401, env);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400, env);
      }

      try {
        const result = await collectAndPersist(body, env);
        return json(result, 200, env);
      } catch (error) {
        return json(
          {
            error: error?.message || String(error),
          },
          500,
          env
        );
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
          "POST /api/collect",
        ],
      },
      404,
      env
    );
  },
};
