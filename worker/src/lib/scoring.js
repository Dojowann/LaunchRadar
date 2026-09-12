import { isoNow, makeId } from "./normalize.js";

export const SCORING_VERSION = "v3-alpha-2-asset-attribution";

const PHASE_LABELS = {
  0: "Early",
  1: "Launch Planning",
  2: "Infrastructure Build",
  3: "Sales Leadership Build",
  4: "Field Force Build",
  5: "Scale / Launch",
  6: "Established",
};

const TIMING_POINTS = { 0: 2, 1: 6, 2: 9, 3: 10, 4: 9, 5: 5, 6: 1 };

const HIRING_EVENTS = new Set([
  "VP_SALES_APPOINTED",
  "NATIONAL_SALES_LEADER_APPOINTED",
  "RBD_JOB_POSTED",
  "SALES_MANAGER_JOB_POSTED",
  "KAM_JOB_POSTED",
  "FIELD_SALES_JOB_POSTED",
]);
const LEADERSHIP_EVENTS = new Set([
  "VP_SALES_APPOINTED",
  "NATIONAL_SALES_LEADER_APPOINTED",
  "RBD_JOB_POSTED",
  "SALES_MANAGER_JOB_POSTED",
]);
const FIELD_EVENTS = new Set(["KAM_JOB_POSTED", "FIELD_SALES_JOB_POSTED"]);
const STRONG_REGULATORY_EVENTS = new Set([
  "NDA_BLA_SUBMITTED",
  "APPLICATION_ACCEPTED",
  "PDUFA_ASSIGNED",
  "ADCOM_SCHEDULED",
  "FDA_APPROVED",
]);
const ASSET_CATALYST_EVENTS = new Set([
  ...STRONG_REGULATORY_EVENTS,
  "NDA_BLA_PLANNED",
  "PIVOTAL_POSITIVE",
  "INTERNAL_US_LAUNCH_PLANNED",
  "LAUNCH_TIMING_DISCLOSED",
  "US_RIGHTS_INTERNAL",
  "US_RIGHTS_ACQUIRED",
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function daysSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - dt.getTime()) / 86400000);
}

function maxEventDate(events) {
  return events.map((event) => event.event_date || event.observed_at).filter(Boolean).sort().at(-1) || null;
}

function hasEvent(events, type) {
  return events.some((event) => event.event_type === type);
}

function eventsOf(events, types) {
  const set = types instanceof Set ? types : new Set(types);
  return events.filter((event) => set.has(event.event_type));
}

function latestOf(events, types) {
  return eventsOf(events, types)
    .slice()
    .sort((a, b) => String(b.event_date || b.observed_at || "").localeCompare(String(a.event_date || a.observed_at || "")))[0] || null;
}

function assetEvents(events, assetId) {
  return events.filter((event) => event.asset_id === assetId);
}

function assetAttribution(events, assetId, hasPhase3Evidence) {
  const specific = assetEvents(events, assetId);
  const strong = specific.some((event) => ASSET_CATALYST_EVENTS.has(event.event_type));
  if (strong) return "strong";
  if (hasPhase3Evidence) return "clinical";
  return "none";
}

function effectiveHiring(events, jobs, assetId, attribution) {
  const specific = assetEvents(events, assetId);
  const specificLeadership = eventsOf(specific, LEADERSHIP_EVENTS).length;
  const specificField = eventsOf(specific, FIELD_EVENTS).length;

  if (attribution === "strong") {
    return {
      leadershipEvents: eventsOf(events, LEADERSHIP_EVENTS).length,
      fieldEvents: eventsOf(events, FIELD_EVENTS).length,
      jobs,
      companyJobsAllowed: true,
    };
  }

  return {
    leadershipEvents: specificLeadership,
    fieldEvents: specificField,
    jobs: {
      activeCommercial: 0,
      field: 0,
      leadership: 0,
      regions: 0,
      new30: 0,
      new90: 0,
    },
    companyJobsAllowed: false,
  };
}

