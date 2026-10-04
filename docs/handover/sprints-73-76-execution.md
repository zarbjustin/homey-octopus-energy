# Reliability execution: S73–S76

Started 4 October 2026 from main `2da305a` / v1.0.36 / Homey Build 36 Live.
Execution branch: `fix/reliability-s73-s76`, merged into main via PR #42.
Released as v1.0.37 / Build 37 Test. S77–S80 are not in scope.

## S73 — implemented and locally validated

- Time-aware session ledger replaces the 50-ID trim; existing v2 setting and
  opaque account keys preserved. Legacy IDs enrich without reannouncing.
- Historical events emit nothing. First-discovered active events seed silently;
  ended means an observed active event ended. Joined lifecycle gates retained.
- Upcoming announcements and per-15-minute lead buckets survive restart.
- Persistence precedes Flow attempts: at-most-once attempt, not guaranteed
  delivery. A crash after persistence can miss a notification; failed attempts
  are not retried. Safety overflow suppresses untrackable events, never evicts
  actionable records. Expired records prune after 24 hours.
- Identifier-free lifecycle counts exposed in settings. Errors redact credentials
  and account identifiers. No new requests or cadence.
- Full gate: official Homey CLI 4.3.1 build and publish validation, 591 tests,
  lint, production audit (zero vulnerabilities), diff check. Only the two existing
  cumulative-direction warnings remain. Runtime Node 22.23.2.

## S74 — implemented and locally validated

- All seven widget endpoints read cached state only. Agile's compatibility getter
  no longer refreshes; Summary uses explicit cache-only daily/effective views.
- Existing background refresh populates settled history with its 3-hour TTL and
  effective-rate snapshots only with the existing opt-in. Missing history is
  pending; snapshots expose age. No new timer or cadence. History budget is at
  most one REST acquisition per physical meter per three hours (pagination may
  add HTTP pages), independent of widget/tab count; IOG uses shared tariff cache.
- Persistent feature-scoped cooldowns: 5/10/20/30 minutes, long Retry-After honoured,
  typed auth errors block until credential change; shared Kraken gate unchanged.
- Tests cover 100 concurrent reads plus minute-spaced reads for all seven APIs
  across cold/current/stale/failure paths, source getters, cooldown/restart/auth,
  single flight and credential reset. Explicit multi-meter selection passed;
  the reporter's custom option issue remains unconfirmed, not claimed fixed.
- Full gate: build, 604 tests, lint, zero production audit findings, publish
  validation and diff check; only the two existing direction warnings.

## S75 — implemented and locally validated

- Documented the evidence contract before query changes. Eligibility is separate
  from freshness: eligible/ineligible/unknown/degraded plus sanitised reason/time.
- Preserve device-scoped EV/charge-point and verified account-scoped legacy support.
  First empty legacy feed is unknown, not proof of enrollment or ineligibility.
  Unsupported known device categories/unknown discovery use a 30-minute negative
  cache; fresh discovery and credential change invalidate it, never the budget.
- Null/malformed lists and any candidate/required completed-read failure preserve
  stale plans without fabricated cancellation/end/completion. Nullable status
  resolver tolerance is restricted to verified status failures, not arbitrary errors.
- Typed HTTP/GraphQL error handling distinguishes auth/throttled/transient/schema;
  no dispatch use of broad unsupported-message regex. No verified provider-specific
  not-enrolled error code was available: those errors deliberately remain degraded.
- Conditions fail closed immediately on degraded eligibility, and on expired
  freshness. Retained intent remains visible as stale; boost opt-in/control unchanged.
- Full gate: build, 612 tests, lint, zero production audit findings, publish
  validation and diff check, with only the expected direction warnings.

## S76

Integration review added regressions/fences for credential rotation and malformed
legacy state. Retired timed records prune after 24 hours; bounded identity/lifecycle
tombstones remain to prevent reannouncement if a retired provider ID is rescheduled.
Power Up lifecycle remains ungated by Saving Session enrollment.

Final local integration gate: build, **615 passing tests**, lint, zero production
audit findings, publish validation, and diff check. Only the existing two
cumulative-direction warnings. This is code-tested, not field-confirmed.

