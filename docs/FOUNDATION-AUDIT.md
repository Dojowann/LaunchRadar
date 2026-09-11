# Foundation Audit

Automated static checks performed when this package was generated:

- No literal `sk-...` OpenAI key found.
- No literal Scan Market password stored in source.
- D1 binding is named `DB`.
- `RADAR_ACCESS_TOKEN` is read only from Cloudflare environment.
- SEC collector requires an explicit `SEC_USER_AGENT`.
- Source observations retain source, external ID, timestamps, URL, tier, payload, and hash.
- Source checks are recorded separately from positive observations.
- ClinicalTrials.gov collector is implemented.
- SEC EDGAR submissions collector is implemented.
- openFDA / Drugs@FDA collector is implemented.
- Greenhouse collector is implemented.
- Lever collector is implemented.
- Ashby collector is implemented.
- FDA Tracker is explicitly registered as Tier B discovery / research source.
- Opportunity score and Evidence Confidence are specified as separate concepts.
- Unknown vs false is explicitly distinguished in the intelligence specification.

Not yet implemented in this foundation:
- company / asset identity resolution
- direct FDA Advisory Committee parser
- FDA Tracker research pass
- company IR deep research
- evidence extraction / conflict resolution
- final scoring code
- D1-backed production dashboard
- server-side multi-step scan orchestration
- charts
- browser QA
