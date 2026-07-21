# 11 — Flow-Card Opportunity Report

> Blueprint deliverable · Workstream: **Product & UX Strategy** · v1.0.20 · Docs-only.
> Reviews the current Flow surface (**33 triggers / 17 conditions / 13 actions**, `app.json`) and proposes additions + Advanced-Flow
> opportunities. Same per-item schema (benefit · feasibility · complexity · deps · risk) and the shared Impact/Value/Innovation vs Effort model.
> Effort: **S** hours · **M** 1–2d · **L** 3–5d · **XL** 1–2wk (docs-only estimate).

---

## Part A — Current Flow surface (inventory)

**Triggers (33):** `balance_below`, `balance_changed`, `cost_today_above`, `dispatch_cancelled`, `dispatch_changed`, `dispatch_completed`,
`dispatch_ended`, `dispatch_started`, `free_electricity_ended`, `free_electricity_started`, `saving_session_announced`,
`saving_session_ended`, `saving_session_started`, `saving_session_starting_soon`, `standing_charge_changed`, `tariff_changed`,
`usage_today_above`, `price_changed`, `price_below`, `price_plunge`, `price_level_changed`, `cheapest_slot_started`, `smart_charge_started`,
`smart_charge_ended`, `carbon_below`, `carbon_level_changed`, `rates_published`, `night_rate_started`, `night_rate_ended`,
`export_rate_changed`, `export_rate_above`, `gas_price_changed`, `gas_price_below`.

**Conditions (17):** `balance_below_now`, `dispatch_active`, `price_below_now`, `is_cheapest_now`, `price_level_is`,
`within_cheapest_period`, `in_cheapest_plan`, `carbon_below`, `is_greenest_now`, `carbon_level_is`, `renewables_above`, `good_now`,
`price_percentile_below`, `is_night_rate`, `relative_price_band_is`, `is_peak_export_now`, `gas_price_below`.

**Actions (13):** `refresh_now`, `bump_charge`, `find_cheapest_slot`, `find_cheapest_hours`, `plan_charge`, `plan_green_charge`,
`find_best_tariff`, `find_cheapest_slot_advanced`, `plan_charge_advanced`, `analyse_price_day`, `find_peak_export_slot`,
`find_peak_export_slot_advanced`, `plan_export_advanced`.

### Assessment
This is a **broad, well-designed surface** — notably deep on price/carbon/dispatch/saving-sessions and, unusually, on **relative** price
metrics (`price_percentile_below`, `relative_price_band_is`) and **advanced planner** actions with tie strategies (`plan_charge_advanced`,
`analyse_price_day`). Coverage already meets or beats Tibber's card set ([Tibber on Homey](https://homey.app/en-us/app/com.tibber/Tibber/)).

