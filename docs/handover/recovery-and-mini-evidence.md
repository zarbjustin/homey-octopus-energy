# Local price recovery and Mini response evidence — 28 October 2026

## Release execution

Latest support follow-up: separately approved v1.0.44 Test reply sent and verified
after reload on 28 October. Requested 15–20 minutes of normal operation, another
report/support snapshot and live provider-app comparison. Awaiting new evidence;
reporter recovery remains unproven. Private message text/links/report identifiers
stay outside Git. See [cross-machine takeover](cross-machine-takeover.md).

User subsequently authorised merge, new Test build and installation on the local
Pro, preserving device/settings/Flow fingerprints and letting normal scheduled
acquisition recover. No clean install/re-pair, forced refresh, Flow/battery write,
Live/certification action or community reply. PR #66 merged as `1da11fa`, release
PR #67 as `55ec370`. Version run `40699134769` passed 791 tests and release
validation; release `40699514542` created annotated tag/GitHub release v1.0.44 at
`55ec370`. Exact-tag Homey publish run `40699638752`.

Publish succeeded at 13:48 UTC. Build 44 promoted Draft to Test, verified after
reload and independently on the public v1.0.44 listing. Test URL:
<https://homey.app/a/uk.co.zarb.octopusenergy/test/>. App Store Test install on the
selected Pro returned v1.0.44 enabled/not crashed; an independent app read agreed.
No clean install or re-pair. Release-head CI/CodeQL/validation passed.

Post-install full device/settings/Flow fingerprint comparison and price freshness
readback are temporarily blocked by Homey's `Too many requests` response. Do not
claim preservation or price/availability recovery from the successful app-version
read alone. No settings/Flows were edited by this task. Next is low-frequency
read-only recheck after the Homey gate clears; never restart/refresh to force it.

Before-install sanitized baseline: v1.0.43 enabled/not crashed, two registered
unavailable meters, six relevant Standard and six Advanced Flow definitions.
CLI truncates the scoped Advanced Flow JSON at about 64 KiB; a private read-only
helper used sequential source-filtered chunks to hash complete definitions.
Only compact sanitized hashes are saved outside Git. This is tooling readback,
not a Flow edit. Candidate-stage scope below is historical.

## Local Pro track

Read-only v1.0.43 app/device/support reads confirm app enabled/not crashed, two
registered but unavailable meters, prices and core data about 35 hours old, and
current Mini readings with successful capability writes. The Agile screenshot
shows a functioning widget with no cached prices for today, not a missing widget
or deleted meter. Cached integration failures classify as HTTP 403, with attempts
dating to 27 October before the latest sample-selection release. No credentials,
raw settings/device identifiers, errors or payloads retained in Git.

Source inspection confirms BackgroundRecovery treated both 401 and 403 as
permanent authBlocked states. This explains why a one-off denial can prevent
scheduled acquisition from recovering; the original provider 403 cause is not
established. The API read does not expose the actual persisted recovery store,
so exact local lock state is inferred from code and stale attempts, not directly
read back.

Candidate: only 401 stays permanently blocked. A 403 uses the existing 5/10/20/30
minute capped failure delay, respecting longer Retry-After. Legacy persisted 403
locks migrate without resetting cooldown or failure count. No inline retries for
403, extra timers or forced refresh. Availability still needs successful data;
the patch does not manufacture current prices. Health wording no longer calls a
403 an invalid API key. Existing 401 credential safeguards remain.

## Reporter Mini track

The supplied new diagnostic code matches a manual Build 43 report. Logs cover
about 36 minutes, not the full self-reported ten-hour test. Selected timestamps
advance about every 30 minutes while responses and minute polling continue.
Snapshot reports 44 polls, 42 stale samples, two accepted current samples and no
Mini errors or capability-write failures. Successful writes do not establish
visible user recovery; his report says no live readings while the provider app
remains live. The previous selection hardening has not resolved this case.

Discovery currently chooses the first distinct import-device ID found across
properties/meters. That is an ambiguity risk, not proof of wrong-meter selection.
Do not switch accounts/meters or add range queries without evidence.

Candidate diagnostic fields: distinct discoveryCandidates, responseRows,
validTimestampRows (finite/non-future), invalidTimestampRows, futureTimestampRows,
oldestAt/newestAt (valid non-future response range), selectedAt. Counts/timestamps
only: no account/meter IDs, power values, raw errors or payloads. Defensive copies
are cached per client/source and independently allowlisted by protected support
export. Existing bounded poll-loop logs include the source evidence. Reads create
no requests, logs, timer or persisted setting. Discovery order/queries stay the
same; duplicates do not inflate candidate count.

## Acceptance and authority

791 tests pass, including 403 legacy migration/bounds, 401 protection, health
guidance, response evidence/candidate counts, mutation isolation and support
privacy. Lint, full/production audits, normal build and publish validation pass
with the two expected cumulative-direction warnings. Candidate was based on main
`2a135b9` at 1.0.43; subsequently released as v1.0.44 through the workflow above,
without dependency changes.

Review/CI and authorised install/Test delivery are complete. Local acceptance needs
real prices and availability recovery with preserved device/settings/Flow
fingerprints; denial may persist upstream. Reporter acceptance needs the new
response range/candidate count before choosing a meter-selection or bounded
recent-range-query change. Keep stale data stale. No live settings/Flow/battery
writes, re-pairing, credential replacement, publication or community reply here.
