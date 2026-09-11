# Deployment guide

## 1. Repository

This repository is already populated. Keep the production secrets out of GitHub.

## 2. Connect the existing v3 Cloudflare Worker to GitHub

Keep the live v3 Worker and D1 database you already created.

When you are ready for GitHub-driven deploys:

1. Open the v3 Worker in Cloudflare.
2. Connect it to `Dojowann/LaunchRadar`.
3. Set the Worker root directory to `worker`.
4. Copy `worker/wrangler.toml.example` to `worker/wrangler.toml`.
5. Replace `PASTE_YOUR_D1_DATABASE_ID_HERE` with the actual D1 database ID and uncomment the D1 binding block.
6. Commit `worker/wrangler.toml`.
7. Keep `OPENAI_API_KEY` and `RADAR_ACCESS_TOKEN` as Cloudflare Secrets, not repo variables.

## 3. D1

The canonical schema is:

`worker/migrations/0001_v3_foundation.sql`

The live D1 data stays in Cloudflare. GitHub stores only migrations and application code.

## 4. Dashboard

`dashboard/index.html` is a lightweight v3 foundation dashboard. It connects to the v3 Worker and displays shared D1 health/source/observation data.

It is intentionally not the final analytics UI yet. The Salesforce-style opportunity dashboard, hiring-phase intelligence and charts will replace/expand this scaffold during the next UI phase.

## 5. Cloudflare Pages

When you want a hosted dashboard URL, connect the same GitHub repository to Cloudflare Pages and use the `dashboard` directory as the site content/root according to the Pages setup flow.

## 6. SEC collector

Before using the SEC collector, add a regular Cloudflare Worker variable named `SEC_USER_AGENT` containing a descriptive application/contact identifier.
