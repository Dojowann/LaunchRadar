# Commercial Launch Radar

GitHub-ready repository for the Commercial Launch Radar rebuild.

## What is in this repo

```text
commercial-launch-radar/
├── dashboard/
│   └── index.html
├── worker/
│   ├── src/
│   │   └── index.js
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

The **v3 backend foundation** is live in Cloudflare and uses D1 as the shared database.

The v3 source registry and collector architecture are represented in `worker/src/index.js`.

The dashboard in `dashboard/index.html` is the current stable v2 UI and is included so all project code lives in one repository. It still uses the v2 browser-storage architecture. The next UI milestone is to replace it with the D1-backed v3 dashboard with shared cross-browser records and analytics.

## v3 design goals

- one shared D1 database across Firefox, Chrome, Safari, and Edge
- deterministic collectors for authoritative public sources
- explicit source registry and source coverage
- dated intelligence events rather than simple booleans
- commercial hiring phase 0–6
- opportunity score separate from evidence confidence
- hiring velocity and change detection
- server-side scan history
- password-protected scan actions
- analytics charts below the scrollable opportunity table
- historical evaluation / backtesting before final score calibration

See `docs/BUILD-ROADMAP.md` and `docs/INTELLIGENCE-SPEC.md`.

## Secrets

Never commit:

- `OPENAI_API_KEY`
- `RADAR_ACCESS_TOKEN`

They belong only in Cloudflare Secrets.

## D1 data

The live database is not stored in GitHub. GitHub stores only the database schema/migrations.

## Next build

The next development step is identity resolution + deep-research/evidence logic, followed by the D1-backed v3 dashboard.