function determinePhase(events, jobs, hasPhase3Evidence, assetId, attribution) {
  const hiring = effectiveHiring(events, jobs, assetId, attribution);
  const fieldHiring = hiring.fieldEvents + hiring.jobs.field;
  const leadershipHiring = hiring.leadershipEvents + hiring.jobs.leadership;
  const expansionHiring = fieldHiring + leadershipHiring > 0;

  if (hasEvent(events, "FIELD_FORCE_ESTABLISHED") && !expansionHiring) return 6;
  if (hasEvent(events, "FIELD_FORCE_SIZE_DISCLOSED") && fieldHiring >= 3) return 5;
  if (fieldHiring > 0) return 4;
  if (leadershipHiring > 0) return 3;

  if (
    hasEvent(events, "CCO_APPOINTED") ||
    hasEvent(events, "HEAD_COMMERCIAL_APPOINTED") ||
    hasEvent(events, "MARKET_ACCESS_BUILD") ||
    hasEvent(events, "COMMERCIAL_OPERATIONS_BUILD")
  ) return 2;

  const recentApproval = latestOf(assetEvents(events, assetId), ["FDA_APPROVED"]);
  if (recentApproval && daysSince(recentApproval.event_date) <= 180) return 5;

  if (
    assetEvents(events, assetId).some((event) =>
      ["INTERNAL_US_LAUNCH_PLANNED", "LAUNCH_TIMING_DISCLOSED", "US_RIGHTS_INTERNAL", "US_RIGHTS_ACQUIRED"].includes(event.event_type)
    ) || hasPhase3Evidence
  ) return 1;

  return 0;
}

function regulatoryScore(events, assetId, hasPhase3Evidence) {
  const relevant = [...assetEvents(events, assetId), ...events.filter((event) => event.asset_id == null && !HIRING_EVENTS.has(event.event_type))];
  const approval = latestOf(relevant, ["FDA_APPROVED"]);
  if (approval) {
    const age = daysSince(approval.event_date);
    if (age <= 90) return 20;
    if (age <= 180) return 19;
    if (age <= 365) return 17;
    return 12;
  }
  if (hasEvent(relevant, "PDUFA_ASSIGNED")) return 18;
  if (hasEvent(relevant, "ADCOM_SCHEDULED")) return 17;
  if (hasEvent(relevant, "APPLICATION_ACCEPTED")) return 15;
  if (hasEvent(relevant, "NDA_BLA_SUBMITTED")) return 13;
  if (hasEvent(relevant, "NDA_BLA_PLANNED")) return 10;
  if (hasEvent(relevant, "PIVOTAL_POSITIVE")) return 8;
  return hasPhase3Evidence ? 7 : 0;
}

function ownershipScore(events) {
  if (hasEvent(events, "US_RIGHTS_PARTNERED")) return 2;
  if (hasEvent(events, "CO_COMMERCIALIZATION")) return 12;
  if (hasEvent(events, "US_RIGHTS_ACQUIRED")) return hasEvent(events, "INTERNAL_US_LAUNCH_PLANNED") ? 20 : 18;
  if (hasEvent(events, "US_RIGHTS_INTERNAL")) return hasEvent(events, "INTERNAL_US_LAUNCH_PLANNED") ? 20 : 17;
  return 7;
}

function orgBuildScore(events, phase, assetId, attribution) {
  const specific = assetEvents(events, assetId);
  const hiringEvents = attribution === "strong" ? events : specific;
  if (phase >= 4) return 19;
  if (hasEvent(hiringEvents, "RBD_JOB_POSTED") || hasEvent(hiringEvents, "SALES_MANAGER_JOB_POSTED")) return 18;
  if (hasEvent(events, "VP_SALES_APPOINTED") || hasEvent(events, "NATIONAL_SALES_LEADER_APPOINTED")) return 15;
  if (hasEvent(events, "MARKET_ACCESS_BUILD") || hasEvent(events, "COMMERCIAL_OPERATIONS_BUILD")) return 11;
  if (hasEvent(events, "CCO_APPOINTED") || hasEvent(events, "HEAD_COMMERCIAL_APPOINTED")) return 8;
  if (hasEvent(specific, "INTERNAL_US_LAUNCH_PLANNED")) return 4;
  return 1;
}

