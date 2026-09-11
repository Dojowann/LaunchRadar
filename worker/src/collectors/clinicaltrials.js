import { fetchJson } from "../lib/http.js";
import { isoNow, normalizeWhitespace } from "../lib/normalize.js";

function get(obj, path, fallback = undefined) {
  return path.split(".").reduce((v, key) => (v == null ? undefined : v[key]), obj) ?? fallback;
}

function firstDrugIntervention(study) {
  const interventions =
    get(study, "protocolSection.armsInterventionsModule.interventions", []) || [];
  return (
    interventions.find((x) => x?.type === "DRUG" || x?.type === "BIOLOGICAL") ||
    interventions[0] ||
    null
  );
}

export async function collectClinicalTrials(input = {}) {
  const query = normalizeWhitespace(input.query || "AREA[Phase]PHASE3");
  const pageSize = Math.max(1, Math.min(Number(input.pageSize) || 25, 100));
  const pageToken = normalizeWhitespace(input.pageToken || "");

  const params = new URLSearchParams({
    format: "json",
    pageSize: String(pageSize),
    "query.term": query,
  });

  if (pageToken) params.set("pageToken", pageToken);

  const url = `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;
  const { payload } = await fetchJson(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Commercial-Launch-Radar/3.0",
    },
  });

  const observedAt = isoNow();
  const studies = Array.isArray(payload?.studies) ? payload.studies : [];

  const observations = studies.map((study) => {
    const ident = get(study, "protocolSection.identificationModule", {});
    const status = get(study, "protocolSection.statusModule", {});
    const sponsor = get(study, "protocolSection.sponsorCollaboratorsModule.leadSponsor", {});
    const design = get(study, "protocolSection.designModule", {});
    const conditions = get(study, "protocolSection.conditionsModule.conditions", []);
    const intervention = firstDrugIntervention(study);

    const nctId = ident?.nctId || crypto.randomUUID();
    const title = ident?.briefTitle || ident?.officialTitle || nctId;
    const publishedAt =
      status?.lastUpdatePostDateStruct?.date ||
      status?.studyFirstPostDateStruct?.date ||
      null;

    const normalizedPayload = {
      nctId,
      briefTitle: ident?.briefTitle || null,
      officialTitle: ident?.officialTitle || null,
      overallStatus: status?.overallStatus || null,
      phase: Array.isArray(design?.phases) ? design.phases : [],
      sponsor: sponsor?.name || null,
      sponsorClass: sponsor?.class || null,
      conditions: Array.isArray(conditions) ? conditions : [],
      intervention: intervention
        ? {
            type: intervention.type || null,
            name: intervention.name || null,
            otherNames: intervention.otherNames || [],
          }
        : null,
      primaryCompletionDate:
        status?.primaryCompletionDateStruct?.date || null,
      completionDate: status?.completionDateStruct?.date || null,
      studyFirstPostDate: status?.studyFirstPostDateStruct?.date || null,
      lastUpdatePostDate: status?.lastUpdatePostDateStruct?.date || null,
      hasResults: Boolean(study?.hasResults),
    };

    return {
      externalId: nctId,
      observationType: "clinical_trial",
      companyNameRaw: sponsor?.name || null,
      assetNameRaw: intervention?.name || null,
      title,
      url: `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`,
      publishedAt,
      observedAt,
      payload: normalizedPayload,
    };
  });

  return {
    sourceKey: "clinicaltrials_gov",
    tier: "A",
    query: { query, pageSize, pageToken: pageToken || null },
    observations,
    nextPageToken: payload?.nextPageToken || null,
    totalCount: payload?.totalCount ?? null,
    upstreamUrl: url,
  };
}
