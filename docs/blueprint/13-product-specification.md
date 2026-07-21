# 13 — Product Specification

> Blueprint deliverable · Workstream: **Product & UX Strategy** · v1.0.20 · Docs-only, implementation-agnostic.
> This spec defines **what** the product should be and **why**; the architect owns **how** (API/system design). It reconciles with
> `ROADMAP.md` and the sprint specs — divergences are flagged. Requirement IDs use PR-* (product requirement) to avoid clashing with the
> engineering spec's REQ-*/SEC-* (which remain authoritative and are referenced, not restated).

---

## 1. Executive summary

Octopus Energy for Homey turns a UK Octopus account into trustworthy, automatable Homey devices. It already leads peers on **provenance
discipline** and **native Homey UX** but trails the Home Assistant benchmark on **automation primitives** (rolling target-rate),
**dispatch control**, and **settled insight**. This spec sets the product bar for the next arc: **"honest and actionable"** — close the
most-felt automation and reporting gaps using REST-derived, budget-safe primitives, while preserving the trust posture that is the app's
moat. It is implementation-agnostic and consistent with the shared ~100–125 req/hr Kraken budget and the F1 provenance convention.

## 2. Vision

> *"The most trustworthy way to run your home around your Octopus tariff — honest about settled vs estimated, gentle on your API
> allowance, and powerful enough to automate every cheap and green half-hour."*

## 3. Goals & non-goals

**Goals (G):**
- **G1** Make the cheapest/greenest half-hours *automatable in one card* (no hand-rolled logic).
- **G2** Give users an honest, glanceable view of *settled* cost/usage and *projected* spend vs budget.
- **G3** Preserve and make visible the provenance/estimate discipline as a product feature.
- **G4** Stay within the shared Kraken budget under realistic multi-device/multi-account load.
- **G5** Reach parity-of-*capability* (not implementation) with HA on target-rate + event awareness; a deliberate, consent-gated path toward dispatch control.