function hiringScore(events, jobs, assetId, attribution) {
  const hiring = effectiveHiring(events, jobs, assetId, attribution);
  const eventLeadership = hiring.leadershipEvents;
  const eventField = hiring.fieldEvents;
  const activeCommercial = hiring.jobs.activeCommercial;
  const new30 = hiring.jobs.new30;
  const new90 = hiring.jobs.new90;
  const regions = hiring.jobs.regions;
  let score = 0;

  if (eventLeadership > 0 || hiring.jobs.leadership > 0) score = Math.max(score, 10);
  if (eventLeadership >= 2 || hiring.jobs.leadership >= 2) score = Math.max(score, 13);
  if (eventField > 0 || hiring.jobs.field > 0) score = Math.max(score, 15);
  if (eventField >= 2 || hiring.jobs.field >= 2 || regions >= 2) score = Math.max(score, 18);
  if (activeCommercial >= 8 || new30 >= 5 || regions >= 5) score = Math.max(score, 22);
  if (activeCommercial >= 15 || new30 >= 10 || new90 >= 20) score = 25;

  if (score === 0 && hasEvent(events, "MARKET_ACCESS_BUILD")) score = 4;
  if (attribution === "clinical") score = Math.min(score, 8);
  if (attribution === "none") score = Math.min(score, 4);
  return score;
}

function executionScore(events) {
  if (hasEvent(events, "FINANCING_FOR_COMMERCIALIZATION")) return 5;
  if (hasEvent(events, "COMMERCIAL_SPEND_GUIDANCE")) return 4;
  if (hasEvent(events, "CASH_RUNWAY_DISCLOSED")) return 3;
  if (hasEvent(events, "FINANCING_COMPLETED")) return 2;
  return 1;
}

function coverageGroup(sourceKey) {
  if (sourceKey === "clinicaltrials_gov") return "clinical";
  if (["openfda_drugsfda", "fda_adcom", "fda_tracker"].includes(sourceKey)) return "regulatory";
  if (sourceKey === "company_ir") return "company";
  if (["company_careers", "greenhouse", "lever", "ashby", "workday", "smartrecruiters", "careers_jsonld"].includes(sourceKey)) return "hiring";
  if (sourceKey === "sec_edgar") return "corporate";
  return null;
}

function sourceCoverage(checks) {
  const groups = new Set();
  for (const check of checks) {
    if (check.status !== "complete") continue;
    const group = coverageGroup(check.source_key);
    if (group) groups.add(group);
  }
  return Math.round((groups.size / 5) * 100);
}

function evidenceConfidence(events, evidence, checks) {
  const primary = evidence.filter((row) => Number(row.is_primary) === 1).length;
  const tierA = evidence.filter((row) => row.source_tier === "A").length;
  const tierB = evidence.filter((row) => row.source_tier === "B").length;
  const maxSources = Math.max(0, ...events.map((event) => Number(event.source_count) || 0));

  const authority = primary > 0 ? 35 : tierA > 0 ? 28 : tierB > 0 ? 20 : 10;
  const corroboration = maxSources >= 3 ? 20 : maxSources >= 2 ? 16 : evidence.length >= 2 ? 10 : evidence.length === 1 ? 5 : 0;
  const coverage = sourceCoverage(checks);
  const coveragePoints = Math.round(coverage * 0.25);
  const latest = maxEventDate(events) || evidence.map((row) => row.observed_at).filter(Boolean).sort().at(-1);
  const age = daysSince(latest);
  const freshness = age <= 90 ? 10 : age <= 180 ? 8 : age <= 365 ? 6 : age <= 730 ? 4 : 2;
  const rightsConflict = hasEvent(events, "US_RIGHTS_PARTNERED") && (hasEvent(events, "US_RIGHTS_INTERNAL") || hasEvent(events, "US_RIGHTS_ACQUIRED"));
  const launchConflict = hasEvent(events, "LAUNCH_DELAYED") && hasEvent(events, "INTERNAL_US_LAUNCH_PLANNED");
  const consistency = rightsConflict ? 3 : launchConflict ? 6 : 10;

  return {
    confidence: clamp(authority + corroboration + coveragePoints + freshness + consistency, 0, 100),
    sourceCoverage: coverage,
    rightsConflict,
  };
}

