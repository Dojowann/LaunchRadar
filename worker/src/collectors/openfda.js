import { fetchJson } from "../lib/http.js";
import { isoNow, normalizeWhitespace } from "../lib/normalize.js";

function quoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function collectOpenFda(input = {}) {
  const applicationNumber = normalizeWhitespace(input.applicationNumber || "");
  const sponsor = normalizeWhitespace(input.sponsor || "");
  const brandName = normalizeWhitespace(input.brandName || "");
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 99));

  let search = "";
  if (applicationNumber) {
    search = `application_number:${quoted(applicationNumber)}`;
  } else if (sponsor) {
    search = `sponsor_name:${quoted(sponsor)}`;
  } else if (brandName) {
    search = `products.brand_name:${quoted(brandName)}`;
  } else {
    throw new Error(
      "openFDA collector requires applicationNumber, sponsor, or brandName."
    );
  }

  const params = new URLSearchParams({
    search,
    limit: String(limit),
  });

  const url = `https://api.fda.gov/drug/drugsfda.json?${params.toString()}`;
  const { payload } = await fetchJson(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Commercial-Launch-Radar/3.0",
    },
  });

  const observedAt = isoNow();
  const results = Array.isArray(payload?.results) ? payload.results : [];

  const observations = results.map((record) => {
    const products = Array.isArray(record?.products) ? record.products : [];
    const submissions = Array.isArray(record?.submissions) ? record.submissions : [];
    const brands = [...new Set(products.map((p) => p?.brand_name).filter(Boolean))];

    const latestSubmission = [...submissions]
      .filter((x) => x?.submission_status_date)
      .sort((a, b) =>
        String(b.submission_status_date).localeCompare(
          String(a.submission_status_date)
        )
      )[0];

    const appNo = record?.application_number || crypto.randomUUID();

    return {
      externalId: appNo,
      observationType: "fda_application",
      companyNameRaw: record?.sponsor_name || null,
      assetNameRaw: brands[0] || null,
      title: `${appNo}${brands.length ? ` — ${brands.join(", ")}` : ""}`,
      url,
      publishedAt: latestSubmission?.submission_status_date || null,
      observedAt,
      payload: {
        applicationNumber: record?.application_number || null,
        sponsorName: record?.sponsor_name || null,
        brands,
        products: products.map((p) => ({
          productNumber: p?.product_number || null,
          referenceDrug: p?.reference_drug || null,
          brandName: p?.brand_name || null,
          activeIngredients: p?.active_ingredients || [],
          dosageForm: p?.dosage_form || null,
          route: p?.route || null,
          marketingStatus: p?.marketing_status || null,
        })),
        latestSubmission: latestSubmission
          ? {
              submissionType: latestSubmission.submission_type || null,
              submissionNumber: latestSubmission.submission_number || null,
              status: latestSubmission.submission_status || null,
              statusDate: latestSubmission.submission_status_date || null,
              submissionClassCode:
                latestSubmission.submission_class_code || null,
              submissionClassCodeDescription:
                latestSubmission.submission_class_code_description || null,
            }
          : null,
      },
    };
  });

  return {
    sourceKey: "openfda_drugsfda",
    tier: "A",
    query: { applicationNumber, sponsor, brandName, limit },
    observations,
    upstreamUrl: url,
  };
}