**Structural gaps** (vs HA + user JTBD):
1. **No rolling target-rate trigger/condition** — users must chain `find_cheapest_hours` + logic to react to "the cheapest window is now."
2. **No budget/threshold guardrail trigger** beyond `cost_today_above` (no month-to-date/run-rate/over-budget).
3. **No dispatch-*plan*-lookahead** condition ("a dispatch starts within N min") — only current state.
4. **No export-peak *trigger*** (there's a condition `is_peak_export_now` and actions, but no edge trigger).
5. **No carbon-optimised *action*** (green charge exists; no "cheapest AND greenest" combined planner as a first-class card).
6. **No standalone estimated-effective-rate condition** (deferred in S44/S47).
7. **No greenness-forecast trigger** ("greenest window starts soon").

---

## Part B — Proposed cards

### Triggers

| ID (proposed) | Description | Benefit | Feasibility | Cmplx | Deps | Risk |
|---|---|---|---|---|---|---|
| **`target_rate_window_started` / `_ending_soon`** ★ | Fires when the auto-selected cheapest contiguous window begins/is about to end | Turns the #1 job into one card | High (REST, reuse planner) | M | stateless target-rate service; `rates_published` | Low (estimate; fails closed) |
| **`over_budget` / `run_rate_exceeds`** ★ | Month-to-date spend or projected month crosses a user budget | Bill-anxiety guardrail; mainstream | High | M | S54 budget setting; `lib/billing/project.ts` | Med (projection = estimate, label it) |
| **`dispatch_starting_soon`** | A planned dispatch starts within N minutes | Pre-empt EV/appliance actions | High (read) | S/M | `lib/DispatchPoller.ts` plan tokens (S57a) | Med (versionless schema — verify) |
| **`export_peak_started`** | Export value enters top band / crosses threshold window | Symmetry with import; solar (P4) | High | S | export rates | Low |
| **`greenest_window_starting`** | Forecast cleanest window begins soon | Carbon-shifting automation | Med | M | carbon forecast (`lib/carbon.ts`) | Med (forecast provenance; not Greener Nights) |
| **`price_negative`** | Unit rate goes ≤ 0 (Agile plunge) | High-value "dump load now" cue | High | S | rates | Low (must not clamp negatives — already handled `priceAnalytics.ts`) |
| **`power_up_available`** | A Power-up / Free-Electricity window is announced/active | Free-energy engagement | High | S | `SavingSessionsPoller.ts` (S56) | Med (intent not settlement) |
| **`carbon_optimal_now`** | Combined cheap+green score enters "act now" band | Innovation; multi-signal | Med | M | price + carbon | Med (composite scoring clarity) |

### Conditions

| ID (proposed) | Description | Benefit | Feasibility | Cmplx | Deps | Risk |
|---|---|---|---|---|---|---|
| **`in_target_rate_window`** ★ | True while inside the rolling cheapest window | Gate any Flow on "is it cheap now (rolling)" | High | S/M | target-rate service | Low |
| **`dispatch_starts_within`** | True if a plan starts within N min | Lookahead gating | High | S | S57a plan token | Med (schema) |
| **`estimated_effective_rate_below`** | Opt-in, estimate-tagged effective-rate threshold | Power-user IOG gating | Med | S | `lib/effectiveRate.ts` | Med (must stay labelled estimate — S44 deferred this deliberately) |
| **`over_budget_now`** | Month-to-date over budget | Guardrail in any Flow | High | S | budget setting | Low |
| **`greener_than_percentile`** | Carbon in cleanest X% of the day | Relative carbon (mirrors price percentile) | High | S | `lib/carbon.ts` | Low |
| **`saving_session_joined`** | Joined/active state (where proven) | Correct event automation | Med | S | S56; proven join state only | Med (only if state is reliable) |

### Actions

| ID (proposed) | Description | Benefit | Feasibility | Cmplx | Deps | Risk |
|---|---|---|---|---|---|---|
| **`plan_cheapest_green_charge`** | Combined cost+carbon-weighted plan (one card) | "Cheap AND clean" in one step | High | M | planner + carbon (S58) | Low |
| **`start_dispatch` / `bump_charge_now` (control)** | Trigger an IOG bump / charge from Homey | Closes the dispatch-control gap vs HA | **Low** (write) | L | GraphQL mutation, consent, rollback (S57) | **High** (RISK-057-SCHEMA; versionless writes) |
| **`set_ready_by` / `set_target_soc` (control)** | Set IOG ready-by time / target SoC | Turnkey EV UX | **Low** (write) | L/XL | confirmed schema; consent | **High** (undocumented; read-only first) |
| **`compare_tariffs_estimate`** | Eligibility+standing-charge-accurate estimate (never "best") | Honest comparison (P1) | High | M | S55 comparison 2.0 | Med (RISK-055-MISLEAD) |
| **`export_history_report`** | Emit settled export earnings summary token | Solar reporting | High | S | REST group_by (S54) | Low |

---

## Part C — Advanced-Flow opportunities

Homey Advanced Flow rewards **rich tokens + composable conditions**. Highest-leverage moves:

1. **Dispatch-aware automations** — expose stable **plan tokens** (start/end/type/confidence) so an Advanced Flow can branch on SMART vs
   BOOST and lookahead. Deps: S57 plan-token round-trip. **Impact High** for EV owners.
2. **Target-rate as a primitive** — `in_target_rate_window` + `target_rate_window_started` let users compose "cheapest 3h before ready-by,
   only if car <80%, unless a Saving Session is active." REST-only, no budget cost. **Top recommendation.**
3. **Budget/threshold guardrails** — `over_budget` trigger + `over_budget_now` condition enable "pause discretionary loads when
   projected over budget." Pairs with report 10 W3. **Impact High**, mainstream.
4. **Export-peak automations** — `export_peak_started` + `is_peak_export_now` (exists) enable battery discharge / load-shifting at best export.
5. **Carbon-optimised automations** — `greener_than_percentile` + `plan_cheapest_green_charge` for users who weight carbon alongside price.
   Base on carbon-intensity forecast, **not** the deprecating Greener Nights ([ends 31 Jul 2026](https://energy-stats.uk/octopus-greener-days/)).
6. **Rich token enrichment** — add confidence/provenance/source tokens to existing outputs so Advanced Flows can gate on freshness
   (stale-aware). Aligns with S53b stale-aware conditions.

---

## Part D — Prioritisation

| Rank | Card(s) | Impact | Value | Innovation | Effort | Rationale |
|---|---|---|---|---|---|---|
| 1 | `in_target_rate_window` + `target_rate_window_started/_ending_soon` | High | High | Med | M | Top automation gap; REST-only; reuses planner |
| 2 | `over_budget` / `run_rate_exceeds` + `over_budget_now` | High | High | Med | M | Mainstream bill guardrail; projection exists |
| 3 | `price_negative` + `export_peak_started` | High | High | Med | S | Cheap edge triggers, low effort |
| 4 | `dispatch_starting_soon` + `dispatch_starts_within` | Med/High | High | Med | S/M | EV lookahead; read-only; S57-aligned |
| 5 | `power_up_available` + `saving_session_joined` | Med/High | High | Med | S/M | Octoplus engagement; S56 |
| 6 | `plan_cheapest_green_charge` + `greener_than_percentile` | Med | Med/High | High | M | Carbon differentiator; S58 |
| 7 | `compare_tariffs_estimate` | Med | Med | Low | M | Honest comparison; S55 |
| 8 | **Dispatch control actions** (`start_dispatch`/`set_ready_by`/`set_target_soc`) | High | High | High | L/XL | **Deferred** — high schema/write risk; read-only first |

**Product recommendation:** ship ranks **1–3 first** — all REST-derived, low Kraken cost, and they close the most-felt gaps. Treat the
**dispatch-control writes (rank 8)** as a separate, consent-gated, schema-verified track — high reward but the single riskiest surface.

⚠ **Cross-discipline note (for the architect/reliability workstream):** I am deliberately proposing target-rate and budget cards as
**stateless, REST-derived, recomputed on `rates_published`** rather than stateful device timers — this keeps them off the Kraken budget
(SEC-001) and avoids new god-object state (S52). If engineering prefers pure *action* cards over *trigger* cards to dodge re-evaluation
scheduling, I can accept that for budget guardrails but **not** for target-rate: a trigger is what users actually need ("tell me when the
cheap window starts"), and HA's popularity of exactly this pattern is the evidence.

*Sources: `app.json` (flow), `lib/planner/tie.ts`, `lib/analytics/priceAnalytics.ts`, `lib/billing/project.ts`, `lib/DispatchPoller.ts`,
`lib/effectiveRate.ts`, `lib/carbon.ts`, `SavingSessionsPoller.ts`, `ROADMAP.md`/`sprints-50-58-spec.md` (S54–S58);
[HA target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/),
[HA intelligent](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/intelligent/),
[Tibber on Homey](https://homey.app/en-us/app/com.tibber/Tibber/), [Greener Nights](https://energy-stats.uk/octopus-greener-days/).*
