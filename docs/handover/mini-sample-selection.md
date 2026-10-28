# Mini sample selection — 28 October 2026

## Evidence and limits

A v1.0.42 retest supplied a matching manual Homey report and support snapshot.
Discovery, subscription and 60-second polling were active. Across 18 polls, 16
samples were stale and two were accepted as current; no Mini provider errors,
budget/cooldown skips or capability-write failures were recorded. Original sample
time advanced once, then lagged. A separate dispatch-device error is not Mini
failure evidence. Private report IDs, messages, raw logs and payloads stay out of Git.

This establishes returned/selected stale telemetry, not which raw rows Octopus
sent. The snapshot contains only selected samples. No real-account request was
made for this investigation and no provider outage is inferred.

## Findings and correction

The query already requests latest telemetry without start/end/grouping, matching
the [official query contract](https://docs.octopus.energy/graphql/reference/queries/#smartmetertelemetry).
The client already compares readAt, so ordinary ascending/descending order was
not a bug. No local telemetry-response cache was found in the query path.

Synthetic tests fail against the old selector in three cases: invalid first date
poisons all subsequent comparisons with NaN; null rows throw; a future-dated row
masks an otherwise usable current row. The correction ignores malformed rows and
ranks finite, non-future measurement dates independently of input order. Equal
instants retain the previous last-row-wins behaviour. Missing/invalid/future-only
data still fails existing source validation; all-old samples stay stale. The newest
dated row's invalid demand remains invalid, not replaced by older valid power.
Numeric zero/negative power and singleton response support remain intact.

No query variables, provider cadence, retries, discovery, freshness window, Flow
contracts, identifiers, settings or release version changed. This is defensive
selection correction, **not confirmed reporter root cause or recovery**.

## Validation and next gates

17 new sample-selection regressions; 787 total tests pass. Lint, full/production
audits (zero vulnerabilities), normal Homey build and publish validation pass;
only the two expected direction-specific cumulative warnings. Synthetic requests
confirm one telemetry query and unchanged deviceId-only variables per invocation.

Candidate is source-only at version 1.0.42. Review/CI and separately authorised
Test delivery remain next. If symptoms persist after a future Test release, obtain
bounded allowlisted row-count/timestamp-selection evidence rather than raw account
payloads, extra polling, re-pairing or repeatedly restarting. Do not mark genuinely
old data current to hide the symptom. No install, channel change or reply here.
