# Scoring v3 Alpha

This is the initial deterministic rubric. It is deliberately labeled **alpha** until it is backtested against historical launch / hiring cases.

## Opportunity Score — 100 points

### 1. Regulatory / launch proximity — 20

Measures how close the asset is to a U.S. commercial event.

Illustrative progression:
- pivotal / Phase III: 5–8
- submission planned / underway: 8–11
- NDA/BLA submitted: 11–13
- application accepted: 13–15
- PDUFA > 270 days: 15
- PDUFA 181–270 days: 16
- PDUFA 91–180 days: 18
- PDUFA 0–90 days: 20
- recent approval with active launch build: 18–20

A regulatory setback can cap the total opportunity score until there is evidence of recovery.

### 2. U.S. commercial ownership — 20

- explicit internal U.S. rights + internal launch: 20
- explicit internal U.S. rights, launch model not fully established: 17
- co-commercialization: 10–14
- ownership unknown: 7
- U.S. rights controlled by another company: 0–3

### 3. Commercial organization build — 20

This is stage-based, not merely additive:

- no visible build: 0–3
- CCO / Head Commercial only: 5–8
- Market Access / Commercial Ops build: 8–12
- VP / Head of Sales: 12–15
- regional first-line sales leaders: 16–20

### 4. Hiring evidence and velocity — 25

This is the largest component because actual hiring is closest to the recruiting need.

Inputs:
- active commercial job count
- new commercial jobs in 7 / 30 / 90 days
- first appearance of sales leadership
- first appearance of territory roles
- number of unique regions / territories
- hiring acceleration

Illustrative ranges:
- weak / isolated signal: 1–6
- initial leadership build: 7–12
- multiple regions or first field jobs: 13–18
- broad field rollout / strong velocity: 19–25

### 5. Recruiting timing / whitespace — 10

Measures whether the recruiting firm is early enough to influence the build.

Suggested phase mapping:
- Phase 0: 2
- Phase 1: 6
- Phase 2: 9
- Phase 3: 10
- Phase 4: 9
- Phase 5: 5
- Phase 6: 1

### 6. Execution capacity — 5

Signals:
- financing explicitly supports commercialization
- cash runway appears sufficient for launch
- management guides to commercial investment
- manufacturing / launch readiness

Unknown should not be treated as failure; it simply receives limited points.

## Hard caps / penalties

Until backtesting refines these rules:

- U.S. rights controlled by a partner: cap at 35 unless the target company still has a material U.S. commercial hiring obligation.
- Fully outsourced CSO model: cap at 50 unless meaningful internal field leadership is still being hired.
- unresolved CRL / failed pivotal program: cap at 30.
- field force already established and no expansion catalyst: cap at 40.

## Evidence Confidence — separate 0–100 score

Evidence Confidence is not included in the Opportunity Score.

Suggested components:

- source authority: 35
- corroboration: 20
- source coverage: 25
- freshness: 10
- consistency / conflict resolution: 10

This allows:

```text
Opportunity Score: 91
Evidence Confidence: 48
Action: NEEDS VERIFICATION
```

rather than falsely presenting an exciting but poorly sourced result as Contact Now.

## Source Coverage

Coverage is derived from source-check records, not from the number of links returned by an AI answer.

A target can therefore distinguish:

- source not checked
- checked and nothing found
- checked and evidence found
- check failed
