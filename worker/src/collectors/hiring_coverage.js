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
  payload = {},
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

function safeUrl(value, base = undefined) {
  try {
    const url = new URL(String(value || "").trim(), base);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function locationText(value) {
  if (!value) return null;
  if (typeof value === "string") return normalizeWhitespace(value) || null;
  if (Array.isArray(value)) {
    const pieces = value.map(locationText).filter(Boolean);
    return pieces.length ? [...new Set(pieces)].join(" / ") : null;
  }

  const address = value?.address || value;
  const pieces = [
    address?.addressLocality,
    address?.addressRegion,
    address?.addressCountry?.name || address?.addressCountry,
  ]
    .map(normalizeWhitespace)
    .filter(Boolean);

  return pieces.length ? pieces.join(", ") : null;
}

function identifierValue(value) {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return value?.value || value?.name || null;
}

function flattenJsonLd(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) flattenJsonLd(item, out);
    return out;
  }
  if (typeof node !== "object") return out;

  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((x) => String(x || "").toLowerCase() === "jobposting")) {
    out.push(node);
  }

  if (Array.isArray(node["@graph"])) flattenJsonLd(node["@graph"], out);
  return out;
}

function parseJsonLdJobs(html, pageUrl, companyName) {
  const jobs = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = re.exec(String(html || "")))) {
    const raw = match[1]
      .replace(/<!--/g, "")
      .replace(/-->/g, "")
      .trim();
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const job of flattenJsonLd(parsed)) {
      const title = normalizeWhitespace(job?.title || job?.name || "");
      if (!title) continue;

      const url = safeUrl(job?.url || pageUrl, pageUrl) || pageUrl;
      const externalId =
        identifierValue(job?.identifier) ||
        identifierValue(job?.jobId) ||
        url ||
        `${title}:${locationText(job?.jobLocation) || ""}`;

      jobs.push(
        jobObservation({
          sourceKey: "careers_jsonld",
          companyName,
          externalId,
          title,
          url,
          postedAt: job?.datePosted || null,
          location:
            locationText(job?.jobLocation) ||
            locationText(job?.applicantLocationRequirements) ||
            null,
          department: normalizeWhitespace(job?.occupationalCategory || "") || null,
          description: job?.description || "",
          payload: {
            validThrough: job?.validThrough || null,
            employmentType: job?.employmentType || null,
            hiringOrganization: job?.hiringOrganization?.name || null,
            jsonLdSource: pageUrl,
          },
        })
      );
    }
  }

  return jobs;
}

function candidateJobLinks(html, pageUrl, limit = 24) {
  let base;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  const seen = new Set();
  const links = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match;

  while ((match = re.exec(String(html || ""))) && links.length < limit) {
    const url = safeUrl(match[1], pageUrl);
    if (!url || seen.has(url)) continue;

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }

    if (parsed.hostname !== base.hostname) continue;
    if (!/(job|jobs|career|careers|position|positions|requisition|vacanc)/i.test(parsed.pathname + parsed.search)) continue;

    seen.add(url);
    links.push(url);
  }

  return links;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });

  if (!response.ok) throw new Error(`Official careers page returned ${response.status}.`);
  return { url: response.url || url, html: await response.text() };
}

export async function collectCareersJsonLd(input = {}) {
  const companyName = normalizeWhitespace(input.companyName || "");
  const pageUrl = safeUrl(input.pageUrl || input.url || "");
  if (!companyName) throw new Error("Official careers collector requires companyName.");
  if (!pageUrl) throw new Error("Official careers collector requires pageUrl.");

  const root = await fetchHtml(pageUrl);
  const byId = new Map();

  for (const observation of parseJsonLdJobs(root.html, root.url, companyName)) {
    byId.set(observation.externalId, observation);
  }

  if (byId.size < 5) {
    const links = candidateJobLinks(root.html, root.url, 24);
    for (const link of links) {
      try {
        const page = await fetchHtml(link);
        for (const observation of parseJsonLdJobs(page.html, page.url, companyName)) {
          byId.set(observation.externalId, observation);
        }
      } catch {
        // Individual job pages are best-effort; one bad link should not fail coverage.
      }
    }
  }

  return {
    sourceKey: "careers_jsonld",
    tier: "A",
    query: { companyName, pageUrl },
    observations: [...byId.values()],
    upstreamUrl: root.url,
    completeInventory: false,
  };
}

export async function collectSmartRecruiters(input = {}) {
  const companyIdentifier = normalizeWhitespace(
    input.companyIdentifier || input.companyId || ""
  );
  const companyName = normalizeWhitespace(input.companyName || "");
  if (!companyIdentifier) {
    throw new Error("SmartRecruiters collector requires companyIdentifier.");
  }
  if (!companyName) throw new Error("SmartRecruiters collector requires companyName.");

  const observations = [];
  const pageSize = 100;
  let offset = 0;
  let total = null;

  while (offset < 1000) {
    const url = new URL(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
        companyIdentifier
      )}/postings`
    );
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`SmartRecruiters returned ${response.status}.`);
    }

    const payload = await response.json();
    const postings = Array.isArray(payload?.content) ? payload.content : [];
    if (total == null) total = Number(payload?.totalFound || postings.length);

    for (const job of postings) {
      const id = String(job?.id || job?.uuid || "").trim();
      if (!id) continue;
      const location = [
        job?.location?.city,
        job?.location?.region,
        job?.location?.country,
      ]
        .map(normalizeWhitespace)
        .filter(Boolean)
        .join(", ");

      observations.push(
        jobObservation({
          sourceKey: "smartrecruiters",
          companyName,
          externalId: id,
          title: job?.name || job?.title,
          url:
            safeUrl(job?.ref) ||
            `https://jobs.smartrecruiters.com/${encodeURIComponent(
              companyIdentifier
            )}/${encodeURIComponent(id)}`,
          postedAt: job?.releasedDate || job?.createdOn || null,
          location: location || null,
          department: job?.department?.label || job?.function?.label || null,
          description: job?.jobAd?.sections?.jobDescription?.text || "",
          payload: {
            uuid: job?.uuid || null,
            typeOfEmployment: job?.typeOfEmployment?.label || null,
            experienceLevel: job?.experienceLevel?.label || null,
            smartRecruitersCompany: companyIdentifier,
          },
        })
      );
    }

    offset += postings.length;
    if (!postings.length || postings.length < pageSize || (total && offset >= total)) break;
  }

  return {
    sourceKey: "smartrecruiters",
    tier: "A",
    query: { companyName, companyIdentifier },
    observations,
    totalCount: total,
    upstreamUrl: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
      companyIdentifier
    )}/postings`,
    completeInventory: true,
  };
}
