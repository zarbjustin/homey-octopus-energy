# 10 — Widget Opportunity Report

> Blueprint deliverable · Workstream: **Product & UX Strategy** · v1.0.20 · Docs-only.
> Reviews the **6 existing widgets** and proposes new ones. Grounded in `app.json`, `widgets/`, and `_grounding.md`.
> Prioritisation model (used across reports 10/11/19): score **Impact**, **User value**, **Innovation** each Low/Med/High, against
> **Engineering effort** (S/M/L/XL). "Priority" is the product recommendation after weighing all four.

Effort key: **S** ≈ hours, **M** ≈ 1–2 days, **L** ≈ 3–5 days, **XL** ≈ 1–2 weeks (single-author, docs-only estimate; excludes cert).

---

## Part A — Existing widgets (review)

The app ships six widgets, each rendering a **provenance badge** (Current / Stale / Unknown) via a shared `freshnessHtml` helper and
labelling app-derived recommendations/forecasts as estimates (README; `ROADMAP.md` S49). This is the widgets' standout quality — protect it.

| # | Widget | What it shows | Strengths | Weaknesses / opportunity |
|---|---|---|---|---|
| 1 | **agile** | Half-hourly Agile price curve | Core value; provenance badge | No target-window highlight; no "cheapest N hours" shading; no interaction/drill |
| 2 | **carbon** | Regional carbon intensity / renewables % | Differentiator vs price-only apps | Static level only; no **greenness forecast** band; no "greenest window" call-out |
| 3 | **export** | Export/SEG value + earnings | Rare among peers | No paired import-vs-export view; no peak-export highlight |
| 4 | **price** | Current unit rate + level | Clear at-a-glance | Duplicates agile somewhat; no next-change countdown |
| 5 | **summary** | Account balance, live power, dispatch, effective-rate hook | Densest, most valuable; honest planned-vs-finalised (S46) | Information-dense; no personalisation of which blocks show |
| 6 | **timeline** | Upcoming-price timeline | Forward view; badge | No dispatch/saving-session overlay; no carbon overlay |

### Cross-cutting findings (existing widgets)
- ✅ **Accessibility groundwork exists** but is incomplete — S53 plans accessible chart summaries + non-colour-only patterns
  (`sprints-50-58-spec.md` TASK-053d). Endorsed: charts currently risk colour-only encoding.
- ⚠ **No configuration/personalisation** — Homey widgets support settings; none of these let the user pick metric/threshold/blocks.
- ⚠ **Per-domain freshness** — a single device timestamp can mark a stale sub-value "Current"; S53a fixes this. **This directly improves
  every widget's honesty** and should land before adding new widgets.

### Recommended improvements to existing widgets (before net-new)

| Improvement | Widget(s) | Benefit | Feasibility | Complexity | Deps | Risk |
|---|---|---|---|---|---|---|
| Per-domain provenance badges | all | Honest freshness per sub-value | High | M | S52/S53a | Low (may look like regression — communicate) |
| Target-window shading ("cheapest 3h") | agile, timeline | Turns a chart into an action cue | High | M | rates (REST) | Low |
| Greenest-window band | carbon, timeline | Carbon-shifting made obvious | High | M | `lib/carbon.ts` | Med (forecast provenance) |
| Accessible chart summaries + patterns | all | A11y compliance | High | M | S53 | Low |
| Widget settings (threshold/metric) | price, agile, carbon | Personalisation | Med | M | Homey widget settings API | Low |

---

## Part B — Proposed new widgets

Each: description · user benefit · technical feasibility · complexity · dependencies · risk.

### W1 — Target-rate / "cheapest window" widget  ★ top pick
- **Description:** Shows the next auto-selected cheapest contiguous window (e.g. "cheapest 3h before 07:00 → 01:30–04:30, avg 7.2p"),
  re-computed when new rates publish.
- **Benefit:** The #1 dynamic-tariff job (P2/P3) without hand-rolling Flow logic; mirrors HA's most-used feature ([target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/)).
- **Feasibility:** High — reuses `lib/planner/tie.ts` + `lib/analytics/priceAnalytics.ts`; REST-only (no Kraken budget cost).
- **Complexity:** **M** · **Deps:** planner engine, a stateless target-rate service (report 11 F/C1) · **Risk:** Low (estimate-labelled; fails closed on incomplete day).
- **Score:** Impact **High** · Value **High** · Innovation **Med** · Effort **M**.

### W2 — Settled cost / usage insights widget (day/week/month)
- **Description:** REST `group_by` history: cost & kWh by day/week/month, peak-share, "settled through <date>" indicator.
- **Benefit:** Closes the biggest reporting gap vs HA cost trackers; mainstream (P1) value.
- **Feasibility:** High — REST-authoritative; aligns with **S54**.
- **Complexity:** **L** · **Deps:** S54 REST group_by service · **Risk:** Med — must never blend telemetry into settled (RISK-054-BILLING-HONESTY).
- **Score:** Impact **High** · Value **High** · Innovation **Low** · Effort **L**.

