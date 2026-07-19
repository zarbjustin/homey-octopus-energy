# Implementation Plan & Spec — Sprints 42–48 (Octopus Energy for Homey)

Location: `docs/handover/sprints-42-48-spec.md` · Baseline: `main` @ `v1.0.16` · Type: **research + written specification (no code)**.

Success lens (confirmed): **Balanced — a trustworthy core with opt-in advanced/power-user features.**
Mandate (confirmed): free to **re-sequence, merge, split, or drop** sprints.

---

## 1. Problem statement & approach

The existing roadmap (Sprints 42–48) is well-scoped but is framed as "add more Kraken data + more Flows." Two structural risks threaten a *trustworthy* outcome:

1. **Shared rate-limit pressure.** The Kraken GraphQL API allows only **~100–125 requests/hour/account, shared across every app** touching that account (Octopus's own app, Home Assistant, this app, etc.). The app is already at risk: live power polls **every 30 s per electricity device (~120/hr each)** on top of dispatch (5-min), points (hourly), saving sessions, balance and tariff-recovery calls. Adding more GraphQL features without a shared budget will cause throttling that degrades *core* price/health refreshes — the opposite of trustworthy.
2. **Misleading precision.** IOG "effective price now" is genuinely ambiguous (guaranteed 23:30–05:30 whole-home off-peak vs bonus smart-dispatch vs BOOST, midday-to-midday allowance, EV-load-specific billing). Presenting planned dispatch or an estimated effective rate as if it were settled truth erodes trust — the same class of problem as the v1.0.13 price-gap incident.

**Approach:** make **trust the backbone**. Sequence a shared request budget and a single data-provenance/freshness convention *first*, deliver the highest mainstream-value feature (billing-period summary) early, and treat the ambiguous effective-price and experimental live-gas work as clearly-labelled, opt-in, lower-priority — dropping live-gas as a shipped feature.

---

## 2. Key research findings (verified)

| Finding | Source | Design consequence |
|---|---|---|
| Home Mini uploads ~every 10 s; safe API pull ~30–60 s; **hard limit ~100–125 req/hr/account, shared across all apps** | openHAB/HA/community threads, Aug 2026 | Sprint 42 must be a **shared account-scoped request budget**, not just a poller. Conservative default cadence; leave headroom for Octopus's own app. |
| Current live power polls **30 s per device** with no dedup/budget | `drivers/electricity/device.ts:244` (`enableLivePower` 30_000 ms) | Latent throttling bug; Sprint 42 also *fixes* this. Live power should be opt-in, subscription-based, paused when unused. |
| `flexPlannedDispatches` is **device-scoped**; `completedDispatches` is account-scoped with optional delta/metadata; tariff is a union (Standard/DayNight/ThreeRate/**FourRateEv**/HalfHourly/Prepay) | Sprint 41 introspection (`docs/research/kraken-contracts.md`) | Sprint 43 must move off the account-scoped `plannedDispatches` (start/end only) to device-scoped, typed SMART/BOOST model. |
| Current dispatch code uses account-scoped `plannedDispatches { start end }` only | `lib/KrakenClient.ts:457`, `lib/DispatchPoller.ts` | No device, type, delta, or overlap awareness today. State is "active/ended" only. |
| IOG billing: whole-home is off-peak during the **guaranteed** 23:30–05:30 window; bonus dispatch/BOOST is billed differently (often EV-load-specific); 6-hour cap + Charge Cap (Mar 2026) | Octopus policy + EV tariff explainers 2026 | A single "effective rate now" is **ambiguous**. Keep household base rate authoritative; any effective rate = estimate + confidence. |
| REST remains authoritative for meter identity, agreements, consumption/billing, and rate history; GraphQL is enrichment/live-only and must fail closed | `docs/research/kraken-contracts.md` (Data authority table) | Never let GraphQL replace REST billing/history. |

---

## 3. Opinion: what to keep, change, and drop

**Endorsed as-is (strong):**
- **S42 shared poller** — correct and *urgent* (fixes a latent throttling bug). Elevate to "budget owner for all Kraken calls."
- **S43 dispatch truth model** — correctness-critical; must precede any dispatch Flows.
- **S45 billing-period summary** — highest mainstream value; REST-authoritative; low ambiguity.

**Change:**
- **Re-sequence:** do **S45 (billing summary) and S46 (live-energy UI) before S44 (effective-price Flows)**. Billing summary is high-value, low-risk, and depends only on REST + the S42 poller — shipping it earlier gives users a trustworthy win and de-risks the ambiguous effective-price work.
- **Scope S44 down** to: expose dispatch details + household base rate + a clearly-labelled, opt-in **estimated** effective rate with a confidence/provenance tag. Do **not** make effective price a headline/settlement value. Add "changed/cancelled/finalised" events only where S43's truth model supports them.
- **Add a cross-cutting foundation (F1): one data-provenance & freshness convention** (`current / estimated / stale / planned / finalised / unknown`) defined once and applied to capabilities, device warnings, widgets, and Flow tokens. Delivered inside S42/S43, not as a separate release. This is the single highest-leverage UX investment and prevents "planned shown as settled" mistakes.

**Drop / defer:**
- **S48 estimated live-gas → DROP as a shipped feature.** Gas is not half-hourly settled, Home Mini gas telemetry is unreliable, and an "estimated" live-gas number risks the exact misleading-data problem we're trying to avoid — for low mainstream value. Keep at most a time-boxed research spike; do not ship. **Replace the slot with a "Trust & Polish" sprint** (apply F1 everywhere, settings/UX consistency, docs, community feedback loop, action-runtime maintenance).

---

## 4. Cross-cutting foundations (apply to every sprint)

**F0 — Shared Kraken request budget (delivered in S42).**
- One account-scoped scheduler/token-bucket for **all** GraphQL calls (telemetry, dispatch, points, saving sessions, balance, tariff recovery).
- Conservative budget (target ≤ ~90/hr/account to leave headroom for Octopus's own app); hard exponential backoff + freshness retention on 429/5xx.
- Priority classes: core (price/health) > billing/live-on-demand > best-effort reporting. Best-effort calls yield first under pressure.
- Live/on-demand calls are **subscription-based**: only poll while a device/widget actually needs the value; pause otherwise.

**F1 — Data provenance & freshness convention (defined in S42, ratified in S43, applied everywhere after).**
- Canonical states: `current`, `estimated`, `stale`, `planned`, `finalised`, `unknown`.
- Representation rules: which capability holds the value; when to use `setWarning` vs a value badge vs a Flow token; a shared `confidence`/`source` token pattern for Flow cards; never present `planned`/`estimated` as `finalised`.
- Builds directly on the v1.0.15 price-only-advisory work (`refreshHealthDecision`).

**Global invariants (from `docs/handover/future-sprints.md`):** preserve all capability/driver/widget/Flow IDs; REST authoritative for billing/history; GraphQL fails closed; privacy-safe synthetic fixtures only; per-sprint short-lived branch + protected PR + CI/CodeQL; no version bump/publish during feature work unless explicitly requested.

---

## 5. Proposed execution order

`S42 (budget+poller) → S43 (dispatch truth + F1) → S45 (billing summary) → S46 (live-energy UI) → S44 (effective-price, scoped-down) → S47 (planner/analytics) → S49 (Trust & Polish, replacing dropped S48)`

Dependencies: S46 reuses S42. S44 depends on S43. S45 depends on S42 (for "today" live) + REST. F1 must be agreed before S44.

---

## 6. Per-sprint specification

Each spec: **Goal · Priority · In scope · Out of scope · Key contracts/design · UX principles · Acceptance criteria · Risks.**

### S42 — Shared Kraken budget + live-data poller  *(P0, foundation, do first)*
- **Goal:** one account-scoped live-data source and a shared request budget that every Kraken call flows through.
- **In:** token-bucket budget (F0); account-scoped Home Mini demand poller with dedup, freshness timestamps, subscription-based activation, configurable cadence (options e.g. 60/120/300 s; conservative default), hard 429 backoff; migrate existing per-device 30 s live-power to the shared poller; lightweight privacy-safe diagnostics (counts, last success, throttle events — no identifiers).
- **Out:** new UI/widgets (S46), dispatch changes (S43), billing (S45).
- **Key design:** central scheduler in `app.ts`/a new `lib/KrakenBudget.ts`; `KrakenClient` calls acquire budget; freshness struct `{ value, readAt, source, state }`.
- **UX:** live power opt-in with a clear "uses your Octopus API allowance" note; never throttle core price/health to feed live power.
- **Acceptance:** total Kraken calls/hour provably bounded under multi-device + multi-integration simulation; 429 triggers backoff without breaking core refresh; freshness exposed; multi-account isolation; DST-safe timers; fixtures + tests.
- **Risks:** under-polling feels laggy — mitigate with clear freshness labelling, not faster polling.

### S43 — Dispatch truth model + F1 convention  *(P0, correctness core)*
- **Goal:** a typed, device-aware dispatch state machine that never presents intent as settlement.
- **In:** device-scoped `flexPlannedDispatches` + `completedDispatches`; model linked devices, SMART vs BOOST, multiple/overlapping dispatches, late changes, DST, midday-to-midday allowance; states `planned/active/completed/cancelled/unknown` with type + confidence; **audit and preserve** existing `dispatch_started/ended/completed/active` IDs while making their semantics honest; ratify F1.
- **Out:** new Flow cards/effective price (S44).
- **Key design:** `lib/dispatch/` model + reconciliation; keep account-scoped `completedDispatches` but enrich; keep BOOST distinct (must not assume SMART discount).
- **UX:** clearly distinguish "planned" from "charging now"; expose type where known.
- **Acceptance:** overlap/late-change/DST/multi-device fixtures; existing triggers keep IDs and no longer fire on unconfirmed intent; fail-closed on unknown union.
- **Risks:** field names are versionless — verify via live introspection during build; fixtures define accepted shapes.

### S45 — Billing-period summary  *(P1, highest mainstream value — pulled earlier)*
- **Goal:** "this billing period so far: import/export, cost/value, standing charge, net position, projection + confidence."
- **In:** discover billing-period start (+ user override); aggregate from **REST** consumption/rates (authoritative); projection with explicit confidence; rebuild history after restart; capabilities + a summary surface.
- **Out:** dispatch-aware effective pricing (S44); live-gas.
- **UX:** projections always labelled estimate + confidence; never blend planned/estimated into the settled figure.
- **Acceptance:** correct across E7/export/partial periods; DST-safe boundaries; restart rebuild; fixtures.
- **Risks:** billing-period start discovery edge cases → user override + confidence.

### S46 — Live-energy presentation & widgets  *(P1, reuses S42)*
- **Goal:** show import/export/net demand with source timestamp + freshness; update widgets to reflect F1.
- **In:** consume S42 source (no new polling); preserve `measure_power` + Homey Energy; widgets separate household vs EV pricing and planned vs finalised outcomes; show current/stale/estimated/unknown badges.
- **Out:** new pricing math (S44); planner (S47).
- **Acceptance:** freshness visible; no Energy regression; widget stale-state UX; accessibility retained (per existing widget tests).

### S44 — Dispatch & effective-price Flows  *(P1, scoped-down, after S43)*
- **Goal:** expose dispatch details and an **opt-in, clearly-labelled estimated** effective rate — never a headline settlement value.
- **In:** current/next dispatch tokens (device, type); household base rate; **estimated** current effective rate + finalised previous-half-hour rate, each with confidence/provenance (F1); EV peak/off-peak and midday-to-midday allowance exposed **separately** from household price; changed/cancelled/price-finalised triggers only where S43 supports them; preserve all Flow IDs.
- **Out:** making effective price the current-price capability; any settlement claim from planned data.
- **UX (critical):** household base rate stays authoritative; effective rate is opt-in and tagged estimate; BOOST never assumed discounted.
- **Acceptance:** effective rate never overrides the authoritative current price; ambiguity always surfaced as confidence; fixtures for window vs bonus vs BOOST.
- **Risks:** over-engineering/misleading precision — the primary reason this is scoped down and sequenced after billing summary.

### S47 — Planner & tariff analytics  *(P2, opt-in power-user)*
- **Goal:** richer planning/analytics without touching core trust surfaces.
- **In:** earliest/latest/random tie strategies; import/export plan tokens; relative daily price bands; negative-price/spike handling; weighted averages; off-peak share; estimated savings; keep tariff comparisons/visualisations here.
- **Out:** changing core price/health/dispatch contracts.
- **Acceptance:** preserve negative prices, complete plans, contiguous-slot checks, current-slot eligibility; relative metrics declare window + tie rules (per kraken-contracts relative-price rules).

### S49 — Trust & Polish  *(replaces dropped S48)*
- **Goal:** consistency, docs, and confidence pass across the arc.
- **In:** apply F1 everywhere; settings/UX consistency; README/HANDOVER/ROADMAP updates; community feedback loop; GitHub Actions Node-runtime maintenance (separate, SHA-pinned) noted in the handover; verify the IOG price-gap field-confirmation gate.
- **Out:** new user-facing data features.
- **Acceptance:** no provenance inconsistencies; docs current; maintenance warnings cleared with release-policy tests green.

### S48 — Estimated live-gas  *(DROPPED as shippable; optional research spike only)*
- **Recommendation:** do not ship. If explored, time-box a spike, keep opt-in + clearly estimated, reconcile against REST, and gate hard. Do not use for cost.

---

## 7. Definition of done (per sprint, from handover)
Acceptance criteria + out-of-scope written first · sanitised fixtures + failure tests for new shapes · multi-account/DST coverage · IDs and documented health semantics preserved · `npm run lint`, `npm test`, `npm audit`, `git diff --check`, `homey app validate --level publish` all clean (two expected cumulative warnings only) · short-lived branch + protected PR + CI/CodeQL green · HANDOVER.md/ROADMAP.md updated.

## 8. Open questions to resolve before S42 build
1. Confirm the target hourly Kraken budget headroom (proposed ≤ ~90/hr/account) and default live cadence (proposed 120 s).
2. Confirm live power should default **off** (opt-in) given the allowance cost.
3. Confirm dropping live-gas (S48) is acceptable, or keep it as a shelved spike only.
4. Should F1 provenance be surfaced to users as a visible badge/token, or kept internal initially?

## 9. Status
- This is a **research + specification** artifact (no code). It supplements — and where noted, revises the sequencing of — `ROADMAP.md` Sprints 42–48 and `docs/handover/future-sprints.md`.
- Implementation follows in later sessions, one selected sprint at a time, per the Definition of Done above.
