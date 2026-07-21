# 19 — Future Ideas & Innovation Catalogue

> Blueprint deliverable · Workstream: **Product & UX Strategy** · v1.0.20 · Docs-only, forward-looking.
> A catalogue of ideas beyond the committed roadmap. Each: **description · user benefit · feasibility · complexity · dependencies · risk ·
> innovation/impact score**. Scores use the shared model — **Impact**, **User value**, **Innovation** (Low/Med/High) vs **Effort** (S/M/L/XL).
> The **I/I score** (0–10) blends Innovation × Impact ÷ Effort as a rough steer, not a mandate. Cross-references `ROADMAP.md`/sprint specs.

Effort: **S** hours · **M** 1–2d · **L** 3–5d · **XL** 1–2wk (docs-only, single-author estimate).

---

## A. Automation & intelligence

### I1 — Rolling target-rate automation  ★ flagship
- **Description:** First-class "cheapest N hours before deadline" primitive as trigger + condition + widget, recomputed on `rates_published`.
- **Benefit:** The #1 dynamic-tariff job in one card; no hand-rolled logic (P2/P3). Most-copied HA feature ([target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/)).
- **Feasibility:** High — REST-only, reuses `lib/planner/tie.ts` + `lib/analytics/priceAnalytics.ts`. **Complexity:** M.
- **Deps:** stateless target-rate service. **Risk:** Low (estimate-labelled, fails closed). **I/I: 9.**
- *Roadmap note:* extends S47 planner into a named primitive (diverges from leaving it implicit).

### I2 — Dispatch *control* (not just read): bump / ready-by / target SoC
- **Description:** Consent-gated writes to IOG (start bump, set ready-by, target SoC).
- **Benefit:** Turnkey EV UX; closes the headline gap vs HA/Tibber ([HA intelligent](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/intelligent/)).
- **Feasibility:** **Low now** — versionless, undocumented mutations. **Complexity:** L/XL.
- **Deps:** live introspection + reference-client verification (PAT-002), explicit consent + rollback (S57). **Risk:** **High** (RISK-057-SCHEMA). **I/I: 7** (high reward, high risk — read-only first).

### I3 — Composite "cheapest AND greenest" planner
- **Description:** One action/card weighting price and carbon intensity into a single window recommendation.
- **Benefit:** Carbon-motivated automation Tibber/Frank lack. **Feasibility:** High. **Complexity:** M.
- **Deps:** price + `lib/carbon.ts` forecast. **Risk:** Med (composite-score clarity; forecast provenance). **I/I: 7.**

