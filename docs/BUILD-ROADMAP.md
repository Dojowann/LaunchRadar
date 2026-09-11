# Build Roadmap

## Phase 0 — Intelligence specification — INCLUDED

Status: foundation created.

Outputs:
- canonical event vocabulary
- commercial hiring phases
- negative-intelligence rules
- evidence-confidence separation
- gold-standard evaluation framework

## Phase 1 — D1 canonical schema — INCLUDED

Status: migration created.

The D1 schema includes:
- companies / aliases
- assets / aliases
- source registry
- source checks
- raw observations
- evidence
- intelligence events
- job postings
- rights relationships
- opportunities
- opportunity snapshots
- changes
- scan runs / scan steps
- watchlist
- configurable source targets

## Phase 2 — deterministic collectors — INCLUDED

Initial collectors:
- ClinicalTrials.gov API
- SEC EDGAR submissions API
- openFDA / Drugs@FDA
- Greenhouse public job boards
- Lever postings
- Ashby public job boards

Registered but deferred to the research-agent layer:
- FDA Tracker
- FDA Advisory Committee calendar
- Company IR / press releases
- investor presentations
- company careers pages without a known ATS API
- trade press
- general web

## Phase 3 — identity resolution — NEXT

Build:
- normalized company aliases
- SEC CIK / ticker matching
- sponsor-to-company resolution
- asset / code-name aliases
- acquired / licensed asset lineage
- canonical company + asset merge rules

## Phase 4 — deep research agent

For qualified candidates, investigate:
- U.S. rights
- regulatory catalyst
- launch timing
- first commercial product
- CCO / commercial leadership
- Market Access
- sales leadership
- field jobs
- field-force size
- internal vs outsourced
- CSO relationships
- financing / runway
- management launch statements
- contradictions and changes

The agent stores facts and evidence. It does not assign the final score.

## Phase 5 — evidence / conflict engine

Build:
- source authority weighting
- corroboration
- freshness
- supersession
- conflicting fact groups
- source coverage
- NEEDS VERIFICATION gate

## Phase 6 — hiring-phase engine

Derive Phase 0–6 from dated events and current job inventory.

## Phase 7 — scoring v3

Implement the alpha scoring specification, then calibrate it with the gold-standard set.

## Phase 8 — historical backtest

Test lead time and false positives against past launches / commercial builds.

## Phase 9 — server-side scan orchestration

Move scan state out of the browser.

Refreshing or closing Firefox will no longer lose the scan.

## Phase 10 — scan password

Use Cloudflare Secret:

`RADAR_ACCESS_TOKEN`

The actual password is not stored in source control.

## Phase 11 — dashboard v3

Replace browser localStorage master data with D1 API calls.

Add:
- shared cross-browser company list
- recent changes
- scan history
- data health
- source coverage
- opportunity confidence
- hiring phase

Analytics below the independently scrollable company table:
- priority mix pie
- opportunities by therapeutic area
- hiring-phase distribution
- regulatory-stage distribution
- commercial-build signals
- score distribution
- new opportunities over time
- hiring signals over time

## Phase 12 — browser QA

Explicit test matrix:
- Firefox
- Chrome
- Safari
- Edge

## Phase 13 — scheduled monitoring

After validation:
- Cloudflare scheduled collectors
- targeted watchlist refreshes
- change alerts
- stale-evidence refresh

## Collector API examples

### ClinicalTrials.gov

```json
{
  "source": "clinicaltrials_gov",
  "query": "AREA[Phase]PHASE3",
  "pageSize": 25
}
```

### SEC EDGAR

```json
{
  "source": "sec_edgar",
  "cik": "0000000000",
  "limit": 40
}
```

Requires `SEC_USER_AGENT` in Cloudflare.

### openFDA / Drugs@FDA

```json
{
  "source": "openfda_drugsfda",
  "sponsor": "Example Pharma",
  "limit": 20
}
```

### Greenhouse

```json
{
  "source": "greenhouse",
  "companyName": "Example Bio",
  "boardToken": "examplebio"
}
```

### Lever

```json
{
  "source": "lever",
  "companyName": "Example Bio",
  "site": "examplebio"
}
```

### Ashby

```json
{
  "source": "ashby",
  "companyName": "Example Bio",
  "boardName": "ExampleBio"
}
```
