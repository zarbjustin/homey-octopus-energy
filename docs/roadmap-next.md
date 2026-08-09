# Roadmap After v1.0.36

## Current Roadmap Status

The formal engineering backlog is complete through `BL-31`. The core roadmap and optional Phase 4 follow-ons shipped by v1.0.35. Community-requested configurable widget price bands shipped in v1.0.36 as S71–S72.

No item below is committed delivery debt. Start a new phase only after explicit prioritisation.

## Operational Closure

| Priority | Item | Status | Completion evidence |
|---|---|---|---|
| P0 | Promote Homey Build 36 to Test/Live | Manual | Homey Developer Tools shows the intended channel |
| P1 | Smoke-test both configurable price-band widgets | Pending human verification | Custom thresholds and palette persist; bars, legend, and current-slot marker render on a real Homey |
| P1 | Smoke-test Energy Optimiser widget and new Flow cards | Pending human verification | Widget loads; trigger, condition, and export trigger behave on a real Homey |
| P1 | Live-verify EV boost start and cancel | Pending opt-in verification | Device reaches `BOOSTING`, then exits after cancel |

## Recommended Maintenance Sprint S67

### Goal

Reduce handover and release risk without adding product behavior.

| Item | Value | Risk |
|---|---|---|
| Update pinned GitHub Actions to upstream Node 24-compatible revisions | Removes runner deprecation warnings | Low; preserve immutable SHA pins |
| Decide whether to close or schedule the deferred device-façade cleanup | Removes ambiguous blocked work | Low if documented; medium if implemented |
| Complete Dutch Flow-card translations | Finishes visible internationalisation | Low; large mechanical review surface |
| Verify release runbooks against the automated workflow | Prevents future version or audit drift | Low |

The documentation consolidation and new AI instructions were completed in the v1.0.35 handover update.

## Delivered Community Sprints S71–S72

| Sprint | Delivered |
|---|---|
| S71 | One shared, deterministic five-band classifier for Agile Prices and Price Timeline; custom green/yellow/orange upper thresholds; negative prices always separated; invalid ordering safely falls back to 10p/20p/30p; no new polling |
| S72 | Standard, colour-blind-friendly, and high-contrast palettes; textual range legend and exact per-bar accessible labels; Agile classic cheapest-slot mode preserved; tests, changelog, and v1.0.36 release metadata |

The existing widgets were enhanced instead of adding another overlapping dashboard widget. Existing Agile cheapest-slot ranking remains available and is visually independent from the selected price band.

## Optional Product Phase S68: Supportability and Onboarding

Recommended as the next low-risk user-facing phase.

| Scope | Catalogue source | Outcome |
|---|---|---|
| Health and connection panel | I14 | Per-source freshness, budget headroom, last safe error, and repair guidance |
| Guided onboarding and Flow cookbook | I16 | Faster API-key setup and first useful automation |
| Provenance trust legend | I19 | Consistent explanation of Current, Stale, Estimated, Planned, and Settled |

Constraints:

- Use existing cached freshness and diagnostics.
- Add no new polling.
- Keep identifiers redacted.

## Optional Product Phase S69: Solar and Battery Optimisation

Highest remaining functional differentiator.

| Scope | Catalogue source | Outcome |
|---|---|---|
| Paired import/export planner | I15 | Coordinated charge and discharge recommendations |
| Flux-aware eligibility | I15 | “Not evaluated” when export data or eligibility is incomplete |
| Battery opportunity widget/Flow | I15 | Forecast opportunity, never guaranteed earnings |

Constraints:

- Recommendations only.
- Use published dated import and export rows.
- Do not hard-code tariff schedules.
- Fail closed on incomplete import or export horizons.

## Optional Product Phase S70: Advice and Retention

| Scope | Catalogue source | Outcome |
|---|---|---|
| Run-now-or-wait advisor | I5 | Plain-language decision with an estimated trade-off |
| Weekly or monthly digest | I8 | Settled spend, budget progress, and forecast opportunities |

Constraints:

- Separate settled history from forecast advice.
- Do not claim realised savings without settled evidence.
- Notifications must be opt-in and deduplicated.

## Later or Conditional Ideas

| Idea | Catalogue source | Start only when |
|---|---|---|
| Octoplus progress and milestones | I11 | Reward semantics are stable and can be phrased honestly |
| Multi-account rollup | I12 | A privacy-safe account aggregation model is designed |
| Cross-integration cost attribution | I13 | A clear Homey Flow recipe and rate-token contract are agreed |
| Broader translations | I17 | Community reviewers are available |

## Explicit Non-Goals

- Estimated live gas as a shippable feature.
- Automatic tariff switching.
- Silent Saving Session or Power Up enrolment.
- Undocumented dispatch writes beyond verified, consent-gated operations.
- Sub-minute live polling.
- Presenting forecasts, plans, or telemetry as settlement.
- Adding fake capabilities to silence accepted Homey validation warnings.