### I4 — Greenness-forecast automations (post-Greener-Nights)
- **Description:** "Greenest window starting soon" trigger + `greener_than_percentile` condition from carbon-intensity forecast.
- **Benefit:** Carbon shifting; a differentiator. **Feasibility:** Med. **Complexity:** M.
- **Deps:** carbon forecast source. **Risk:** Med — **must not build on Greener Nights (ends 31 Jul 2026)** ([source](https://energy-stats.uk/octopus-greener-days/)); RISK-058-DEPRECATION. **I/I: 6.**

### I5 — Predictive "should I run it now or wait?" advisor
- **Description:** Given a load profile, advise run-now vs wait-until-window with expected saving (estimate).
- **Benefit:** Turns data into a decision for non-automators (P1). **Feasibility:** Med. **Complexity:** L.
- **Deps:** planner + usage history (S54). **Risk:** Med (must label estimate; avoid over-precision). **I/I: 6.**

## B. Cost, budget & reporting

### I6 — Budget / bill guardrails
- **Description:** Monthly budget setting → over-budget/run-rate triggers + widget from existing projection (`lib/billing/project.ts`).
- **Benefit:** Mainstream bill-anxiety win (P1). **Feasibility:** High. **Complexity:** M. **Deps:** S54. **Risk:** Low/Med. **I/I: 8.**

### I7 — Settled insights dashboard (day/week/month)
- **Description:** REST `group_by` cost/usage history, peak-share, "settled through <date>", drill-down widget.
- **Benefit:** Biggest reporting gap vs HA cost trackers. **Feasibility:** High. **Complexity:** L. **Deps:** S54. **Risk:** Med (RISK-054-BILLING-HONESTY). **I/I: 7.**

### I8 — Weekly/monthly report notification (digest)
- **Description:** Opt-in summary push: spend vs budget, cheapest/greenest patterns, Octoplus earned, savings from automations.
- **Benefit:** Retention + demonstrates value; converts passive users. **Feasibility:** High. **Complexity:** M. **Deps:** I6/I7. **Risk:** Low. **I/I: 7.**

### I9 — Honest tariff comparison 2.0
- **Description:** Standing-charge-accurate, consumption-shaped, eligibility-aware **estimate** with confidence; never "best"/auto-switch.
- **Benefit:** Trustworthy switching guidance (P1). **Feasibility:** High. **Complexity:** M/L. **Deps:** S55. **Risk:** Med (RISK-055-MISLEAD). **I/I: 6.**

## C. Engagement (Octopus-specific)

### I10 — Saving Sessions / Power-ups automation + widget
- **Description:** Announced/soon/active conditions for Power Down & Power Up; reminders (quiet-hours, dedupe); event widget; pending-vs-finalised wording.
- **Benefit:** Octoplus value ~£300/yr to users ([Octoplus](https://octopus.energy/octoplus/)); engagement. **Feasibility:** High. **Complexity:** M. **Deps:** S56. **Risk:** Med (RISK-056-REWARD; intent≠settlement). **I/I: 7.**
- *Note:* auto-join ONLY if a documented mutation exists + explicit consent.

### I11 — Gamified progress (Octoplus points tracker / milestones)
- **Description:** Points trend, streaks, "on track for prize" nudges — an honest analogue of HA's Wheel of Fortune surfacing.
- **Benefit:** Stickiness; playful. **Feasibility:** Med. **Complexity:** M. **Deps:** points data (exists). **Risk:** Low/Med (don't imply guaranteed rewards). **I/I: 5.**

## D. Households, scale & platform

### I12 — Multi-account / whole-home rollup
- **Description:** One summary across all linked accounts/meters (total balance, net cost today); rollup widget.
- **Benefit:** Prosumers/installers (P4/P5) with multiple properties/meters. **Feasibility:** Med. **Complexity:** L. **Deps:** account rollup model. **Risk:** Med (privacy-safe keys, REQ-005). **I/I: 5.**

### I13 — Cross-integration cost attribution (Shelly/Emporia × tariff truth)
- **Description:** Combine this app's real half-hourly rate with a circuit monitor's per-circuit power in a Homey Flow → "cost of the EV
  circuit at the actual rate."
- **Benefit:** Turns the hardware *substitute* into a *complement*; a uniquely-Homey play no supplier app offers ([Emporia comparison](https://www.emporiaenergy.com/blog/home-energy-monitor-comparison/)).
- **Feasibility:** Med (documentation/recipe + a rate token). **Complexity:** M. **Deps:** exposed rate token. **Risk:** Low. **I/I: 7** (high differentiation, low cost).

### I14 — Health / connection status panel
- **Description:** A settings/widget panel showing per-domain freshness, budget headroom, last error, repair shortcut.
- **Benefit:** Reduces "is it broken?" support load; installer-friendly (P5). **Feasibility:** High. **Complexity:** M. **Deps:** S53 per-domain freshness. **Risk:** Low. **I/I: 6.**

### I15 — Paired import↔export / battery optimiser
- **Description:** Coordinated cheapest-import vs best-export plan; battery charge/discharge recommendations (Flux-aware, eligibility-checked).
- **Benefit:** Solar/battery owners (P4). **Feasibility:** Med. **Complexity:** L. **Deps:** S58. **Risk:** Med (Flux "temporarily unavailable"; recommendations only). **I/I: 6.**

## E. UX, accessibility & reach

### I16 — Guided onboarding + Flow cookbook
- **Description:** First-run walkthrough (locate API key, capability primer) + in-repo/user "Flow recipes" (target-rate, budget, EV).
- **Benefit:** ↓ time-to-first-automation; broadens beyond power users (P1). **Feasibility:** High. **Complexity:** M. **Deps:** none. **Risk:** Low. **I/I: 7.**

### I17 — Internationalisation (i18n)
- **Description:** Externalise copy; ship additional locales (currently `locales/en.json` only — en-only, verified).
- **Benefit:** Homey's audience is multilingual; peers localise (Tibber/Frank). **Feasibility:** Med (mechanical once copy externalised). **Complexity:** L. **Deps:** copy audit. **Risk:** Low. **I/I: 5.**

### I18 — Accessibility pass (charts, SR, keyboard, settings feedback)
- **Description:** Text/tabular chart summaries, non-colour-only encodings, keyboard/SR discoverability, explicit settings save/error feedback.
- **Benefit:** Inclusivity + compliance; fixes swallowed settings errors. **Feasibility:** High. **Complexity:** M. **Deps:** S53c/d. **Risk:** Low. **I/I: 6.**

### I19 — Provenance "trust legend" as a first-class UX
- **Description:** Make the freshness/estimate vocabulary a learnable, consistent visual legend across widgets — market the honesty.
- **Benefit:** Converts the code-level moat (`lib/freshness.ts`) into a visible product advantage. **Feasibility:** High. **Complexity:** S/M. **Deps:** S53. **Risk:** Low. **I/I: 7.**

---

## Prioritised catalogue (by I/I score)

| Rank | Idea | Impact | Value | Innovation | Effort | I/I | Track |
|---|---|---|---|---|---|---|---|
| 1 | I1 Rolling target-rate | High | High | Med | M | 9 | Near-term ★ |
| 2 | I6 Budget guardrails | High | High | Med | M | 8 | Near-term (S54) |
| 3 | I13 Cross-integration cost attribution | Med | Med/High | High | M | 7 | Differentiator |
| 3 | I16 Guided onboarding + cookbook | High | High | Med | M | 7 | Near-term |
| 3 | I19 Provenance trust legend | Med/High | High | Med | S/M | 7 | Near-term (S53) |
| 3 | I10 Saving Sessions/Power-ups | Med/High | High | Med | M | 7 | Mid (S56) |
| 3 | I3 Cheapest-AND-greenest planner | Med | Med/High | High | M | 7 | Mid (S58) |
| 3 | I7 Settled insights dashboard | High | High | Low | L | 7 | Near-term (S54) |
| 3 | I8 Digest notification | Med | High | Med | M | 7 | Mid |
| 3 | I2 Dispatch control | High | High | High | L/XL | 7 | Long/consent-gated (S57) |
| 11 | I4 Greenness forecast | Med | Med | High | M | 6 | Mid (S58) |
| 11 | I5 Run-now-or-wait advisor | Med | Med/High | High | L | 6 | Mid |
| 11 | I9 Tariff comparison 2.0 | Med | Med | Low | M/L | 6 | Mid (S55) |
| 11 | I14 Health/status panel | Med | Med | Med | M | 6 | Near/mid (S53) |
| 11 | I15 Import↔export optimiser | Med | Med | Med | L | 6 | Mid (S58) |
| 11 | I18 Accessibility pass | Med | Med/High | Low | M | 6 | Near-term (S53) |
| 17 | I11 Octoplus gamification | Low/Med | Med | Med | M | 5 | Later |
| 17 | I12 Multi-account rollup | Med | Med | Med | L | 5 | Later |
| 17 | I17 i18n | Med | Med | Low | L | 5 | Later |

### Theme summary
- **Near-term, on-brand, low-risk (do first):** I1, I6, I16, I19, I7 — all REST-derived or UX, close the most-felt gaps without touching the
  Kraken budget or the trust posture.
- **Differentiators worth betting on:** I13 (complement hardware), I19 (market the trust moat), I3/I4 (carbon-optimised).
- **High-reward / high-risk (patient track):** I2 dispatch control — pursue **read-only first**, schema-verified, consent-gated (PAT-002/S57).

⚠ **Cross-discipline notes for the orchestrator:**
1. **I2 (dispatch control)** is where product ambition most collides with reliability/security. Product wants it; the architect/reliability
   workstream will rightly gate it on RISK-057-SCHEMA. Agreed reconciliation: read-only + reference-client verification before any write.
2. **I1/I6 as *triggers*** imply re-evaluation scheduling; if engineering prefers pure actions to protect the budget/god-object, product
   accepts actions for budget guardrails but holds that **target-rate needs a trigger** (it's the actual user need). Recommended compromise:
   a stateless service recomputed on `rates_published`.
3. **I13/I17/I12** touch multi-source/identity/privacy surfaces — must adopt opaque keys and real-format-id tests (REQ-005) from the start.

*Sources: repo files cited inline; `ROADMAP.md`, `sprints-50-58-spec.md`;
[HA target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/),
[HA intelligent](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/intelligent/),
[Octoplus](https://octopus.energy/octoplus/), [Greener Nights ends 31 Jul 2026](https://energy-stats.uk/octopus-greener-days/),
[Emporia comparison](https://www.emporiaenergy.com/blog/home-energy-monitor-comparison/),
[Octopus GraphQL basics](https://developer.octopus.energy/rest/guides/api-basics).*
