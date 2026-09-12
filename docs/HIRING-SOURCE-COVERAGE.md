# Hiring Source Coverage Audit

## Goal

Commercial Launch Radar should never equate `0 jobs` with `0 hiring` unless the company has been checked across credible official hiring sources. Search engines and aggregators may be used to discover official sources, but the stored job evidence should come from first-party or first-party-published career systems whenever possible.

## Tier A hiring sources

1. Company-owned official careers/jobs pages.
2. Workday public career sites and CXS job feeds.
3. Greenhouse public job boards.
4. Lever public postings.
5. Ashby public job boards.
6. SmartRecruiters public Posting API.
7. `JobPosting` structured data embedded on verified official company careers/job pages.

LinkedIn, Indeed, ZipRecruiter, recruiter mirrors, scraped job boards, and generic search results are discovery/corroboration sources only. They do not become primary job evidence while an official source is available.

## Coverage behavior

The hiring scan uses discovery version `coverage-v2-smartrecruiters-jsonld` and is instructed to return every verified supported official hiring source for each company, rather than stopping after the first ATS match.

For every company selected in a hiring scan, `source_checks` records a `company_careers` coverage check with the current discovery version. Verified provider targets are stored in `source_targets`. Each provider collection receives its own source check, so the database distinguishes:

- not checked,
- checked with no supported official source,
- verified official source but zero current postings,
- verified source with current postings,
- provider collection error.

`GET /api/hiring-coverage` exposes the current per-company coverage state, including verified sources, target count, last discovery time, active U.S. commercial jobs, and a coverage-status label.

## U.S. recruiting precision

The recruiting product is U.S.-focused. Job postings can be stored as raw observations regardless of geography, but only roles with positive U.S. location evidence are classified as recruiting-relevant commercial jobs. Explicit foreign locations are excluded from hiring events and opportunity scoring.

This prevents global postings such as non-U.S. key account manager or market-access roles from inflating U.S. field-force signals.

## Asset attribution

Company-level hiring is not automatically treated as evidence that every asset is building a field force. Scoring version `v3-alpha-2-asset-attribution` gives full company-level hiring credit only when the asset also has an asset-specific launch/regulatory catalyst. Asset-specific hiring events still receive direct credit. Phase III evidence can support early launch-planning logic, but unrelated company field hiring does not by itself push every pipeline asset into Field Force Build or CONTACT NOW.

## Duplicate control

Structured ATS feeds are preferred for inventory. The official-careers JSON-LD collector is a vendor-neutral fallback and corroboration layer. When its title/location matches an already active structured ATS job for the same company, the duplicate is suppressed from job inventory and event scoring.

## Current supported hiring collectors

- Greenhouse
- Lever
- Ashby
- Workday
- SmartRecruiters
- Official careers `JobPosting` JSON-LD fallback

## Next source additions

Add vendor-specific deterministic adapters only when they materially improve coverage beyond the official-careers fallback. Priority candidates are iCIMS, Phenom, Eightfold, SuccessFactors, and Oracle/Taleo. Their public interfaces vary by customer, so each should be validated against real company career sites before being treated as a Tier A deterministic source.

## Acceptance criteria

A production hiring scan should report, per company:

- discovery version,
- verified official source count,
- verified provider names,
- provider check status,
- records found,
- active U.S. commercial jobs,
- last successful check time.

The backend now exposes this coverage state directly. The remaining UI task is to render it as a dashboard hiring-source coverage matrix so `0 jobs` is never shown without context.
