# Reliability execution: S73–S76

Started 4 October 2026 from main `2da305a` / v1.0.36 / Homey Build 36 Live.
Execution branch: `fix/reliability-s73-s76`. S77–S80 are not in scope.

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

## S75–S76

In progress. Installation, GitHub delivery, Homey publication, channel promotion,
48-hour soak and reporter confirmation are distinct gates, not implied by tests.
No physical charging control or public community message is authorised here.