Pre-install readback: 4 October 2026 19:54 UTC, Pro software 13.5.1, app v1.0.36
enabled/not crashed, two available Octopus devices, six related standard Flows and
five Advanced Flows. Identity/settings/Flow digests captured locally for comparison;
no identifiers, settings or raw payloads committed. `scripts/reliability-smoke.js`
is a read-only repeatable check, excluded from app packaging.

## Verified delivery — 4 October 2026

- PR [#42](https://github.com/zarbjustin/homey-octopus-energy/pull/42): merged
  `c6bec3d`, all CI/Homey validation/CodeQL checks green.
- Version workflow `37230678343` passed and created PR
  [#43](https://github.com/zarbjustin/homey-octopus-energy/pull/43), merged
  `47e32973573e4b7b7f67974b510eb9d266e5b7bb`. Version/changelog-only diff reviewed.
- Full local v1.0.37 gate repeated: 615 tests, lint, zero production audit
  vulnerabilities, Homey build/publish validation, diff check. Expected warnings only.
- GitHub annotated tag and release
  [v1.0.37](https://github.com/zarbjustin/homey-octopus-energy/releases/tag/v1.0.37)
  verified; tag resolves to release merge `47e3297`.
- Normal installation on Justin's Homey Pro with official CLI 4.5.2 succeeded.
  Isolated CLI tooling uses Node 24.21.0; app runtime/project Node 22 unchanged.
  The initial CLI 4.3.1 skip-build package was 131 MB and failed with a missing
  generated widget asset, leaving the app stopped. A fresh normal build/install
  produced a 3.43 MB package and restored running state. No clean install, state
  purge or re-pair. Do not install a test-mutated build directory with skip-build.
- Readback 20:11 UTC: v1.0.37 running/enabled/not crashed; two Octopus devices
  available. Device identities/capabilities, settings, six standard Flows and five
  Advanced Flow definitions have identical pre/post digests. All seven widgets
  registered and meter updates observed. No physical charging response inferred.
- First successful session poll 20:10 UTC: 71 valid expired Saving Sessions,
  zero new events and **zero trigger attempts**; empty Power Up feed. This is
  field evidence for historical suppression, not proof of a future event/reporter fix.
- Dispatch diagnostics: one degraded account, no eligible accounts. Installation
  success does not mean provider dispatch recovery or enrollment was established.
- Publish workflow `37230914547` passed and uploaded Build 37. Developer portal
  verified **Test**, with [test URL](https://homey.app/a/uk.co.zarb.octopusenergy/test/).
  Build 36 remains Live; certification/Live promotion not submitted.

Installation, GitHub delivery, Homey publication, channel promotion, 48-hour soak
and reporter confirmation are distinct gates. The first four are now verified;
the soak and reporter confirmation are not. The user approved install, PR delivery
and Draft/Test publication. No physical charging control or public community
message is authorised here.

The user subsequently authorised hourly **read-only** soak checks in this chat.
Heartbeat `octopus-s76-read-only-soak` is active until 6 October 2026 20:30 UTC;
the first check after 20:10 UTC reports coverage and disables it. Mac/Codex must
remain running. Only cached, scoped Homey data is read; redacted observations stay
in local artifacts outside Git. Unchanged state stays quiet. No restart, refresh,
Flow/setting edit, charging write, publishing, repair or Git write is authorised
by the monitor. Hourly sampling cannot prove exact request counts or every event
edge. Scheduling is not soak completion; gaps must be reported.

Field matrix pending: real dashboard interaction/palette/selection persistence,
unavailable tariff/account types, live session announcement recurrence, IOG night
boundary, 48-hour recovery/request-count soak and reporter follow-up. No synthetic
session will be injected into the production Pro or its Flows. Automated fixtures
cover these failure/boundary contracts; fixtures are not physical field proof.

Rollback: prefer a forward fix on the same app/device IDs, preserving v2 ledgers
and settings. Do not clean-install, purge state, replace meters or automatically
revert to v1.0.36: that version's history replay defect remains. Returning to Live
v1.0.36 requires an explicit decision about that risk, not an assumed safe rollback.
