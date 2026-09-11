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
