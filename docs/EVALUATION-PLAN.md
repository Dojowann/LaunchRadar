# Evaluation Plan

## Goal

We should not trust v3 merely because the answers look plausible.

Every major intelligence-agent revision should be evaluated against a manually curated gold-standard set.

## Gold-standard case types

Include a balanced mix of:

- successful internally commercialized U.S. launches
- companies currently building U.S. commercial teams
- partnered U.S. launches
- CSO / outsourced launches
- Complete Response Letters and regulatory delays
- pivotal failures
- companies that appeared launch-ready but did not build internally
- indication expansions
- franchise expansions
- post-launch established teams
- negative controls with little/no commercial hiring thesis

## Time-frozen evaluation

Historical cases should have an `as_of_date`.

The system may use only information that was public on or before that date.

This tests the real question:

> Six months before the hiring wave, would Radar have identified the company and correctly understood the commercial build?

## Fact-level metrics

Score:

- company identity accuracy
- asset identity accuracy
- regulatory-stage accuracy
- PDUFA accuracy
- U.S.-rights accuracy
- launch-model accuracy
- commercial-leadership detection
- job-posting detection
- CSO / outsourcing detection
- hiring-phase accuracy
- evidence URL validity
- source-tier correctness
- source coverage
- stale-signal rate
- duplicate rate
- conflict-resolution accuracy

## Opportunity-level metrics

Measure:

- precision of CONTACT NOW
- recall of true high-volume commercial builds
- false-positive rate
- false-negative rate
- median lead time before broad field hiring
- phase accuracy
- action accuracy
- score calibration

## Stability test

Run the same case repeatedly with an unchanged evidence set.

The numerical score should remain identical because scoring is deterministic.

AI-extracted facts should also be compared for variance. Material fact instability is a failure even when the average score appears reasonable.

## Acceptance targets before production promotion

Initial targets:

- >= 95% valid evidence URLs
- >= 95% U.S.-rights accuracy on gold cases
- >= 95% regulatory-stage accuracy
- >= 90% hiring-phase accuracy
- <= 5% duplicate-company rate
- <= 10% false-positive rate for CONTACT NOW
- score variance = 0 when the input fact set is unchanged

These are product targets, not claims about current performance.

## Gold-standard workflow

1. Add a case to `data/gold-standard-template.csv`.
2. Record the permitted information cutoff date.
3. Manually establish expected facts and links.
4. Run collectors / investigator using only information available by the cutoff.
5. Compare extracted facts to expected facts.
6. Compute deterministic phase and score.
7. Record errors by category.
8. Adjust extraction rules or scoring only after reviewing multiple cases.
