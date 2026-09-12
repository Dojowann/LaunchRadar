import { fetchJson } from "../lib/http.js";
import {
  classifyCommercialRole,
  isoNow,
  normalizeWhitespace,
  stripHtml,
} from "../lib/normalize.js";

function jobObservation({
  sourceKey,
  companyName,
  externalId,
  title,
  url,
  postedAt,
  location,
  department,
  description,
  payload,
}) {
  const classification = classifyCommercialRole(title);

  return {
    externalId: String(externalId || url || `${companyName}:${title}:${location}`),
    observationType: "job_posting",
    companyNameRaw: companyName || null,
    assetNameRaw: null,
    title: title || "Job posting",
    url: url || null,
    publishedAt: postedAt || null,
    observedAt: isoNow(),
    payload: {
      sourceKey,
      title: title || null,
      location: location || null,
      department: department || null,
      description: stripHtml(description || "").slice(0, 12000),
      roleFamily: classification.family,
      roleLevel: classification.level,
      isCommercial: classification.commercial,
      ...payload,
    },
  };
}

export async function collectGreenhouse(input = {}) {
  const boardToken = normalizeWhitespace(input.boardToken || "");
  const companyName = normalizeWhitespace(input.companyName || "");

  if (!boardToken) throw new Error("Greenhouse collector requires boardToken.");
  if (!companyName) throw new Error("Greenhouse collector requires companyName.");

  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    boardToken
  )}/jobs?content=true`;

  const { payload } = await fetchJson(url, {
    headers: { Accept: "application/json" },
  });

  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const observations = jobs.map((job) =>
    jobObservation({
      sourceKey: "greenhouse",
      companyName,
      externalId: job?.id,
      title: job?.title,
      url: job?.absolute_url,
      postedAt: job?.updated_at || null,
      location: job?.location?.name || null,
      department: Array.isArray(job?.departments)
        ? job.departments.map((x) => x?.name).filter(Boolean).join(" / ")
        : null,
      description: job?.content || "",
      payload: {
        internalId: job?.internal_job_id || null,
        offices: Array.isArray(job?.offices)
          ? job.offices.map((x) => x?.name).filter(Boolean)
          : [],
      },
    })
  );

  return {
    sourceKey: "greenhouse",
    tier: "A",
    query: { companyName, boardToken },
    observations,
    upstreamUrl: url,
  };
}

export async function collectLever(input = {}) {
  const site = normalizeWhitespace(input.site || "");
  const companyName = normalizeWhitespace(input.companyName || "");
  const region = normalizeWhitespace(input.region || "global").toLowerCase();

  if (!site) throw new Error("Lever collector requires site.");
  if (!companyName) throw new Error("Lever collector requires companyName.");

  const host = region === "eu" ? "https://api.eu.lever.co" : "https://api.lever.co";
  const url = `${host}/v0/postings/${encodeURIComponent(site)}?mode=json`;

  const { payload } = await fetchJson(url, {
    headers: { Accept: "application/json" },
  });

  const jobs = Array.isArray(payload) ? payload : [];
  const observations = jobs.map((job) =>
    jobObservation({
      sourceKey: "lever",
      companyName,
      externalId: job?.id,
      title: job?.text,
      url: job?.hostedUrl || job?.applyUrl,
      postedAt: job?.createdAt
        ? new Date(job.createdAt).toISOString()
        : null,
      location: job?.categories?.location || null,
      department:
        job?.categories?.department ||
        job?.categories?.team ||
        job?.categories?.commitment ||
        null,
      description:
        job?.descriptionPlain ||
        job?.description ||
        [job?.descriptionBodyPlain, job?.additionalPlain]
          .filter(Boolean)
          .join("\n"),
      payload: {
        workplaceType: job?.workplaceType || null,
        commitment: job?.categories?.commitment || null,
        team: job?.categories?.team || null,
        applyUrl: job?.applyUrl || null,
      },
    })
  );

  return {
    sourceKey: "lever",
    tier: "A",
    query: { companyName, site, region },
    observations,
    upstreamUrl: url,
  };
}

export async function collectAshby(input = {}) {
  const boardName = normalizeWhitespace(input.boardName || "");
  const companyName = normalizeWhitespace(input.companyName || "");

  if (!boardName) throw new Error("Ashby collector requires boardName.");
  if (!companyName) throw new Error("Ashby collector requires companyName.");

  const params = new URLSearchParams({ includeCompensation: "true" });
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
    boardName
  )}?${params.toString()}`;

  const { payload } = await fetchJson(url, {
    headers: { Accept: "application/json" },
  });

  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const observations = jobs
    .filter((job) => job?.isListed !== false)
    .map((job) =>
      jobObservation({
        sourceKey: "ashby",
        companyName,
        externalId: job?.jobUrl || job?.applyUrl,
        title: job?.title,
        url: job?.jobUrl || job?.applyUrl,
        postedAt: job?.publishedAt || null,
        location: job?.location || null,
        department: job?.department || job?.team || null,
        description: job?.descriptionPlain || job?.descriptionHtml || "",
        payload: {
          team: job?.team || null,
          isRemote: Boolean(job?.isRemote),
          workplaceType: job?.workplaceType || null,
          employmentType: job?.employmentType || null,
          applyUrl: job?.applyUrl || null,
          compensation: job?.compensation || null,
        },
      })
    );

  return {
    sourceKey: "ashby",
    tier: "A",
    query: { companyName, boardName },
    observations,
    upstreamUrl: url,
  };
}

function cleanOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) return "";
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function workdayPostedDate(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);

  if (lower.includes("today")) return base.toISOString();
  if (lower.includes("yesterday")) {
    base.setUTCDate(base.getUTCDate() - 1);
    return base.toISOString();
  }

  const days = lower.match(/(\d+)\+?\s+days?\s+ago/);
  if (days) {
    base.setUTCDate(base.getUTCDate() - Number(days[1]));
    return base.toISOString();
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function collectWorkday(input = {}) {
  const companyName = normalizeWhitespace(input.companyName || "");
  const origin = cleanOrigin(input.origin || "");
  const tenant = normalizeWhitespace(input.tenant || "");
  const site = normalizeWhitespace(input.site || "");
  const locale = normalizeWhitespace(input.locale || "en-US") || "en-US";
  const maxJobs = Math.max(20, Math.min(Number(input.maxJobs) || 400, 1000));

  if (!companyName) throw new Error("Workday collector requires companyName.");
  if (!origin || !tenant || !site) {
    throw new Error("Workday collector requires origin, tenant and site.");
  }

  const hostname = new URL(origin).hostname.toLowerCase();
  if (!hostname.endsWith(".myworkdayjobs.com")) {
    throw new Error("Workday origin must be a myworkdayjobs.com host.");
  }

  const endpoint = `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
  const pageSize = 20;
  const seen = new Map();

  for (let offset = 0; offset < maxJobs; offset += pageSize) {
    const { payload } = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Commercial-Launch-Radar/3.0",
      },
      body: JSON.stringify({
        appliedFacets: {},
        limit: pageSize,
        offset,
        searchText: "",
      }),
    });

    const postings = Array.isArray(payload?.jobPostings) ? payload.jobPostings : [];

    for (const job of postings) {
      const externalPath = String(job?.externalPath || "").trim();
      if (!externalPath) continue;

      const path = externalPath.startsWith("/") ? externalPath : `/${externalPath}`;
      const externalId = path.split("/").filter(Boolean).at(-1) || path;
      const jobUrl = `${origin}/${encodeURIComponent(locale)}/${encodeURIComponent(site)}${path}`;

      seen.set(
        externalId,
        jobObservation({
          sourceKey: "workday",
          companyName,
          externalId,
          title: job?.title,
          url: jobUrl,
          postedAt: workdayPostedDate(job?.postedOn),
          location: job?.locationsText || null,
          department: null,
          description: "",
          payload: {
            postedOnRaw: job?.postedOn || null,
            bulletFields: Array.isArray(job?.bulletFields) ? job.bulletFields : [],
            workdayTenant: tenant,
            workdaySite: site,
            workdayLocale: locale,
            externalPath: path,
          },
        })
      );
    }

    const total = Number(payload?.total || 0);
    if (
      !postings.length ||
      postings.length < pageSize ||
      (total && offset + postings.length >= total)
    ) {
      break;
    }
  }

  return {
    sourceKey: "workday",
    tier: "A",
    query: { companyName, origin, tenant, site, locale, maxJobs },
    observations: [...seen.values()],
    upstreamUrl: endpoint,
  };
}
