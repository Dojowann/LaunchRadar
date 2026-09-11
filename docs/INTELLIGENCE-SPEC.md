# Intelligence Specification

## Product question

Commercial Launch Radar should answer:

> How likely is this company to need a meaningful U.S. commercial recruiting build, where is it on that hiring timeline, and when should a recruiting business-development team engage?

The system is not a generic biotech-news tracker. Regulatory news matters only insofar as it changes the probability, timing, ownership, scale, or accessibility of a commercial hiring event.

## Core rules

### Facts are not booleans

v2 represented facts such as:

`rbd_hiring = true`

v3 records events:

```text
event_type: RBD_JOB_POSTED
event_date: 2026-09-08
observed_at: 2026-09-09T14:22:00Z
company: Example Bio
asset: Drug X
quantity: 4
source: company careers
source_tier: A
confidence: 0.98
```

This makes freshness, sequencing, velocity, and historical change measurable.

### Unknown is different from false

If a scan did not find a CSO relationship, that does **not** mean one does not exist.

Each fact can be:

- supported
- contradicted
- unknown
- stale
- superseded

### Evidence always travels with the fact

Every material event should retain:

- direct URL
- title
- source key
- source tier
- publication date when known
- observation date
- claim / extracted fact
- confidence
- content hash
- corroborating evidence count
- whether the source is primary

### Scores are deterministic

The AI can:

- find evidence
- extract facts
- reconcile wording
- identify conflicts
- summarize rationale

The AI does **not** decide the final numerical opportunity score.

## Canonical event vocabulary

### Regulatory

- `PIVOTAL_POSITIVE`
- `PIVOTAL_NEGATIVE`
- `NDA_BLA_PLANNED`
- `NDA_BLA_SUBMITTED`
- `APPLICATION_ACCEPTED`
- `PDUFA_ASSIGNED`
- `PDUFA_CHANGED`
- `ADCOM_SCHEDULED`
- `FDA_APPROVED`
- `CRL_RECEIVED`
- `REGULATORY_DELAY`

### Commercial rights and launch intent

- `US_RIGHTS_INTERNAL`
- `US_RIGHTS_ACQUIRED`
- `US_RIGHTS_PARTNERED`
- `CO_COMMERCIALIZATION`
- `INTERNAL_US_LAUNCH_PLANNED`
- `CSO_SELECTED`
- `LAUNCH_DELAYED`
- `LAUNCH_TIMING_DISCLOSED`

### Commercial organization

- `CCO_APPOINTED`
- `HEAD_COMMERCIAL_APPOINTED`
- `VP_SALES_APPOINTED`
- `NATIONAL_SALES_LEADER_APPOINTED`
- `MARKET_ACCESS_BUILD`
- `COMMERCIAL_OPERATIONS_BUILD`
- `RBD_JOB_POSTED`
- `SALES_MANAGER_JOB_POSTED`
- `KAM_JOB_POSTED`
- `FIELD_SALES_JOB_POSTED`
- `FIELD_FORCE_SIZE_DISCLOSED`
- `FIELD_FORCE_ESTABLISHED`

### Corporate capacity

- `FINANCING_COMPLETED`
- `FINANCING_FOR_COMMERCIALIZATION`
- `CASH_RUNWAY_DISCLOSED`
- `COMMERCIAL_SPEND_GUIDANCE`
- `RESTRUCTURING`
- `LAYOFF`
- `ASSET_ACQUIRED`
- `ASSET_DIVESTED`

## Commercial Hiring Phases

### Phase 0 — Early

Late-stage clinical development exists, but there is little evidence of a U.S. commercial build.

Typical evidence:
- Phase III / pivotal
- no U.S. launch language
- no commercial leadership build

Action: monitor.

### Phase 1 — Launch Planning

Management is preparing for submission or commercialization but the selling organization is not yet visibly forming.

Typical evidence:
- positive pivotal data
- NDA/BLA planning or submission
- retained U.S. rights
- launch planning language
- financing for commercialization

Action: develop relationship.

### Phase 2 — Infrastructure Build

Commercial infrastructure is appearing before field-sales leadership.

Typical evidence:
- CCO / Head of Commercial
- Market Access
- Commercial Operations
- pricing / reimbursement roles
- launch readiness language

Action: developing; often worth early outreach.

### Phase 3 — Sales Leadership Build

The company is constructing the leadership layer that usually precedes broad territory hiring.

Typical evidence:
- VP / Head of Sales
- National Sales Leader
- Regional Business Director
- Regional Sales Director
- Area Business Director
- District Manager

Action: prime recruiting business-development window.

### Phase 4 — Field Force Build

Territory-level field roles are appearing and/or accelerating.

Typical evidence:
- Account Executive
- Territory Business Manager
- Key Account Manager
- specialty sales
- multiple territories / regions

Action: contact now.

### Phase 5 — Scale / Launch

Large-volume hiring is underway or launch is imminent / very recent.

Typical evidence:
- many active commercial postings
- disclosed national field-force build
- launch execution underway

Action: high-volume opportunity, but later in the sales cycle.

### Phase 6 — Established

The initial field organization is materially staffed and there is no identified expansion trigger.

Action: monitor for indication, franchise, geography, or leadership expansion.

## Negative intelligence

The system must actively search for facts that invalidate an attractive recruiting thesis.

Examples:

- U.S. rights controlled by another company
- CSO / outsourced selling organization selected
- field team already hired
- asset delayed
- Complete Response Letter
- pivotal failure
- launch abandoned
- commercialization partner changed

Negative evidence should not be treated as an afterthought. It is part of the required source checklist.

## Recommended action gates

`CONTACT NOW` should require all of the following unless an override is explicitly documented:

1. Opportunity score above the calibrated threshold.
2. Evidence confidence above the calibrated threshold.
3. No unresolved critical rights / outsourcing conflict.
4. Sufficient source coverage.
5. At least one current hiring or organizational-build signal, or an unusually strong near-term launch catalyst.

`NEEDS VERIFICATION` should be used when the opportunity looks strong but evidence confidence or source coverage is inadequate.