**Non-goals (NG):** circuit/appliance-level monitoring (integrate, don't compete); silent auto-join/auto-charge/auto-switch; presenting
telemetry/estimates as settled; sub-60s live polling; building on Greener Nights (deprecating 31 Jul 2026); shippable estimated live-gas.
(All consistent with `sprints-50-58-spec.md` "Explicitly rejected".)

## 4. Personas (summary — full detail in `02-product-assessment.md §3`)

P1 New/mainstream · P2 Power-user/automator · P3 EV/IOG owner · P4 Solar/export owner · P5 Installer/prosumer · P6 Developer/contributor.

## 5. Use cases (representative)

| UC | Persona | Narrative | Primary requirements |
|---|---|---|---|
| UC1 | P1 | Pair account, see tariff/balance/today's cost honestly | PR-FUNC-1, PR-NFR-2, PR-UX-1 |
| UC2 | P2 | "Run the dishwasher in the cheapest 3h before 07:00" in one card | PR-FUNC-2 |
| UC3 | P3 | Know when a smart dispatch runs / starts soon; react | PR-FUNC-3 |
| UC4 | P3 | (Later, consent-gated) set ready-by / bump charge from Homey | PR-FUNC-4 |
| UC5 | P1/P2 | Alert when projected month is over budget | PR-FUNC-5 |
| UC6 | P4 | Discharge battery / shift load at best export window | PR-FUNC-6 |
| UC7 | P2 | Automate around cleanest carbon window | PR-FUNC-7 |
| UC8 | P1 | Compare tariffs honestly (estimate, eligibility, never "best") | PR-FUNC-8 |
| UC9 | P1/P2 | See settled cost/usage history (day/week/month) | PR-FUNC-9 |
| UC10 | P5 | Recover a rotated API key without re-pairing | PR-FUNC-10 |

## 6. Functional requirements

- **PR-FUNC-1 — Account onboarding & meter modelling.** Pair via API key + account number; auto-discover electricity/gas/export meters
  (existing, `OctopusMeterDriver.ts`). *Enhancement:* first-run guidance to locate the API key and a capability primer.
- **PR-FUNC-2 — Rolling target-rate primitive (NEW, top priority).** Provide a trigger (`window started/ending soon`) and condition
  (`in target-rate window`) for the auto-selected cheapest contiguous window before a deadline, recomputed on `rates_published`. REST-only.
  Output always estimate-labelled; fails closed on an incomplete day. (Reuses `lib/planner/tie.ts`, `lib/analytics/priceAnalytics.ts`.)
- **PR-FUNC-3 — Dispatch awareness & lookahead.** Continue read-only SMART/BOOST modelling; add `dispatch_starting_soon` /
  `dispatch_starts_within` (S57a). Never assume a discount on whole-home import (`lib/effectiveRate.ts:5-20`).
- **PR-FUNC-4 — Dispatch control (LATER, consent-gated).** If and only if live introspection confirms the schema and a reference client
  (HA) validates it: allow set-ready-by / bump with explicit consent + rollback (PAT-002; S57). Read-only until then.
- **PR-FUNC-5 — Budget guardrails.** A monthly budget setting; `over_budget` / `run_rate_exceeds` triggers and `over_budget_now`
  condition from the existing projection (`lib/billing/project.ts`). Projection always labelled estimate.
- **PR-FUNC-6 — Export optimisation.** Add `export_peak_started` trigger (symmetry with existing `is_peak_export_now` + export actions).
- **PR-FUNC-7 — Carbon-optimised automation.** `greener_than_percentile` condition + a combined cheap+green planner action, from
  carbon-intensity forecast (NOT Greener Nights). Forecast clearly labelled.
- **PR-FUNC-8 — Honest tariff comparison (S55).** Standing-charge-accurate, consumption-shaped, eligibility-aware **estimate** with
  confidence and explicit "not evaluated" reasons; never "best"; never auto-switch.
- **PR-FUNC-9 — Settled consumption insights (S54).** REST `group_by` day/week/month cost & usage, peak-share, "settled through <date>"
  indicator; a widget/drill-down. Telemetry never blended into settled figures.
- **PR-FUNC-10 — Credential repair.** Preserve/extend the existing repair flow (`drivers/*/repair/`); propagate a repaired key to sibling
  devices/pollers on the same account (S51g).
- **PR-FUNC-11 — Event awareness.** Saving Sessions / Power-ups conditions, reminders (quiet-hours + lead-time + dedupe), and an event
  widget; pending-vs-finalised reward wording (S56).

## 7. Non-functional requirements

- **PR-NFR-1 — Budget/reliability under load.** Sustained Kraken traffic must stay within the shared ~≤90/hr/account target (headroom under
  the ~100–125/hr ceiling shared across *all* apps on the account). No path bypasses the shared budget; 429/5xx → exponential backoff +
  freshness retention. New features default to **REST-derived** data where possible. (Owns: SEC-001, F0; [Octopus GraphQL basics](https://developer.octopus.energy/rest/guides/api-basics).)
- **PR-NFR-2 — Provenance & estimate labelling.** Every user-facing value carries an honest state (`current | estimated | stale | planned |
   finalised | unknown`); estimated/planned/telemetry are never shown as settled (F1; REQ-002/003/004). Per-domain freshness (S53a) so a
   stale sub-value is never marked "Current".
- **PR-NFR-3 — Privacy.** No account number / MPAN / MPRN / serial / device id in logs, diagnostics, or persisted keys; opaque/salted keys;
   real-format ids in tests (REQ-005).
- **PR-NFR-4 — Correctness authority.** REST authoritative for settled/billed/history; GraphQL fails closed.
- **PR-NFR-5 — Compatibility & footprint.** Homey SDK v3, local platform, zero runtime deps; preserve all capability/driver/widget/Flow IDs
   (REQ-001); no version bump unless a user-facing change requires it (CON-002).
- **PR-NFR-6 — Performance/UX responsiveness.** Under-polling must be communicated via freshness labelling, not solved by faster polling
   (`sprints-42-48-spec.md` S42 risk).

## 8. Accessibility

- **PR-A11Y-1** Charts must provide text/tabular summaries and non-colour-only encodings (patterns/labels) — S53d. Current widgets risk
  colour-only price/carbon encoding.
- **PR-A11Y-2** Keyboard and screen-reader discoverability for widget and settings controls.
- **PR-A11Y-3** Clear, plain-language state labels (avoid jargon in badges: "Updated 4 min ago" over raw states where helpful).
- **PR-A11Y-4** Settings must give explicit save/error feedback (currently swallowed — S53c).

## 9. UX principles

1. **Honesty over precision** — when a value is ambiguous (e.g. IOG effective rate), show the confidence, don't fake a number.
2. **One card per job** — users should express intent ("cheapest 3h before 7am") without chaining logic.
3. **Glanceable first, drill-down second** — widgets summarise; details on demand.
4. **Budget-aware by default** — features prefer REST; live/GraphQL is opt-in and clearly "uses your Octopus allowance."
5. **Consent for anything that acts** — control/auto-join/auto-switch always explicit, reversible, and labelled.
6. **Progressive disclosure** — advanced planner/analytics stay opt-in so mainstream users aren't overwhelmed.
7. **Localisable** — copy authored for translation (addresses the en-only gap).

## 10. Success metrics

| Metric | What it measures | Target signal |
|---|---|---|
| Time-to-first-automation | Onboarding → first working price Flow | ↓ after target-rate primitive + onboarding guidance |
| Target-rate card adoption | % active installs using target-rate trigger/condition | Leading indicator of automation value (G1) |
| Budget-guardrail adoption | % using budget triggers/widget | Mainstream engagement (G2) |
| Provenance comprehension | Support threads about "wrong/blank price" | ↓ (trust working) — proxy via community.homey.app/t/156860 |
| Kraken 429 rate | Throttle events per account-hour | ≈0 under normal load (G4/PR-NFR-1) |
| Widget dashboard retention | Widgets kept on dashboards over time | Stickiness of native UX advantage |
| Crash/error-free sessions | Refresh cycles without surfaced errors | ↑ post-S52 decomposition |
| Localisation reach | # languages shipped | >1 (currently en-only) |

*(Homey's local platform limits server-side analytics; several metrics are proxied via community signals and App Store reviews rather than
telemetry — deliberate, given PR-NFR-3.)*

## 11. Alignment & divergence vs existing plans

- **Agree:** Sequencing hardening/refactor (S51/S52) before features; S54/S55/S56/S58 map to PR-FUNC-5/8/9/11/6/7; all non-goals match the
  roadmap's rejected list.
- **Extend:** I elevate **budget guardrails (PR-FUNC-5)** and **settled insights (PR-FUNC-9)** to headline user-facing wins within S54, and
  I raise **onboarding guidance** as an explicit requirement (not currently a sprint).
- **Diverge:** I specify a **first-class rolling target-rate primitive (PR-FUNC-2)** as its own top-priority item rather than leaving it
  implicit in the S47 planner actions. Rationale: it is the highest-impact, lowest-budget, most-copied gap. ⚠ **Cross-discipline note:**
  engineering may prefer to keep target-rate as a stateless action to avoid device-side re-evaluation; the product-acceptable design is a
  **stateless service recomputed on `rates_published`** exposing both a trigger and a condition — this satisfies the reliability constraint
  without downgrading the user affordance. The architect owns the final mechanism.

*Sources: repo files cited inline; `ROADMAP.md`, `sprints-42-48-spec.md`, `sprints-50-58-spec.md`;
[Octopus GraphQL basics](https://developer.octopus.energy/rest/guides/api-basics),
[HA target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/),
[Greener Nights ends 31 Jul 2026](https://energy-stats.uk/octopus-greener-days/).*