function unresolvedRegulatorySetback(events) {
  const setback = latestOf(events, ["CRL_RECEIVED", "PIVOTAL_NEGATIVE"]);
  if (!setback) return false;
  const recovery = latestOf(events, ["PIVOTAL_POSITIVE", "NDA_BLA_SUBMITTED", "APPLICATION_ACCEPTED", "PDUFA_ASSIGNED", "FDA_APPROVED"]);
  if (!recovery) return true;
  return String(recovery.event_date || recovery.observed_at || "") <= String(setback.event_date || setback.observed_at || "");
}

function applyCaps(score, events, jobs, assetId, attribution) {
  let capped = score;
  const caps = [];
  const specificHiring = eventsOf(assetEvents(events, assetId), HIRING_EVENTS).length > 0;
  const attributableCompanyHiring = attribution === "strong" && jobs.activeCommercial > 0;
  const internalHiring = specificHiring || attributableCompanyHiring;

  if (hasEvent(events, "US_RIGHTS_PARTNERED") && !internalHiring) {
    capped = Math.min(capped, 35);
    caps.push("Partner controls U.S. rights");
  }
  if (hasEvent(events, "CSO_SELECTED") && !internalHiring) {
    capped = Math.min(capped, 50);
    caps.push("Outsourced CSO model");
  }
  if (unresolvedRegulatorySetback(events)) {
    capped = Math.min(capped, 30);
    caps.push("Unresolved regulatory/clinical setback");
  }

  const expansionCatalyst = internalHiring || hasEvent(assetEvents(events, assetId), "ASSET_ACQUIRED") || hasEvent(assetEvents(events, assetId), "INTERNAL_US_LAUNCH_PLANNED");
  if (hasEvent(events, "FIELD_FORCE_ESTABLISHED") && !expansionCatalyst) {
    capped = Math.min(capped, 40);
    caps.push("Field force already established");
  }
  if (attribution === "none" && jobs.activeCommercial > 0) {
    caps.push("Company-level hiring not attributed to this asset");
  }

  return { score: capped, caps };
}

function recommendation({ score, confidence, coverage, phase, events, jobs, rightsConflict, assetId, attribution }) {
  const assetHiring = eventsOf(assetEvents(events, assetId), HIRING_EVENTS).length > 0;
  const companyHiring = attribution === "strong" && jobs.activeCommercial > 0;
  const hiringSignal = assetHiring || companyHiring;
  const strongCatalyst = assetEvents(events, assetId).some((event) => STRONG_REGULATORY_EVENTS.has(event.event_type));
  const criticalConflict = rightsConflict || unresolvedRegulatorySetback(events);

  if (score >= 70 && confidence >= 70 && coverage >= 50 && !criticalConflict && (hiringSignal || strongCatalyst)) return "CONTACT NOW";
  if (score >= 60 && (confidence < 70 || coverage < 50 || criticalConflict)) return "NEEDS VERIFICATION";
  if (phase >= 2 || score >= 45) return "DEVELOP RELATIONSHIP";
  return "MONITOR";
}

function nextExpectedEvent(phase) {
  return {
    0: "Launch planning, U.S. rights clarification, or commercial leadership",
    1: "Market access / commercial operations build",
    2: "VP Sales or regional first-line sales leadership",
    3: "Territory-level field sales hiring",
    4: "Broader multi-region field-force rollout",
    5: "Launch-scale hiring, replacement, or expansion",
    6: "New indication, geography, franchise, or leadership expansion",
  }[phase];
}

