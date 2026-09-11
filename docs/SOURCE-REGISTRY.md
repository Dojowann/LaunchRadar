# Source Registry

The registry separates **discovery sources** from **verification sources**.

A source can be useful without being authoritative. FDA Tracker, for example, is a useful regulatory-catalyst discovery source; regulatory facts should be corroborated with FDA and/or company primary evidence when possible.

| Source | Tier | Access | Primary role |
|---|---|---|---|
| FDA / official regulatory pages | A | web | regulatory verification |
| FDA Advisory Committee Calendar | A | web | AdCom verification |
| openFDA / Drugs@FDA | A | API | approval / application verification |
| ClinicalTrials.gov | A | API | trial status, sponsor, timing |
| SEC EDGAR | A | API + filings | strategy, financing, rights, launch disclosures |
| Company investor relations | A | web | management statements, launch guidance |
| Company careers / ATS | A | API/web | direct hiring evidence |
| Greenhouse public job board | A | API | direct hiring evidence |
| Lever public postings | A | API | direct hiring evidence |
| Ashby public postings | A | API | direct hiring evidence |
| FDA Tracker | B | web research | PDUFA / AdCom discovery |
| Reputable life-sciences trade press | B | web research | discovery and context |
| Other public web | C | web research | leads requiring corroboration |

## Coverage categories

A full investigation should attempt to cover:

1. Regulatory status
2. Clinical development
3. U.S. commercialization rights
4. Company launch guidance
5. Commercial leadership
6. Market Access / commercial infrastructure
7. Current commercial jobs
8. Outsourcing / CSO relationships
9. Financing / execution capacity
10. Recent changes / contradictions

A source check with no result is still important. v3 records source checks separately from positive observations so that "not investigated" and "investigated, no evidence found" are distinguishable.

## FDA Tracker policy

FDA Tracker is explicitly included in the registry as a Tier B discovery source.

Use it to identify:
- PDUFA dates
- FDA advisory committee events
- near-term FDA catalysts

Then seek corroboration from:
- FDA
- Company IR
- SEC filings

Do not treat a third-party calendar as the sole basis for a high-confidence regulatory fact when primary corroboration is reasonably available.
