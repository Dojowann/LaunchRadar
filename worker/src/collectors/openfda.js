import { isoNow, normalizeWhitespace } from "../lib/normalize.js";

function quoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function compactDate(value) {
  const raw = String(value || "").replace(/\D/g, "");
  return raw.length >= 8 ? raw.slice(0, 8) : "";
}

function displayDate(value) {
  const raw = compactDate(value);
  if (raw.length !== 8) return value || null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function utcDateDaysAgo(days) {
  const dt = new Date();
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() - days);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function fetchResults(search, limit, sort = "") {
  const params = new URLSearchParams({ search, limit: String(limit) });
  if (sort) params.set("sort", sort);
  const url = `https://api.fda.gov/drug/drugsfda.json?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Commercial-Launch-Radar/3.0",
    },
  });

  if (response.status === 404) return { url, results: [] };
  if (!response.ok) {
    throw new Error(`openFDA / Drugs@FDA returned ${response.status}`);
  }

  const payload = await response.json();
  return {
    url,
    results: Array.isArray(payload?.results) ? payload.results : [],
  };
}

function normalizeRecord(record, sourceUrl, { startDate = "", endDate = "" } = {}) {
  const products = Array.isArray(record?.products) ? record.products : [];
  const submissions = Array.isArray(record?.submissions) ? record.submissions : [];
  const brands = [...new Set(products.map((p) => p?.brand_name).filter(Boolean))];
  const activeIngredients = [
    ...new Set(
      products.flatMap((p) =>
        Array.isArray(p?.active_ingredients)
          ? p.active_ingredients.map((x) => x?.name).filter(Boolean)
          : []
      )
    ),
  ];

  const approvedOriginals = submissions
    .filter((s) => {
      const statusDate = compactDate(s?.submission_status_date);
      const inWindow =
        (!startDate || statusDate >= startDate) &&
        (!endDate || statusDate <= endDate);
      return (
        String(s?.submission_type || "").toUpperCase() === "ORIG" &&
        String(s?.submission_status || "").toUpperCase() === "AP" &&
        inWindow
      );
    })
    .sort((a, b) =>
      String(b?.submission_status_date || "").localeCompare(
        String(a?.submission_status_date || "")
      )
    );

  const originalApproval = approvedOriginals[0] || null;
  if (!originalApproval) return null;

  const appNo = normalizeWhitespace(record?.application_number || "");
  if (!appNo) return null;

  const approvalDateRaw = compactDate(originalApproval?.submission_status_date);
  const approvalDate = displayDate(approvalDateRaw);
  const assetName = brands[0] || activeIngredients[0] || null;

  return {
    externalId: `${appNo}:${approvalDateRaw}`,
    observationType: "fda_original_approval",
    companyNameRaw: record?.sponsor_name || null,
    assetNameRaw: assetName,
    title: `${appNo}${assetName ? ` — ${assetName}` : ""} — FDA original approval`,
    url: sourceUrl,
    publishedAt: approvalDate,
    observedAt: isoNow(),
    payload: {
      applicationNumber: appNo,
      applicationType: appNo.toUpperCase().startsWith("BLA") ? "BLA" : "NDA",
      sponsorName: record?.sponsor_name || null,
      brands,
      activeIngredients,
      products: products.map((p) => ({
        productNumber: p?.product_number || null,
        referenceDrug: p?.reference_drug || null,
        brandName: p?.brand_name || null,
        activeIngredients: p?.active_ingredients || [],
        dosageForm: p?.dosage_form || null,
        route: p?.route || null,
        marketingStatus: p?.marketing_status || null,
      })),
      originalApproval: {
        submissionType: originalApproval?.submission_type || null,
        submissionNumber: originalApproval?.submission_number || null,
        status: originalApproval?.submission_status || null,
        statusDate: approvalDate,
        reviewPriority: originalApproval?.review_priority || null,
        submissionClassCode: originalApproval?.submission_class_code || null,
        submissionClassCodeDescription:
          originalApproval?.submission_class_code_description || null,
      },
    },
  };
}

export async function collectOpenFda(input = {}) {
  const applicationNumber = normalizeWhitespace(input.applicationNumber || "");
  const sponsor = normalizeWhitespace(input.sponsor || "");
  const brandName = normalizeWhitespace(input.brandName || "");
  const limit = Math.max(1, Math.min(Number(input.limit) || 50, 99));

  if (applicationNumber || sponsor || brandName) {
    let search = "";
    if (applicationNumber) {
      search = `application_number:${quoted(applicationNumber)}`;
    } else if (sponsor) {
      search = `sponsor_name:${quoted(sponsor)}`;
    } else {
      search = `products.brand_name:${quoted(brandName)}`;
    }

    const { url, results } = await fetchResults(search, limit);
    const observations = results
      .map((record) => normalizeRecord(record, url))
      .filter(Boolean);

    return {
      sourceKey: "openfda_drugsfda",
      tier: "A",
      query: { applicationNumber, sponsor, brandName, limit },
      observations,
      upstreamUrl: url,
    };
  }

  const days = Math.max(1, Math.min(Number(input.days) || 90, 365));
  const startDate = compactDate(input.startDate) || utcDateDaysAgo(days);
  const endDate = compactDate(input.endDate) || utcDateDaysAgo(0);
  const byApplication = new Map();
  const upstreamUrls = [];

  for (const prefix of ["NDA", "BLA"]) {
    const search = [
      'submissions.submission_type:"ORIG"',
      'submissions.submission_status:"AP"',
      `submissions.submission_status_date:[${startDate} TO ${endDate}]`,
      `application_number:${prefix}*`,
    ].join(" AND ");

    const { url, results } = await fetchResults(
      search,
      limit,
      "submissions.submission_status_date:desc"
    );
    upstreamUrls.push(url);

    for (const record of results) {
      const observation = normalizeRecord(record, url, { startDate, endDate });
      if (!observation) continue;
      byApplication.set(observation.externalId, observation);
    }
  }

  const observations = [...byApplication.values()].sort((a, b) =>
    String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""))
  );

  return {
    sourceKey: "openfda_drugsfda",
    tier: "A",
    query: {
      days,
      limit,
      startDate: displayDate(startDate),
      endDate: displayDate(endDate),
      applicationTypes: ["NDA", "BLA"],
    },
    observations,
    totalCount: observations.length,
    upstreamUrl: upstreamUrls[0] || "https://api.fda.gov/drug/drugsfda.json",
    upstreamUrls,
  };
}
