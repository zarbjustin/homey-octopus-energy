# 12 — Competitive Analysis

> Blueprint deliverable · Workstream: **Product & UX Strategy** · v1.0.20 · Docs-only.
> Compares Octopus Energy for Homey against: **HA Octopus (BottlecapDave)**, **Tibber (Homey)**, **Frank Energie (Homey)**, and
> **generic energy monitors (Shelly / Sense / Emporia)**. Grounded in `app.json`/`_grounding.md` and cited external sources.

---

## 1. The competitive set (and why each matters)

| Competitor | Category | Why it's the benchmark |
|---|---|---|
| **HA Octopus (BottlecapDave)** | Open-source Octopus integration (Home Assistant) | The **maturity benchmark** — most feature-complete Octopus integration anywhere ([DeepWiki](https://deepwiki.com/BottlecapDave/HomeAssistant-OctopusEnergy/5-intelligent-features)) |
| **Tibber (Homey)** | Dynamic-tariff supplier app on Homey | The **direct on-platform competitor** — mature smart charging, polished UX ([homey.app/com.tibber](https://homey.app/en-us/app/com.tibber/Tibber/)) |
| **Frank Energie (Homey)** | Dynamic-tariff supplier app (NL) on Homey | Same *pattern* (supplier → Homey Flows) in another market; shows dynamic-price + smart-charge norms ([homey.app/nl.frank-energie](https://homey.app/en-gb/app/nl.frank-energie/Frank-Energie/)) |
| **Shelly / Sense / Emporia** | Hardware energy monitors | The **substitute** — users often reach for circuit-level HW instead of a supplier app ([SmartHomeExplorer 2026](https://www.smarthomeexplorer.com/guides/best-whole-home-energy-monitors-2026)) |

---

## 2. Feature parity / gap matrix

Legend: ✅ full · ⚠ partial/planned · ❌ none · **n/a** not applicable.

| Feature | **This app** | HA Octopus | Tibber | Frank Energie | Shelly/Sense/Emporia |
|---|---|---|---|---|---|
| Half-hourly Agile/Go pricing | ✅ | ✅ | ✅ | ✅ | ❌ (no tariff) |
| **Provenance / estimate labelling** | ✅✅ | ⚠ | ⚠ | ⚠ | ❌ |
| Native Homey meter devices | ✅ (3 drivers) | n/a (HA) | ✅ | ✅ | ✅ (HW) |
| Homey dashboard widgets | ✅ 6 | ❌ (HA dashboards) | ⚠ 1 | ⚠ | ⚠ |
| Repair / re-auth flow | ✅ (`drivers/*/repair/`) | n/a | ⚠ | ⚠ | ⚠ |
| Intelligent dispatch (read) | ✅ | ✅ | n/a | n/a | ❌ |
| **Dispatch control (bump/ready-by/SoC)** | ❌ | ✅ | ✅ (smart charge) | ✅ (Jedlix) | ❌ |
| **Rolling target-rate automation** | ❌ (manual) | ✅ | ⚠ (cheapest-hours) | ⚠ | ❌ |
| Turnkey EV smart-charging | ⚠ react-only | ⚠ automations | ✅✅ | ✅ (Jedlix/VPP) | ❌ |
| Saving Sessions / Power-ups | ✅ | ✅ (+Wheel of Fortune) | n/a | n/a | ❌ |
| Octoplus points | ✅ | ✅ | n/a | n/a | ❌ |
| Settled cost history (day/wk/mo) | ⚠ (S54) | ✅ | ⚠ (Pulse) | ✅ | ✅ (device-level) |
| **Circuit/appliance-level monitoring** | ❌ (whole-home) | ⚠ (via HA + HW) | ⚠ (Pulse) | ⚠ | ✅✅ |
| Gas depth | ⚠ shallow | ✅ | n/a | n/a | ⚠ (HW) |
| Carbon intensity / renewables | ✅ | ✅ | ❌ | ⚠ | ⚠ (Sense) |
| Greenness/carbon-forecast automation | ⚠ | ✅ | ❌ | ⚠ | ❌ |
| Tariff comparison | ⚠ thin (S55) | ✅ | ❌ | ⚠ | ❌ |
| Budget / bill guardrails | ⚠ projection (S54) | ⚠ | ⚠ | ✅ | ⚠ |
| Export/SEG value | ✅ | ✅ | ⚠ | ✅ | ⚠ |
| Solar/battery/VPP optimisation | ⚠ (S58) | ⚠ | ✅ solar | ✅✅ (VPP) | ⚠ |
| Multi-account household | ⚠ | ✅ | ⚠ | ⚠ | n/a |
| i18n / localisation | ❌ en-only | ✅ | ✅ | ✅ (NL) | ✅ |
| Rate-limit/budget discipline | ✅✅ (F0) | ⚠ (user-tunable) | n/a (own backend) | n/a | n/a |
| Zero runtime deps / OSS hygiene | ✅✅ | ✅ (Python) | n/a (closed) | n/a (closed) | n/a |

---

## 3. Where this app already wins (differentiators)

1. **Provenance & estimate-labelling discipline.** The app's refusal to present estimated/planned/telemetry as settled
   (`lib/freshness.ts:7-17`, `lib/effectiveRate.ts:1-20`) is a *structural* trust advantage. Even the HA benchmark surfaces raw sensors
   that users can misread; here the honesty is enforced in code and UI. **This is the moat — everything else is catch-up.**
2. **Native Homey UX.** 6 dashboard widgets + a repair/re-auth flow on all drivers (`drivers/*/repair/`) beat every peer *on Homey* —
   HA has no Homey widgets; Tibber ships minimal widget surface ([Tibber](https://homey.app/en-us/app/com.tibber/Tibber/)).
3. **Budget-safe engineering.** The shared per-account Kraken budget (`lib/KrakenBudget.ts`) directly answers the real ~100–125/hr shared
   ceiling ([Octopus GraphQL basics](https://developer.octopus.energy/rest/guides/api-basics)) — a correctness edge HA leaves to user tuning.
4. **Relative/advanced price analytics as Flow cards** (`price_percentile_below`, `relative_price_band_is`, `analyse_price_day`) — deeper
   than Tibber's card set out of the box.
5. **Octopus-specific breadth in one Homey app** — IOG, Saving Sessions/Power-ups, Octoplus, carbon, export — no other Homey app matches it.

## 4. Where competitors win (must-address)

1. **HA — dispatch *control* + target-rate + gas depth + gamification** (Wheel of Fortune)
   ([intelligent](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/intelligent/),
   [target-rate](https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/entities/target-rate/)).
2. **Tibber — turnkey EV smart-charging UX**: set ready-by time, done; solar-aware ([Tibber solar smart charging](https://tibber.com/en/magazine/power-hacks/solar-smart-charging)).
3. **Frank Energie — VPP / grid-fee-aware smart charging** via Jedlix ([Jedlix × Frank](https://www.jedlix.com/news/enabling-smart-charging-on-dynamic-tariffs-and-vpp-for-the-frank-energie-app)).
4. **Shelly/Emporia/Sense — circuit/appliance-level truth**: they answer "which appliance is costing me money?" that a whole-home supplier
   app fundamentally can't ([Emporia comparison](https://www.emporiaenergy.com/blog/home-energy-monitor-comparison/)).

## 5. What to copy vs what to avoid

### Copy (high-confidence)
- **Rolling target-rate sensors/cards** (HA) — the single most-copied pattern; REST-only, on-budget. → reports 10 (W1) & 11 (rank 1).
- **Budget/bill guardrails** (Frank/Tibber ecosystems) — mainstream bill-anxiety win. → reports 10 (W3) & 11 (rank 2).
- **Settled cost-history trackers** (HA) — day/week/month, "settled through" honesty. → S54; report 10 (W2).
- **Turnkey EV UX affordances** (Tibber) — *read-only first*: show ready-by/target where the schema confirms, before any write.
- **Event/engagement surfacing** (HA Wheel of Fortune / Octoplus) — a Saving-Sessions/Power-ups widget + reminders. → report 10 (W4), S56.

### Avoid (deliberate non-goals)
- **Silent auto-join / auto-charge / auto-switch** — the roadmap already rejects these unanimously (`sprints-50-58-spec.md` "Explicitly
  rejected"). Correct: they break the trust moat and the consent principle.
- **Presenting telemetry/estimates as settled** — the exact class of the v1.0.13/IOG incident; never regress it (REQ-002/004).
- **Building on Greener Nights** — it **ends 31 Jul 2026** ([source](https://energy-stats.uk/octopus-greener-days/)); use carbon-intensity
  forecast instead (RISK-058-DEPRECATION).
- **Circuit-level monitoring** — out of scope for a supplier account app; **integrate** with Shelly/Emporia via Homey rather than compete
  (see §6). Chasing hardware parity would blow scope for no defensible win.
- **Sub-60s live polling / net metering off one signed Home Mini figure** — already rejected; would burn the Kraken budget (SEC-001).

## 6. Innovation opportunities (defensible, on-brand)

1. **"Trust score" as UX** — make provenance the visible product: a per-tile confidence/freshness legend users learn to rely on. No peer does this well.
2. **Cross-integration cost attribution** — combine this app's *tariff truth* with a Shelly/Emporia device's *circuit truth* in a Homey Flow
   ("cost of the EV circuit at the real half-hourly rate"). Turns the substitute (§1) into a complement — a uniquely-Homey play.
3. **Consent-gated dispatch control** — be the *honest* dispatch controller: explicit consent, rollback, estimate-labelled outcomes. Match
   HA's power with this app's trust posture (S57 track).
4. **Composite cheap-AND-green primitive** — a first-class "carbon-optimised" planner card (report 11) — Tibber/Frank don't surface carbon.
5. **Household rollup / multi-account** — a whole-home, multi-meter summary (report 10 W8) for prosumers/installers.

## 7. Strategic reading

The app's **right to win is trust + native Homey UX**, not feature-count parity with HA. The correct competitive posture is: **close the
three most-felt automation gaps (target-rate, budget guardrails, dispatch lookahead) using REST-derived, on-budget primitives**, keep
dispatch *control* as a carefully consent-gated track, and **complement rather than fight** hardware monitors. This preserves the moat while
neutralising the "HA does more" and "Tibber is easier" critiques.

⚠ **Cross-discipline note:** The reliability/architecture workstream should weigh the dispatch-control ambition (§6.3) against
RISK-057-SCHEMA (versionless Kraken writes). Product's position: pursue it, but **read-only + reference-client-verified first** (PAT-002) —
never as the opening move.

*Sources cited inline; additional: [Tibber Trustpilot/UX](https://www.trustpilot.com/review/tibber.com),
[Frank Energie on Homey](https://homey.app/en-gb/app/nl.frank-energie/Frank-Energie/), [Sense vs Emporia](https://glennsaid.com/emporia-vs-sense/),
[Octopus Saving Sessions](https://octopus.energy/saving-sessions/).*