function rationale({ events, phase, caps, hasPhase3Evidence, jobs, assetId, attribution }) {
  const points = [];
  if (hasPhase3Evidence) points.push("Phase III clinical evidence present");
  if (hasEvent(assetEvents(events, assetId), "FDA_APPROVED")) points.push("asset-linked FDA approval present");
  if (hasEvent(events, "US_RIGHTS_INTERNAL")) points.push("internal U.S. rights supported");
  if (hasEvent(events, "US_RIGHTS_PARTNERED")) points.push("U.S. rights appear partnered");
  if (hasEvent(assetEvents(events, assetId), "INTERNAL_US_LAUNCH_PLANNED")) points.push("asset-linked U.S. launch intent supported");
  if (eventsOf(assetEvents(events, assetId), LEADERSHIP_EVENTS).length) points.push("asset-linked sales leadership build detected");
  if (eventsOf(assetEvents(events, assetId), FIELD_EVENTS).length) points.push("asset-linked field-sales hiring detected");
  if (attribution === "strong" && jobs.activeCommercial > 0) points.push("company-level U.S. commercial hiring is supported by an asset-specific catalyst");
  if (attribution !== "strong" && jobs.activeCommercial > 0) points.push("company-level hiring is not fully attributed to this asset");
  if (hasEvent(events, "MARKET_ACCESS_BUILD")) points.push("market-access infrastructure detected");
  if (hasEvent(events, "FINANCING_FOR_COMMERCIALIZATION")) points.push("financing tied to commercialization");
  if (caps.length) points.push(`score note: ${caps.join("; ")}`);
  if (!points.length) points.push("limited commercial evidence; monitor for stronger launch/hiring signals");
  return `Phase ${phase} — ${PHASE_LABELS[phase]}. ${points.join("; ")}.`;
}

