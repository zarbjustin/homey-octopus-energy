# Roadmap After v1.0.38 Test

Last updated: 5 October 2026

## Current Status and Direction

App-wide bug bash: confirmed bug families fixed plus deadline
formatter optimisation; 672 tests, delivered as v1.0.38 / Build 38 Test. The
[review](blueprint/08-bug-bash-report.md) separates fixes from remaining work.
BBA-10 legacy reporting coverage is fixed and regression-tested. Local Pro
upgrade preserves device/settings/Flow fingerprints. Build 38 Test and Build 36
Live verified on 5 October; no certification/Live submission.
Reporter confirmation remains unavailable; malformed
IOG handling needs an affected-account retest. S78 source-status/Flow guidance
and S77 API contract fixtures remain priorities, not completed roadmap work.

5 October: S81–S83 software delivered for testing, including exact local deadlines,
all-slot selection, bounded duration/fallback, replanning and persisted per-run
lifecycle. Fourteen additive cards; cache-only boundary timers add no provider
requests. Standard/Advanced Flow recipes and implementation evidence are in
[`handover/sprints-81-83-charging-flows.md`](handover/sprints-81-83-charging-flows.md).
Source, local Pro and Test delivery are verified. Real UI/requester/physical
acceptance remains open. No live Flow edits or battery writes.

The user authorised completion of this charging software. S77–S80 remain separate
future proposals; broader product growth is not silently included.

S73–S75 were delivered as v1.0.37 and remain included in v1.0.38. Build 36
remains Live (channel readback 5 October). S76 monitoring ended early at user request with stable
sampled observations and coverage gaps, not a verified 48-hour pass. Reporter/UI/
IOG-night/unsupported-tariff gates remain open. No automatic Live clearance.

The task-level specification, new backlog `BL-32`–`BL-39`, acceptance criteria,
evidence, dependencies and release gates are in
[`handover/sprints-73-80-spec.md`](handover/sprints-73-80-spec.md).

## Sprint Sequence

| Phase | Sprint | Outcome | Priority / size | Dependency | Status |
|---|---|---|---|---|---|
| Reliability | S73 — Event lifecycle and announcement deduplication | Saving Sessions and Power Ups do not replay historical events or repeat announcements after polling/restart | P1 / M | None | Delivered for testing in v1.0.37 |
| Reliability | S74 — Cache-only widgets and bounded recovery | Opening, refreshing or configuring a widget causes zero outbound API requests; background recovery is bounded | P1 / M–L | None; release after S73 preferred | Delivered for testing in v1.0.37 |
| Reliability | S75 — Dispatch eligibility and graceful degradation | Unsupported accounts are distinguished from unknown/degraded state without false charging/cancellation signals | P2 / M | None; reuse S74 recovery conventions | Delivered for testing in v1.0.37 |
| Release confidence | S76 — Field validation and support closure | A verified release candidate, migration/restart evidence, and an explicit record of remaining field gaps | P1 / M | S73–S75 | Monitoring ended early; field gates pending |
| Maintainability | S77 — Release and maintenance hygiene | SHA-pinned workflow upkeep, runbook validation, translation inventory, and an explicit façade-cleanup decision | P2 / S–M | S76; urgent security fixes may pre-empt | Proposed |
| Supportability | S78 — Health, onboarding and trust | Existing settings/widgets explain freshness, eligibility, failure and next steps using cached diagnostics | P2 / M | S74–S76 | Proposed |
| Product growth | S79 — Paired import/export opportunities | A complete-horizon solar/battery recommendation with eligibility and estimate labels | P2 / L | S76, scoped feasibility review | Proposed |
| Product growth | S80 — Run-now-or-wait advice | Plain-language cost/carbon trade-offs using the existing planners | P3 / M | S76; S78 presentation conventions | Proposed |
| Charging Flows | S81 — Price-band and horizon availability conditions | Configurable price-band checks and explicit-horizon threshold availability, with unknown separate from none | P2 / M | S76; S78 naming conventions | Delivered in v1.0.38 Test; field pending |
| Charging Flows | S82 — Bounded cheapest-slot fallback | Cheapest required duration, preferred price cap and explicitly enabled fallback cap | P2 / M–L | S81; existing target-rate planner | Delivered in v1.0.38 Test; field pending |
| Charging Flows | S83 — Slot lifecycle and practical Flow recipes | Reliable entry/exit for separated selected slots, accessible examples and real-Homey validation | P2 / M | S81–S82 | Delivered in v1.0.38 Test; field pending |

Charging code was prioritised by the user while retaining S76 field gaps.
Next requires field acceptance; S77/S78 maintenance/support
remain ahead of optional S79/S80 growth. Urgent reliability
or security fixes pre-empt feature work. The charging-Flow scope and acceptance
gates are in [`handover/sprints-81-83-charging-flows.md`](handover/sprints-81-83-charging-flows.md).

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
| Local Homey Pro installation | v1.0.37 installed/read back; identities, settings and Flow fingerprints unchanged | Installation closed; soak and affected real-UI/Flow behaviour remain separate gates |
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

## Charging-Flow Feature Requests

Roadmap capture approved on 4 October 2026 following private user feedback. This
public record deliberately contains generic requirements only: no private-message
quotes, sender identity, screenshots or private-thread links. Charging software is
delivered in v1.0.38 Test; field acceptance and Live promotion remain separate.

| ID | Sprint | Requirement | Acceptance focus |
|---|---|---|---|
| BL-40 | S81 | Numeric price bands and “no slots below threshold before deadline” | Explicit meter/horizon, strict threshold semantics, complete fresh coverage; unknown never becomes none |
| BL-41 | S82 | Cheapest separated slots with optional higher-price fallback | Required duration and hard maximum, opt-in fallback, no silent cap relaxation |
| BL-42 | S83 | Selected-slot start/end and understandable Standard/Advanced Flow recipes | Deduplicated slot edges, restart/replan safety, gaps stop charging eligibility; existing IDs preserved |

S78 includes clearer explanations of existing price-threshold, cheapest-hours and
target-rate cards. Reuse the existing widgets and planners; a new widget is not
part of this roadmap. Price-band “green” is a price range, not a carbon claim.

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
