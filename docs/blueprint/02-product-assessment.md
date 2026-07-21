# 02 — Product Assessment: Octopus Energy for Homey

> Blueprint deliverable · Workstream: **Product & UX Strategy** · Compiled 21 Jul 2026 against `main` @ `f53026d` / v1.0.20.
> Docs-only. Grounded in the repo (file:line) and external sources (URLs). See `_grounding.md` for the shared fact base.
> Cross-references `ROADMAP.md`, `docs/handover/sprints-42-48-spec.md`, `docs/handover/sprints-50-58-spec.md` — divergences are called out explicitly.

---

## 1. Executive summary (product)

**Octopus Energy for Homey (`uk.co.zarb.octopusenergy`)** is a mature, single-author, open-source **cloud-account integration** that
brings a UK Octopus Energy account into **Homey Pro** as first-class meter *devices* (electricity, gas, export) with live half-hourly
pricing, usage/cost, carbon intensity, Intelligent Octopus Go (IOG) dispatch awareness, Saving Sessions / Power-ups, and a very large
Flow surface (**33 triggers / 17 conditions / 13 actions**, `app.json`) plus **6 dashboard widgets**. It is TypeScript on Homey SDK v3
with **zero runtime dependencies** and **366 tests** (`_grounding.md §2`).

The product's defining quality is **provenance discipline**: it is unusually careful to label estimates, forecasts, and planned values as
such and never to present them as settled bills (`lib/freshness.ts:7-17`, `lib/effectiveRate.ts:1-30`, README "Features"). This is a
genuine, hard-to-copy differentiator against naive integrations that conflate telemetry with billing.

