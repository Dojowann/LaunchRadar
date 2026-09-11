# Deployment guide

## 1. GitHub

Create a private repository named `commercial-launch-radar` and upload the contents of this folder.

## 2. Existing v3 Cloudflare Worker

Keep the live Worker and D1 database you already created.

When you are ready to connect the Worker to GitHub:

1. Open the v3 Worker in Cloudflare.
2. Connect the Worker to the GitHub repository.
3. Set the Worker root directory to `worker`.
4. Copy `worker/wrangler.toml.example` to `worker/wrangler.toml`.
5. Replace `PASTE_YOUR_D1_DATABASE_ID_HERE` with the actual D1 database ID and uncomment the D1 binding block.
6. Commit that file.
7. Keep `OPENAI_API_KEY` and `RADAR_ACCESS_TOKEN` as Cloudflare Secrets.

## 3. D1

The canonical schema is:

`worker/migrations/0001_v3_foundation.sql`

Your live D1 data stays in Cloudflare. GitHub stores only migrations.

## 4. Dashboard

`dashboard/index.html` is the current stable v2 UI preserved while the D1-backed v3 dashboard is being built.

Do not point this v2 dashboard at the v3 Worker yet; their APIs are intentionally different during the migration.

When the v3 analytics dashboard is complete, it will replace `dashboard/index.html`.

## 5. Cloudflare Pages later

Once the v3 dashboard is ready, connect the same GitHub repository to Cloudflare Pages and use `dashboard` as the site directory.