async function targetFacts(DB, companyId, assetId) {
  const [eventsResult, evidenceResult, checksResult, jobsResult, trialResult] = await Promise.all([
    DB.prepare(
      `SELECT id, company_id, asset_id, event_type, event_date, observed_at, status, value_text,
              value_number, value_json, evidence_confidence, source_count, primary_source_count
         FROM intelligence_events
        WHERE company_id = ?
          AND active = 1
          AND (asset_id = ? OR asset_id IS NULL)
        ORDER BY COALESCE(event_date, observed_at) DESC`
    ).bind(companyId, assetId).all(),
    DB.prepare(
      `SELECT DISTINCT e.id, e.source_key, e.source_tier, e.is_primary,
              e.published_at, e.observed_at, e.confidence
         FROM evidence e
        WHERE e.company_id = ?
          AND e.is_current = 1
          AND (e.asset_id = ? OR e.asset_id IS NULL)`
    ).bind(companyId, assetId).all(),
    DB.prepare(
      `SELECT source_key, status, started_at, completed_at, records_found
         FROM source_checks
        WHERE company_id = ?
        ORDER BY started_at DESC`
    ).bind(companyId).all(),
    DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' AND role_family IN ('field_sales','sales_leadership','market_access') THEN 1 ELSE 0 END) AS active_commercial,
         SUM(CASE WHEN status = 'active' AND role_family = 'field_sales' THEN 1 ELSE 0 END) AS field_count,
         SUM(CASE WHEN status = 'active' AND role_family = 'sales_leadership' THEN 1 ELSE 0 END) AS leadership_count,
         COUNT(DISTINCT CASE WHEN status = 'active' THEN location END) AS regions,
         SUM(CASE WHEN first_seen_at >= datetime('now','-30 days') AND role_family IN ('field_sales','sales_leadership','market_access') THEN 1 ELSE 0 END) AS new30,
         SUM(CASE WHEN first_seen_at >= datetime('now','-90 days') AND role_family IN ('field_sales','sales_leadership','market_access') THEN 1 ELSE 0 END) AS new90
       FROM job_postings
       WHERE company_id = ?`
    ).bind(companyId).first(),
    DB.prepare(
      `SELECT COUNT(*) AS n
         FROM source_observations o
         JOIN observation_identity oi ON oi.observation_id = o.id
        WHERE oi.company_id = ?
          AND oi.asset_id = ?
          AND o.source_key = 'clinicaltrials_gov'
          AND o.observation_type = 'clinical_trial'
          AND (json_extract(o.payload_json, '$.phase') LIKE '%PHASE3%' OR json_extract(o.payload_json, '$.phases') LIKE '%PHASE3%')`
    ).bind(companyId, assetId).first(),
  ]);

  return {
    events: eventsResult.results || [],
    evidence: evidenceResult.results || [],
    checks: checksResult.results || [],
    jobs: {
      activeCommercial: Number(jobsResult?.active_commercial || 0),
      field: Number(jobsResult?.field_count || 0),
      leadership: Number(jobsResult?.leadership_count || 0),
      regions: Number(jobsResult?.regions || 0),
      new30: Number(jobsResult?.new30 || 0),
      new90: Number(jobsResult?.new90 || 0),
    },
    hasPhase3Evidence: Number(trialResult?.n || 0) > 0,
  };
}

async function upsertOpportunity(DB, target, score) {
  const existing = await DB.prepare(`SELECT * FROM opportunities WHERE company_id = ? AND asset_id = ? LIMIT 1`)
    .bind(target.company_id, target.asset_id).first();
  const opportunityId = existing?.id || makeId("opp");
  const scoredAt = isoNow();

  await DB.prepare(
    `INSERT INTO opportunities
      (id, company_id, asset_id, hiring_phase, hiring_phase_label,
       regulatory_score, commercial_ownership_score, org_build_score,
       hiring_score, timing_score, execution_capacity_score,
       opportunity_score, evidence_confidence, source_coverage,
       recommended_action, next_expected_hiring_event, rationale,
       scored_at, scoring_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id, asset_id) DO UPDATE SET
       hiring_phase = excluded.hiring_phase,
       hiring_phase_label = excluded.hiring_phase_label,
       regulatory_score = excluded.regulatory_score,
       commercial_ownership_score = excluded.commercial_ownership_score,
       org_build_score = excluded.org_build_score,
       hiring_score = excluded.hiring_score,
       timing_score = excluded.timing_score,
       execution_capacity_score = excluded.execution_capacity_score,
       opportunity_score = excluded.opportunity_score,
       evidence_confidence = excluded.evidence_confidence,
       source_coverage = excluded.source_coverage,
       recommended_action = excluded.recommended_action,
       next_expected_hiring_event = excluded.next_expected_hiring_event,
       rationale = excluded.rationale,
       scored_at = excluded.scored_at,
       scoring_version = excluded.scoring_version,
       updated_at = excluded.updated_at`
  ).bind(
    opportunityId, target.company_id, target.asset_id, score.phase, PHASE_LABELS[score.phase],
    score.regulatory, score.ownership, score.orgBuild, score.hiring, score.timing, score.execution,
    score.total, score.confidence, score.coverage, score.action, score.nextExpected, score.rationale,
    scoredAt, SCORING_VERSION, existing?.created_at || scoredAt, scoredAt
  ).run();

  const materiallyChanged = !existing || Number(existing.hiring_phase) !== score.phase ||
    Number(existing.opportunity_score) !== score.total || Number(existing.evidence_confidence) !== score.confidence ||
    existing.recommended_action !== score.action;

  if (materiallyChanged) {
    await DB.prepare(
      `INSERT INTO opportunity_snapshots
        (id, opportunity_id, captured_at, hiring_phase, opportunity_score,
         evidence_confidence, source_coverage, recommended_action, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(makeId("snap"), opportunityId, scoredAt, score.phase, score.total, score.confidence,
      score.coverage, score.action, JSON.stringify(score)).run();
  }

  if (existing && existing.recommended_action !== score.action) {
    await DB.prepare(
      `INSERT INTO changes
        (id, company_id, asset_id, opportunity_id, event_id,
         change_type, previous_value, new_value, severity, detected_at)
       VALUES (?, ?, ?, ?, NULL, 'recommended_action', ?, ?, ?, ?)`
    ).bind(makeId("change"), target.company_id, target.asset_id, opportunityId,
      existing.recommended_action, score.action, score.action === "CONTACT NOW" ? "high" : "info", scoredAt).run();
  }

  return materiallyChanged;
}

export async function scoreOpportunities(DB, { limit = 500 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const targets = await DB.prepare(
    `SELECT a.id AS asset_id, a.canonical_name AS asset_name,
            c.id AS company_id, c.canonical_name AS company_name
       FROM assets a
       JOIN companies c ON c.id = a.company_id
      ORDER BY c.canonical_name, a.canonical_name
      LIMIT ?`
  ).bind(safeLimit).all();

  let scored = 0;
  let changed = 0;
  const actionCounts = {};

  for (const target of targets.results || []) {
    const facts = await targetFacts(DB, target.company_id, target.asset_id);
    const attribution = assetAttribution(facts.events, target.asset_id, facts.hasPhase3Evidence);
    const phase = determinePhase(facts.events, facts.jobs, facts.hasPhase3Evidence, target.asset_id, attribution);
    const regulatory = regulatoryScore(facts.events, target.asset_id, facts.hasPhase3Evidence);
    const ownership = ownershipScore(facts.events);
    const orgBuild = orgBuildScore(facts.events, phase, target.asset_id, attribution);
    const hiring = hiringScore(facts.events, facts.jobs, target.asset_id, attribution);
    const timing = TIMING_POINTS[phase] ?? 0;
    const execution = executionScore(facts.events);
    const rawTotal = clamp(regulatory + ownership + orgBuild + hiring + timing + execution, 0, 100);
    const capped = applyCaps(rawTotal, facts.events, facts.jobs, target.asset_id, attribution);
    const confidence = evidenceConfidence(facts.events, facts.evidence, facts.checks);
    const action = recommendation({
      score: capped.score,
      confidence: confidence.confidence,
      coverage: confidence.sourceCoverage,
      phase,
      events: facts.events,
      jobs: facts.jobs,
      rightsConflict: confidence.rightsConflict,
      assetId: target.asset_id,
      attribution,
    });

    const score = {
      phase, regulatory, ownership, orgBuild, hiring, timing, execution, rawTotal,
      total: capped.score, caps: capped.caps, confidence: confidence.confidence,
      coverage: confidence.sourceCoverage, action, attribution,
      nextExpected: nextExpectedEvent(phase),
      rationale: rationale({ events: facts.events, phase, caps: capped.caps,
        hasPhase3Evidence: facts.hasPhase3Evidence, jobs: facts.jobs,
        assetId: target.asset_id, attribution }),
    };

    if (await upsertOpportunity(DB, target, score)) changed += 1;
    scored += 1;
    actionCounts[action] = Number(actionCounts[action] || 0) + 1;
  }

  return { scoringVersion: SCORING_VERSION, scored, changed, actionCounts };
}

export async function listOpportunities(DB, { limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const result = await DB.prepare(
    `SELECT
       o.id, o.company_id, o.asset_id,
       c.canonical_name AS company_name,
       a.canonical_name AS asset_name,
       o.hiring_phase, o.hiring_phase_label,
       o.regulatory_score, o.commercial_ownership_score,
       o.org_build_score, o.hiring_score, o.timing_score,
       o.execution_capacity_score, o.opportunity_score,
       o.evidence_confidence, o.source_coverage,
       o.recommended_action, o.next_expected_hiring_event,
       o.rationale, o.scored_at, o.scoring_version,
       MAX(ie.event_date) AS latest_event_date,
       COUNT(DISTINCT ie.id) AS event_count
     FROM opportunities o
     JOIN companies c ON c.id = o.company_id
     LEFT JOIN assets a ON a.id = o.asset_id
     LEFT JOIN intelligence_events ie
       ON ie.company_id = o.company_id
      AND ie.active = 1
      AND (ie.asset_id = o.asset_id OR ie.asset_id IS NULL)
     GROUP BY o.id
     ORDER BY
       CASE o.recommended_action
         WHEN 'CONTACT NOW' THEN 1
         WHEN 'NEEDS VERIFICATION' THEN 2
         WHEN 'DEVELOP RELATIONSHIP' THEN 3
         ELSE 4
       END,
       o.opportunity_score DESC,
       o.evidence_confidence DESC,
       c.canonical_name ASC
     LIMIT ?`
  ).bind(safeLimit).all();
  return result.results || [];
}
