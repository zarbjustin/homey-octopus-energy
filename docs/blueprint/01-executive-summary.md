# 01 — Executive Summary

> The one-page (ish) synthesis of a multi-model Principal-Engineer + Staff-PM + Senior-Engineer review of
> **Octopus Energy for Homey** (`uk.co.zarb.octopusenergy`), compiled 21 Jul 2026 against `main` @ `f53026d`
> (v1.0.20 / Build 20). Full detail in [00-index.md](00-index.md) and deliverables 02–19.

## Verdict
This is a **mature, unusually well-engineered community app** — TypeScript on Homey SDK v3, **zero runtime
dependencies**, **366 tests**, conservative CI gates (lint, `npm audit`, publish-validate, CodeQL), and a
genuinely differentiating discipline: it rigorously **labels estimates/forecasts vs settled figures** and keeps
diagnostics **identifier-free**. Repository health scores **7.2/10** (03). There are **no Critical or High
security findings** (06). The dominant drags are structural, not behavioural: a **2,392-LOC `OctopusMeterDevice`
god-object** and the ever-present **shared ~90–125 req/hr Kraken budget** constraint. The product is strong on
read/monitoring and price-aware automation, but trails the Home Assistant Octopus integration and Tibber on
**dispatch/EV control**, **settled-cost insights**, and **tariff-comparison honesty**.

## Top strengths (protect these)
1. **Trust-by-design** — estimate/settled/stale provenance (F1) and identifier-free diagnostics; a real
   differentiator vs naive integrations (02, 06, 12).
2. **Resilience & rate-limit discipline** — shared Kraken budget (F0), 429 gate, fail-closed refresh with
   last-value retention, single-flight token (04, 07).
3. **Security posture** — parameterised GraphQL, HTTPS-only with same-origin auth + manual-redirect, escaped
   widgets, SHA-pinned Actions, zero runtime deps (06).
4. **Breadth already shipped** — 3 drivers, 6 widgets, 33/17/13 Flow cards, repair flows on all drivers,
   Homey Energy integration (09, 10, 11).

## Top risks (the register: [17](17-risk-register.md))
| Risk | Why it matters | Response |
|---|---|---|
| **R-001 Kraken budget exhaustion** (High/High) | Shared ~90–125 req/hr can starve live/dispatch/auth | Reserved-core + jitter + coalescer + 1-hr system test (Phase 1) |
| **R-002/R-003 god-object refactor** (High/High) | Change-amplification; refactor could regress refresh/meter/Flow | Characterization tests first, leaf-first S52 extraction (Phase 2) |
| **R-004 stale-write race** (Med/High) | 90s watchdog lets old+new refresh overlap | Generation/AbortSignal write guard (Phase 2) |
| **R-005/R-006 versionless API + dispatch-as-settled** | Kraken can change; dispatch intent ≠ billed price | Re-introspection ritual; preserve intent model; never infer price |
| **R-010 identifier-derived persisted keys** | Privacy on backup/export leak | Opaque salted keys + migration (Phase 1–2) |
| **R-007 open IOG field-verification** | v1.0.20 fix unconfirmed on the affected account | Keep gate open; request one privacy-safe log (parallel, not a code milestone) |

## Multi-model disagreements — surfaced & reconciled
1. **Dispatch *control* (writes).** Product (Opus) wants it to close the headline gap vs HA/Tibber; Architecture
   (GPT-5.6) flags versionless-mutation risk (R-005/R-006). **Recommendation:** read-only + reference-client-verified
   + consent-gated first; write control is Phase 5, opt-in, never inferred as settled (BL-23→BL-24).
2. **Target-rate as a trigger.** Risks re-evaluation scheduling on the god-object/budget. **Recommendation:** a
   **stateless service recomputed on `rates_published`**, exposing both trigger and condition — no new polling (BL-22).
3. **New live widgets/cards vs the budget.** **Recommendation:** new surfaces default to **REST-derived** data; any
   GraphQL-backed live surface must fit F0 (BL-26/BL-27).
4. **`HOMEY_PAT` severity.** Architect rated it High; the independent specialist rated it Low (dispatch-gated,
   SHA-pinned, no fork exposure). **Reconciled to Medium** (low likelihood × critical impact): add a protected
   publish Environment + reviewer and a rotation runbook — a Phase-1 quick win, not a blocker (06, BL-14).

## What to do in the next 6 months (the roadmap: [15](15-prioritised-roadmap.md))
- **Phase 1 (Stability & security):** reserved-core budget + startup jitter + REST coalescer; opaque diagnostic keys;
  account-wide credential propagation on repair; protected publish env; README/lint fixes. *Gate:* request IOG Build-20 confirmation.
- **Phase 2 (Refactor):** characterization tests → decompose `OctopusMeterDevice` into typed services → single
  cumulative writer + generation-guarded writes → central utilities. Zero user-visible change.
- **Phase 3 (Provenance & insights):** per-source freshness + stale-aware tokens/badges; settled-consumption insights
  + budget Flows; accessibility; `usage_today` correctness; Saving-Session de-dup.
- **Phase 4 (Differentiators):** tariff comparison 2.0 (eligibility/confidence, no "best"); target-rate service;
  dispatch read-surface; carbon/cost & export optimiser; new REST-default widgets/cards.
- **Phase 5 (Future):** consent-gated dispatch control; i18n; multi-account households, dashboards, greenness automations.

## Bottom line
A high-quality codebase whose next 6–12 months should be: **harden the budget, safely dismantle the god-object,
double down on the honesty/provenance that sets it apart, then ship the EV/dispatch and settled-cost features that
close the gap with the best-in-class integrations** — without ever compromising the shared Kraken budget or the
estimate-vs-settled trust model.
