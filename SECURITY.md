# Security

Never commit secret values to GitHub.

Keep these in Cloudflare as **Secrets**:

- `OPENAI_API_KEY`
- `RADAR_ACCESS_TOKEN`

The D1 database contains live application data and remains in Cloudflare; it is not committed to GitHub.

The repository contains the D1 **schema/migration**, not the database contents.

Before making this repository public, review Worker URLs, company data exports, and any local configuration you may have added.
