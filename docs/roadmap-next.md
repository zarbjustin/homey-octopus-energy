# Roadmap After v1.0.36

Last updated: 4 October 2026

## Current Status and Direction

The original engineering backlog is complete through `BL-31`. Configurable price
bands shipped in S71–S72 / v1.0.36. The Homey publishing portal was checked on
4 October: Build 36 is **Live**. S73–S75 are now implemented and tested; S76
delivery and field verification are in progress. See the
[`execution record`](handover/sprints-73-76-execution.md) for actual evidence.

The October community and diagnostic review identified new reliability work.
The next phase is **reliable events, cache-only widgets, and honest dispatch
eligibility**, before further product expansion.

The user authorised S73–S76 execution, local installation, GitHub PR delivery and
Draft/Test publication. S77–S80 remain proposed follow-ons requiring a later priority
decision. Live promotion, community posting, live charging control and device repair
remain separately approved actions.

The task-level specification, new backlog `BL-32`–`BL-39`, acceptance criteria,
evidence, dependencies and release gates are in
[`handover/sprints-73-80-spec.md`](handover/sprints-73-80-spec.md).

## Sprint Sequence

| Phase | Sprint | Outcome | Priority / size | Dependency | Status |
|---|---|---|---|---|---|
| Reliability | S73 — Event lifecycle and announcement deduplication | Saving Sessions and Power Ups do not replay historical events or repeat announcements after polling/restart | P1 / M | None | Implemented, tested |
| Reliability | S74 — Cache-only widgets and bounded recovery | Opening, refreshing or configuring a widget causes zero outbound API requests; background recovery is bounded | P1 / M–L | None; release after S73 preferred | Implemented, tested |
| Reliability | S75 — Dispatch eligibility and graceful degradation | Unsupported accounts are distinguished from unknown/degraded state without false charging/cancellation signals | P2 / M | None; reuse S74 recovery conventions | Implemented, tested |
| Release confidence | S76 — Field validation and support closure | A verified release candidate, migration/restart evidence, and an explicit record of remaining field gaps | P1 / M | S73–S75 | In progress; field gates pending |
| Maintainability | S77 — Release and maintenance hygiene | SHA-pinned workflow upkeep, runbook validation, translation inventory, and an explicit façade-cleanup decision | P2 / S–M | S76; urgent security fixes may pre-empt | Proposed |
| Supportability | S78 — Health, onboarding and trust | Existing settings/widgets explain freshness, eligibility, failure and next steps using cached diagnostics | P2 / M | S74–S76 | Proposed |
| Product growth | S79 — Paired import/export opportunities | A complete-horizon solar/battery recommendation with eligibility and estimate labels | P2 / L | S76, scoped feasibility review | Proposed |
| Product growth | S80 — Run-now-or-wait advice | Plain-language cost/carbon trade-offs using the existing planners | P3 / M | S76; S78 presentation conventions | Proposed |

Sizes are relative complexity, not calendar promises. S73 can ship independently
as an urgent patch; it should not wait for S74, S75 or a real Octopus event. S76
closes the combined reliability phase, not the earlier sprints' individual
validation obligations. Allocate concrete dates only after tooling, test-account
availability and the S73 migration design are checked.

## Release Milestones

| Milestone | Scope | Exit evidence |
|---|---|---|
| R1 — Announcement hotfix | S73 | Large-history regression passes; migration/restart do not replay events; new eligible events still fire |
| R2 — Reliable data surfaces | S74–S75 | All widget routes are cache-only; outage recovery has measured request bounds; eligibility and stale dispatch tests pass |
| R3 — Reliability phase closure | S76 | Local/Test smoke evidence, release/build/channel readback, and reporter follow-up evidence or explicitly accepted field gaps |
| R4 — Easier operation | S77–S78, if prioritised | Maintenance checks and accessible cached health presentation pass |
| R5 — Product differentiation | S79–S80, if prioritised | Recommendation feasibility, complete-data gates and estimate wording verified |

Release versions are assigned through the repository's release workflow when
implementation is ready. The authorised reliability delivery is using that workflow;
no manual Live promotion is implied.

## Operational Verification Still Required

| Item | Current evidence | Remaining check |
|---|---|---|
| Build 36 promotion | Live in Homey Developer Tools on 4 October | Closed for Build 36; verify the channel separately for each future build |
| Local Homey Pro installation | Prior handover records a tooling block; not re-tested in this planning turn | Restore/check official CLI access and install without `--clean` during authorised delivery |
| Price-band widgets | Positive community screenshot and feedback | Both widgets, custom thresholds, non-default palettes, selection persistence and accessibility on a real Homey |
| Meter selection | Community report did not explicitly confirm resolution | Reproduce with multiple meters and stale selections; never silently substitute another meter |
| Energy Optimiser and representative Flows | Engineering delivery recorded | Real-Homey smoke checks, including equal-price slots and stale-data gates |
| IOG overnight pricing | Later fixes recorded; v1.0.21 day-price confirmation exists | Current-build observation spanning the published day/night boundary |
| EV boost start/cancel | Implemented with opt-in off | Separate explicit opt-in and physical-response verification; not required to exercise writes during reliability testing |

## Continuity with the Earlier Roadmap

S77 carries forward the unimplemented maintenance proposal S67. S78 carries
forward S68 (supportability/onboarding). S79 carries forward S69 (solar/battery).
S80 scopes the advice portion of S70. These are renumbered proposals, not claims
that S67–S70 shipped or additional copies of the same work.

The weekly/monthly digest from S70 remains later backlog: it needs separate
opt-in, deduplication, delivery and settled-versus-forecast acceptance criteria.
Do not silently add it to S80.

## Later or Conditional Ideas

| Idea | Start only when |
|---|---|
| Opt-in settled-spend digest | Reliability phase is closed and notification semantics are separately approved |
| Octoplus milestones | Reward semantics are stable and honest wording is possible |
| Multi-account rollup | A privacy-safe aggregation model and separate account freshness are designed |
| Cross-integration cost attribution | A specific Homey recipe and rate-token contract are agreed |
| Additional translations | Community reviewers are available |
| Full device-façade refactor | Characterisation tests and a concrete maintenance benefit justify the risk |

## Non-Negotiable Constraints

- Preserve device identities, capability/Flow/widget IDs and existing user settings.
- No widget-triggered outbound polling, even on empty caches or failures.
- No new Kraken timer; reuse account caches, existing scheduling and measured budgets.
- Failed/partial dispatch reads do not become successful empty plans or cancellation events.
- Missing readings are unknown, not zero; planned charging is not measured charging.
- REST remains authoritative for settlement and billing; forecasts are labelled estimates.
- No silent session enrolment, tariff switching, battery writes or EV control.
- No re-pairing or destructive clean installs as a support workaround.
- No raw diagnostics, credentials or customer/device identifiers in repository artefacts.