### W3 — Budget / bill-guardrail widget
- **Description:** Month-to-date spend vs a user budget, run-rate projection (estimate-labelled), over/under indicator.
- **Benefit:** Bill anxiety is the mainstream driver; turns projection (`lib/billing/project.ts`) into a glanceable guardrail.
- **Feasibility:** High — projection already exists; needs a budget setting.
- **Complexity:** **M** · **Deps:** S54 budget setting; `lib/billing/` · **Risk:** Low/Med (projection clearly estimate).
- **Score:** Impact **High** · Value **High** · Innovation **Med** · Effort **M**.

### W4 — Saving Sessions / Power-ups event widget
- **Description:** Next announced/active event, countdown, join state (where proven), pending-vs-finalised reward wording.
- **Benefit:** Octopus-specific engagement hook; Octoplus points are worth ~£300/yr to users ([Octoplus](https://octopus.energy/octoplus/)).
- **Feasibility:** High — data exists (`SavingSessionsPoller.ts`); aligns with **S56**.
- **Complexity:** **M** · **Deps:** S56 event model · **Risk:** Med — reward is intent not settlement (RISK-056-REWARD).
- **Score:** Impact **Med/High** · Value **High** · Innovation **Med** · Effort **M**.

### W5 — Dispatch / EV-charging status widget
- **Description:** Current/next dispatch (SMART vs BOOST), guaranteed off-peak window, "charging now?" state, estimated effective rate (opt-in).
- **Benefit:** EV/IOG owners (P3) get a purpose-built glance instead of parsing the dense summary widget.
- **Feasibility:** High (read) — data in `lib/dispatch/`, `lib/effectiveRate.ts`.
- **Complexity:** **M** · **Deps:** none new · **Risk:** Med — must keep SMART/BOOST honesty (`lib/effectiveRate.ts:5-20`).
- **Score:** Impact **Med/High** · Value **High** · Innovation **Med** · Effort **M**.

### W6 — Greenest-window / carbon-forecast widget
- **Description:** Forecast band of cleanest upcoming hours + "shift now / wait" cue.
- **Benefit:** Carbon-motivated users; a differentiator Tibber lacks. Note **Greener Nights ends 31 Jul 2026** — base on carbon-intensity forecast, **not** the deprecating Octopus scheme ([Greener Nights](https://energy-stats.uk/octopus-greener-days/)).
- **Feasibility:** Med — depends on carbon forecast source in `lib/carbon.ts`; aligns with **S58**.
- **Complexity:** **M/L** · **Deps:** carbon forecast provenance · **Risk:** Med (forecast labelling) · **Score:** Impact Med · Value Med · Innovation **High** · Effort **M/L**.

### W7 — Paired import↔export optimiser widget (solar)
- **Description:** Side-by-side "cheapest import" vs "best export" windows + net advice for P4.
- **Feasibility:** Med — combines existing import planner + export peak logic.
- **Complexity:** **L** · **Deps:** S58 paired plan · **Risk:** Med · **Score:** Impact Med · Value Med/High (niche) · Innovation Med · Effort **L**.

### W8 — Multi-account / whole-home rollup widget
- **Description:** One tile summarising all linked accounts/meters (total balance, today's net cost).
- **Feasibility:** Med — needs account rollup (report 19 idea).
- **Complexity:** **L** · **Deps:** multi-account model · **Risk:** Med (privacy-safe keys, REQ-005) · **Score:** Impact Med · Value Med · Innovation Med · Effort **L**.

---

## Part C — Prioritisation

| Rank | Widget | Impact | Value | Innovation | Effort | Rationale |
|---|---|---|---|---|---|---|
| 1 | **W1 Target-rate** | High | High | Med | M | Closes the top automation gap; REST-only; reuses planner |
| 2 | **W3 Budget guardrail** | High | High | Med | M | Mainstream bill-anxiety win; projection exists |
| 3 | **W2 Insights (day/wk/mo)** | High | High | Low | L | Biggest reporting gap vs HA; S54-aligned |
| 4 | **W5 Dispatch/EV status** | Med/High | High | Med | M | Purpose-built EV glance; read-only, low risk |
| 5 | **W4 Saving Sessions event** | Med/High | High | Med | M | Engagement + Octoplus value; S56-aligned |
| 6 | **W6 Greenest-window** | Med | Med | High | M/L | Differentiator; mind Greener Nights deprecation |
| 7 | **W7 Import↔export** | Med | Med/High | Med | L | Niche (solar); pairs with S58 |
| 8 | **W8 Multi-account rollup** | Med | Med | Med | L | Useful for prosumers/installers; needs model work |

**Sequencing recommendation:** land **per-domain freshness + target-window shading on existing widgets first** (Part A improvements),
then **W1 → W3 → W2**. These three alone move the app from "honest dashboard" to "honest *and* actionable dashboard."

⚠ **Cross-discipline note:** Every new widget that subscribes to live/GraphQL data (W4/W5) must respect the F0 subscription-based polling
(only poll while a widget is mounted). Report 11 and the architect workstream own the budget accounting; product's ask is that new widgets
default to **REST-derived** data (W1/W2/W3) where possible to avoid Kraken pressure (SEC-001).

*Sources: `app.json`, `widgets/`, `lib/planner/tie.ts`, `lib/analytics/priceAnalytics.ts`, `lib/billing/`, `lib/carbon.ts`, `ROADMAP.md` (S49/S53/S54/S56/S58);
[HA target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/), [Octoplus](https://octopus.energy/octoplus/),
[Greener Nights](https://energy-stats.uk/octopus-greener-days/).*
