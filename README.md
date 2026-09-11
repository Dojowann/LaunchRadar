# Commercial Launch Radar

GitHub repository for the Commercial Launch Radar v3 rebuild.

## Repository structure

```text
LaunchRadar/
├── dashboard/
│   └── index.html
├── worker/
│   ├── src/
│   │   ├── index.js
│   │   ├── sources.js
│   │   ├── collectors/
│   │   └── lib/
│   ├── migrations/
│   │   └── 0001_v3_foundation.sql
│   └── wrangler.toml.example
├── docs/
├── data/
│   └── gold-standard-template.csv
├── legacy/
│   └── v2-worker.js
├── .env.example
├── .gitignore
├── DEPLOY.md
├── SECURITY.md
└── README.md
```

## Current state

The **v3 backend foundation** uses Cloudflare Workers + D1 as the shared data layer across Firefox, Chrome, Safari and Edge.

The modular v3 Worker includes deterministic collector foundations for ClinicalTrials.gov, SEC EDGAR, openFDA / Drugs@FDA, Greenhouse, Lever and Ashby. FDA Tracker, FDA Advisory Committee, company IR/careers and other public-web research sources are explicitly registered for the deep-research layer.

`dashboard/index.html` is a lightweight v3 foundation dashboard that reads health, source-registry, scan-run and observation data from the shared Worker/D1 backend. It is a scaffold, not the final Salesforce-style analytics dashboard. The next UI milestone will add the opportunity table, hiring phases, evidence confidence, change intelligence and charts.

## v3 design goals

- one shared D1 database across modern browsers
- deterministic collectors for authoritative public sources
- explicit source registry and measurable source coverage
- dated intelligence events rather than simple booleans
- commercial hiring phase 0–6
- opportunity score separate from evidence confidence
- hiring velocity and change detection
- server-side scan history
- password-protected scan actions
- analytics charts below the scrollable opportunity table
- historical evaluation / backtesting before final score calibration

See `docs/BUILD-ROADMAP.md`, `docs/INTELLIGENCE-SPEC.md`, and `docs/SCORING-V3-ALPHA.md`.

## Secrets

Never commit:

- `OPENAI_API_KEY`
- `RADAR_ACCESS_TOKEN`

They belong only in Cloudflare Secrets.

## D1 data

The live database is not stored in GitHub. GitHub stores the database schema/migrations, while production records remain in Cloudflare D1.

## Legacy

`legacy/v2-worker.js` is retained only as a rollback/reference copy of the prior Worker architecture.

## Next build

The next development step is canonical company/asset identity resolution plus deep-research/evidence logic, followed by the full D1-backed analytics dashboard.