**Verdict:** The app is **feature-broad and trust-strong**, but sits **behind the ecosystem maturity benchmark** — the Home Assistant
`BottlecapDave/HomeAssistant-OctopusEnergy` integration — on three axes that matter to power users: **dispatch/EV *control* (not just read)**,
**target-rate ("rolling cheapest") automation**, and **settled historical insight / gas depth**
([DeepWiki: Intelligent Features](https://deepwiki.com/BottlecapDave/HomeAssistant-OctopusEnergy/5-intelligent-features)). Against its
*direct* Homey competitor (Tibber) it is **richer on Octopus-specific product features** but **weaker on turnkey smart-charging UX**
([Tibber on Homey](https://homey.app/en-us/app/com.tibber/Tibber/)). The single biggest product risk is not features — it is the
**~2,392-line `OctopusMeterDevice.ts` god-object** (`_grounding.md §2`) throttling safe delivery velocity, already recognised as **S52**.

---

## 2. Product overview

| Dimension | Reality (evidence) |
|---|---|
| **Category** | UK energy-supplier account integration for Homey Pro. Not a Zigbee/Z-Wave device; a REST + Kraken GraphQL cloud integration modelling meters as devices (`_grounding.md §1`). |
| **Platform** | Homey SDK v3, `compatibility >=12.4.0`, `platforms: ["local"]` — Homey Pro only, **no Homey Cloud/Bridge** (`app.json`). |
| **Drivers** | `electricity`, `export`, `gas` (`app.json` drivers). Each has a **repair flow** for credential rotation (`drivers/electricity/driver.compose.json:77`, gas:62, export:64). |
| **Capabilities** | 30 custom + system capabilities spanning pricing, smart-charge, carbon, energy/cost, account, gas (`app.json` capabilities). |
| **Widgets** | agile, carbon, export, price, summary, timeline — each carries a provenance badge (README; `widgets/`). |
| **Flow surface** | 33 triggers / 17 conditions / 13 actions incl. opt-in advanced planner/analytics cards (`app.json` flow). |
| **Data authority** | REST authoritative for settled/billed; GraphQL enrichment fails closed (`sprints-50-58-spec.md` REQ-002/003). |
| **Rate budget** | Shared per-account Kraken budget ~≤90/hr against a ~100–125/hr/account ceiling shared across *all* apps (`lib/KrakenBudget.ts`; [Octopus GraphQL basics](https://developer.octopus.energy/rest/guides/api-basics)). |
| **Release state** | v1.0.20/Build 20 uploaded 21 Jul 2026; Build 13 live, Build 17 in certification; open IOG field-verification gate (`HANDOVER.md`). |
| **Localisation** | **English only** — `locales/en.json` is the sole locale; `app.json` `name` has only `en` (verified). A real i18n gap. |

---

## 3. User personas

> Six personas, ordered from mainstream to niche. Each lists their **job-to-be-done**, what the app does well for them **today**, and their
> **top unmet need**. These drive the journeys (§4) and the spec (`13-product-specification.md`).

### P1 — New / mainstream user ("I just switched to Octopus")
- **JTBD:** "See my tariff, balance, and today's cost without reading a manual."
- **Today:** Pairing needs API key + account number; meters auto-discover (README "Setup"). Summary widget + provenance badges give an honest at-a-glance view.
- **Unmet need:** Guided onboarding (where to find the API key), and a *first-run* "what can I do now?" nudge. No in-app tour.

### P2 — Power user / automator ("I live in Advanced Flow")
- **JTBD:** "Automate appliances around the cheapest/greenest half-hours."
- **Today:** Very rich Flow surface incl. `relative_price_band_is`, `analyse_price_day`, tie-strategy planners (`app.json`).
- **Unmet need:** A **rolling target-rate** primitive ("cheapest 3h before 7am, re-evaluated as prices publish") — the single most-copied HA feature ([BottlecapDave target-rate entities](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/)).

### P3 — EV / Intelligent Octopus Go owner
- **JTBD:** "Charge my car cheaply/greenly and know when a smart dispatch is running."
- **Today:** Dispatch truth model (planned/active/completed/cancelled/changed), `octopus_dispatching`, opt-in estimated effective rate (`lib/dispatch/`, `lib/effectiveRate.ts`).
- **Unmet need:** **Dispatch *control*** (bump-charge / set ready-by / target SoC) and honest "guaranteed off-peak vs bonus" clarity. Read-only today by design.

### P4 — Solar / export (SEG/Flux) owner
- **JTBD:** "Use/sell energy when export is most valuable."
- **Today:** Export driver, `is_peak_export_now`, `find_peak_export_slot_advanced`, `plan_export_advanced`, earnings capabilities (`app.json`).
- **Unmet need:** **Paired import↔export optimisation** and battery/Flux-aware recommendations (planned S58).

### P5 — Installer / prosumer setting up for others
- **JTBD:** "Configure once, reliably, for a client; recover credentials without a re-pair."
- **Today:** Repair flow exists for key rotation (`drivers/*/repair/start.html`). Privacy-safe diagnostics.
- **Unmet need:** Multi-account clarity, a health/status page, exportable config notes. No installer-facing docs.

### P6 — Developer / contributor
- **JTBD:** "Understand the code, extend it, ship a PR that passes CI."
- **Today:** Strong docs (`ROADMAP.md`, `HANDOVER.md`, sprint specs), 366 tests, clean lint/audit gates (`_grounding.md §2,§6`).
- **Unmet need:** The god-object (`OctopusMeterDevice.ts` 2,392 LOC) is a contribution barrier — S52 addresses it.

---

## 4. Core user journeys

For each journey: **happy path**, **friction/gaps**, and a **✅ what exists / ⚠ what's missing** note grounded in the repo.

### J1 — Onboarding / pairing
Add Electricity/Gas device → enter API key + account number → meters auto-discovered (README "Setup"; `OctopusMeterDriver.ts`).
- **Friction:** User must self-source the API key from Octopus *Developer settings*; no in-app deep-link/help beyond text. No pre-validation of "does this account have IOG/export?" before device creation.
- ✅ Repair flow recovers a rotated key without re-pair (`drivers/electricity/driver.compose.json:77`). ⚠ No onboarding tour / capability primer.

### J2 — Daily price-aware automation
Power user builds a Flow: *when `price_plunge`* or *within `within_cheapest_period`* → run appliance (`app.json` triggers/conditions).
- ✅ Deep card set incl. relative price bands and percentile conditions. ⚠ No **rolling target-rate** trigger; users must hand-roll windows with `find_cheapest_hours` + logic.

### J3 — EV smart-charging (IOG)
Dispatch poller reconciles planned/active dispatches → `dispatch_started/ended/changed/cancelled` triggers → user reacts (`lib/DispatchPoller.ts`, `app.json`).
- ✅ Honest SMART vs BOOST modelling; never assumes a discount on whole-home import (`lib/effectiveRate.ts:5-20`). ⚠ **Read-only** — cannot set ready-by / target SoC / trigger a bump from Homey (deferred, S57 research-only).

### J4 — Cost tracking
`octopus_cost_today/yesterday/month/projected`, billing-period summary in settings (`app.json`, `lib/billing/`).
- ✅ REST-authoritative, restart-safe recomputation, projection labelled estimate. ⚠ No **historical insights widget** (day/week/month group_by) — planned S54; no in-widget cost drill-down yet.

### J5 — Tariff comparison
`find_best_tariff` action + `lib/compare.ts` (50 LOC) (`app.json`).
- ✅ Exists and is deliberately conservative. ⚠ Thin: limited product coverage, no standing-charge-accurate simulation, no eligibility/confidence — S55 "Tariff comparison 2.0" is the fix. **Risk:** a shallow comparison could mislead (RISK-055-MISLEAD).

### J6 — Failure / recovery
Kraken 429/5xx → soft-skip retains last value + provenance badge flips to Stale; expected rate-limit skips no longer surface as errors (`HANDOVER.md` IOG section; `lib/freshness.ts:55-58`).
- ✅ Fail-closed, budget-aware, repair flow for auth. ⚠ Settings currently swallow some get/set errors (planned S53c); no user-facing "connection health" panel.

---

## 5. Product vision (proposed)

> *"The most **trustworthy** way to run your home around your Octopus tariff — honest about what's settled vs estimated, gentle on your
> API allowance, and powerful enough to automate every cheap/green half-hour."*

Three pillars, all consistent with existing invariants (REQ-002/003/004):
1. **Trust by construction** — provenance/estimate labelling is the brand, never a footnote.
2. **Budget-respecting depth** — every new feature lives within the shared Kraken budget (F0).
3. **Automate the half-hour** — first-class primitives (target-rate, dispatch-aware, budget guardrails) so users don't hand-roll logic.

⚠ **Cross-discipline note:** Pillar 3 pushes toward *more* GraphQL-backed features (dispatch control, target-SoC). The architect/reliability
workstream will rightly flag this against SEC-001 (budget) and RISK-057-SCHEMA (versionless schema). The reconciliation is **read-first,
consent-gated writes** — already the roadmap's stated stance (S57 / PAT-002), which I endorse.

---

## 6. Strengths

1. **Provenance/estimate discipline** — a category-leading trust posture (`lib/freshness.ts`, `lib/effectiveRate.ts`). Rare even vs HA.
2. **Breadth of Octopus-specific coverage** — IOG dispatches, Saving Sessions/Power-ups, Octoplus points, carbon, export, all in one app (`app.json`).
3. **Budget-safe engineering** — shared per-account Kraken budget with priority classes (`lib/KrakenBudget.ts`) — directly addresses the real ~100–125/hr shared ceiling ([Octopus GraphQL basics](https://developer.octopus.energy/rest/guides/api-basics)).
4. **Large, opt-in Flow surface** including advanced planner/analytics with deterministic tie strategies (`lib/planner/tie.ts`, `lib/analytics/priceAnalytics.ts`).
5. **Repair flow already shipped** for API-key rotation on all three drivers (`drivers/*/repair/`) — corrects the `_grounding.md §4` hypothesis that no repair flow exists.
6. **Engineering hygiene** — zero runtime deps, 366 tests, hard CI gates (lint/audit/CodeQL), auto-release (`_grounding.md §2,§6`).
7. **Excellent internal documentation** — roadmap, handover, per-sprint specs enable multi-model/multi-author continuity.

## 7. Weaknesses

1. **God-object** `OctopusMeterDevice.ts` (2,392 LOC) concentrates refresh/pricing/IOG/cost/capabilities — velocity + regression risk (S52).
2. **No rolling target-rate** primitive — the most-requested dynamic-tariff automation, and a table-stakes feature vs HA and Tibber.
3. **Read-only dispatch** — no EV *control* (ready-by/target-SoC/bump) from Homey.
4. **Thin tariff comparison** (`lib/compare.ts` 50 LOC) — risk of misleading output until S55.
5. **No settled historical insights UI** (day/week/month) — planned S54.
6. **English-only** — no i18n despite Homey's multilingual audience (verified: single `en` locale).
7. **Onboarding is text-only** — no guided key retrieval or first-run primer.
8. **Doc staleness** — README "Current release" still says 1.0.18 (now 1.0.20) (`_grounding.md §6`).
9. **Gas is shallow by design** — no half-hourly gas; live-gas explicitly dropped (`sprints-42-48-spec.md §3`). Correct call, but a parity gap vs HA gas support.

## 8. Feature-gap analysis vs HA Octopus (BottlecapDave) + Tibber

| Capability | This app | HA Octopus (BottlecapDave) | Tibber (Homey) | Gap severity |
|---|---|---|---|---|
| Half-hourly Agile/Go pricing | ✅ (`app.json`) | ✅ | ✅ | — |
| Provenance/estimate labelling | ✅✅ (differentiator) | ⚠ partial | ⚠ minimal | **We lead** |
| Intelligent dispatch (read) | ✅ (`lib/dispatch/`) | ✅ | n/a (not Octopus) | — |
| **Intelligent dispatch (control / bump / ready-by)** | ❌ read-only | ✅ ([intelligent entities](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/intelligent/)) | ✅ smart charge | **High** |
| **Rolling target-rate sensors** | ❌ (manual via cards) | ✅ ([target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/)) | ⚠ cheapest-hours only | **High** |
| Turnkey EV smart-charging | ⚠ react-only | ⚠ via automations | ✅✅ set-and-forget ([Tibber](https://homey.app/en-us/app/com.tibber/Tibber/)) | **Med/High** |
| Saving Sessions / Power-ups | ✅ (`SavingSessionsPoller.ts`) | ✅ + Wheel of Fortune | n/a | Med (no auto-join/gamification) |
| Settled cost history (day/wk/mo) | ⚠ planned S54 | ✅ cost trackers | ⚠ via Pulse | Med |
| Gas depth | ⚠ shallow | ✅ full gas rate/consumption | n/a | Med |
| Greenness/carbon forecast automation | ⚠ carbon level only | ✅ greenness sensors | ❌ | Med |
| Tariff comparison | ⚠ thin (S55) | ✅ | ❌ | Med |
| Budget/bill guardrails | ⚠ projection only (S54) | ⚠ cost sensors | ⚠ HA-community | Med |
| Multi-account household | ⚠ per-device account | ✅ | ⚠ | Low/Med |
| i18n | ❌ en-only | ✅ (HA translations) | ✅ | Med |
| Widgets on Homey dashboard | ✅ 6 native widgets | ❌ (HA is dashboards) | ⚠ 1 | **We lead** |
| Repair / re-auth flow | ✅ (`drivers/*/repair/`) | n/a | ⚠ | We lead (on Homey) |

**Reading:** We **lead on trust and native Homey UX (widgets, repair)**; we **trail on target-rate automation, dispatch control, settled
insights, and i18n**. None of the trailing gaps require abandoning the trust posture — they are additive (see `19-future-ideas...`).

## 9. Documentation quality assessment

- **Developer docs: excellent.** `ROADMAP.md` (342 lines), `HANDOVER.md`, `sprints-42-48-spec.md`, `sprints-50-58-spec.md` give unusually
  strong continuity, explicit invariants, risks, and a rejected-ideas list. Multi-model workflow is well recorded.
- **User docs: adequate but thin.** README covers setup/features honestly; no user guide for Flow recipes, no onboarding walkthrough, no
  troubleshooting page for the common IOG "blank price" symptom.
- **Findings:** (a) README release line stale at 1.0.18 vs 1.0.20 (`_grounding.md §6`); (b) no `CHANGELOG` surfaced to users beyond
  `.homeychangelog.json`; (c) no per-Flow-card examples. **Recommendation:** add a short "Flow cookbook" + "Troubleshooting" page and a
  README currency test (one already exists per `HANDOVER.md` — extend it).

## 10. Community engagement

Support is centred on **community.homey.app/t/156860** (`_grounding.md §6`). The visible thread activity is **incident-driven** — most
notably the long-running IOG "day rate blank" case (Darren), which drove v1.0.18→v1.0.20 fixes and remains an open **field-verification
gate** (`HANDOVER.md`). **Observations:** the author is highly responsive and evidence-led (drafted replies, diagnostic census), which is a
community strength; but engagement is **reactive** (bug threads) rather than **proactive** (feature announcements, recipe sharing, changelog
posts). **Recommendation (product):** a lightweight release-notes + "what's new / try this Flow" cadence on the topic would convert incident
traffic into adoption. This is a low-effort, high-retention move.

---

## 11. Strengths / Weaknesses / Gaps — at a glance

| Strengths | Weaknesses | Top gaps (vs HA + Tibber) |
|---|---|---|
| Provenance/estimate discipline (differentiator) | 2,392-LOC god-object (S52) | Rolling **target-rate** automation |
| Broad Octopus feature coverage | No rolling target-rate primitive | Dispatch **control** (ready-by/SoC/bump) |
| Shared Kraken budget (real constraint) | Read-only dispatch (no control) | Turnkey EV smart-charging UX |
| 6 native widgets + repair flow | Thin tariff comparison (S55) | Settled cost **history/insights** UI |
| Zero-dep, 366 tests, hard CI gates | No settled-insights UI (S54) | i18n / localisation |
| Strong developer docs | English-only; text-only onboarding | Gas depth; greenness automation |

---

## 12. Alignment with existing plans (agree / extend / diverge)

- **Agree:** S51 budget hardening and **S52 decompose** are correctly the top priorities — product velocity depends on them. Dropping
  shippable live-gas (`sprints-42-48-spec.md §3`) is the right trust call.
- **Extend:** S54 (insights + budget Flows) and S55 (comparison 2.0) map directly to my §8 gaps — I'd raise **budget/bill guardrails**
  within S54 to a headline user-facing win (see `11-flow-card-opportunity-report.md`).
- **Diverge (mild):** The roadmap treats **target-rate** only implicitly (via S47 planner cards). I argue a **first-class rolling
  target-rate trigger/condition** deserves its own line item — it is the highest-impact automation gap and is REST-only (low budget cost).
  ⚠ Cross-discipline note: engineering may prefer to keep it as a pure planner action to avoid stateful re-evaluation on the device; I
  recommend a *stateless, re-computed-on-`rates_published`* design to satisfy both (detailed in report 11).

---

*Sources: repo files cited inline; external — [BottlecapDave HA Octopus](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/),
[DeepWiki intelligent features](https://deepwiki.com/BottlecapDave/HomeAssistant-OctopusEnergy/5-intelligent-features),
[Tibber on Homey](https://homey.app/en-us/app/com.tibber/Tibber/), [Octopus GraphQL basics](https://developer.octopus.energy/rest/guides/api-basics),
[Octopus Saving Sessions](https://octopus.energy/saving-sessions/), [Octoplus](https://octopus.energy/octoplus/),
[Greener Nights ends 31 Jul 2026](https://energy-stats.uk/octopus-greener-days/).*
