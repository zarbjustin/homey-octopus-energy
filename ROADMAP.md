# Octopus Energy for Homey — Build Roadmap

A feature-rich Homey Pro app integrating the Octopus Energy REST (and later GraphQL) API:
energy monitoring, dynamic-pricing intelligence, and a rich set of Flow cards.

App: `uk.co.zarb.octopusenergy` · Repo: `zarbjustin/homey-octopus-energy`

## Design decisions (confirmed)
- Purpose: full account dashboard (meters, tariff, balance, usage, pricing).
- Device model: **separate devices per meter** — Electricity Meter + Gas Meter.
- Each meter device carries: consumption/usage, current unit rate, standing charge, **account balance** (duplicated on both).
- Electricity device: full dynamic-pricing Flow cards.
- Pairing: user enters **API key + account number**; meters auto-discovered.
- Language: TypeScript, SDK v3, Homey Compose (`.homeycompose`).

## API notes
- Base `https://api.octopus.energy/v1/`, JSON, paginated, ISO-8601 (always `Z`).
- Auth: HTTP Basic — API key as username, blank password.
- Key endpoints: `/accounts/{n}/`, `/products/{p}/electricity-tariffs/{t}/standard-unit-rates/`,
  `/standing-charges/`, `/electricity-meter-points/{mpan}/meters/{serial}/consumption/`, gas equivalents.
- Tariff code → product code: strip `^[EG]-\dR-` and trailing `-[A-P]` (region).

## Future backlog - Sprints 40-48

Priorities reflect dependencies and user impact. Each sprint should preserve existing
capability and Flow IDs unless a migration is explicitly documented.

40. **COMPLETE - Security PR #1 reconciliation** - selectively ported manual redirect
    handling, HTTPS/origin enforcement, redacted API errors, standards-compliant
    `Retry-After` backoff, pagination validation, and pair-session isolation onto current
    `main`. The current identity-safe repair lifecycle and valid Octopus account-format
    compatibility were preserved; the original PR and branch are superseded.
41. **P0 - Kraken collaboration and contract research** - agree attribution and reuse
    boundaries with David Piper; capture sanitised GraphQL fixtures; document Home Mini,
    Intelligent Octopus, device, dispatch, and relative-price semantics before coding.
42. **P0 - Shared Home Mini live-data poller** - add an account-scoped poller with
    configurable 1/2/3/5-minute cadence, request deduplication, freshness timestamps,
    backoff, lightweight diagnostics, and separate fast/slow refresh paths.
43. **P0 - Intelligent dispatch truth model** - model linked smart devices, SMART versus
    BOOST dispatches, multiple devices, overlaps, late changes, DST, and Octopus's
    midday-to-midday dispatch limit; distinguish dispatch windows from settlement prices.
44. **P1 - Dispatch and effective-price Flows** - expose current/next dispatch details,
    device and dispatch type tokens, effective import price, and the finalised previous
    half-hour price while retaining all existing Flow card IDs.
45. **P1 - Billing-period summary** - discover the billing-period start with a user
    override and report import, export, cost/value, standing charge, net position,
    projection, and confidence; rebuild official REST history after restart.
46. **P1 - Live-energy presentation** - expose import, export, and net demand with source
    timestamp and freshness while preserving `measure_power` and Homey Energy behaviour.
47. **P2 - Planner and tariff analytics** - add earliest/latest/random tie strategies,
    richer import/export plan tokens, relative daily price bands, negative-price and spike
    handling, weighted averages, off-peak share, and estimated savings.
48. **P3 - Estimated live-gas pilot** - investigate an opt-in GraphQL estimate, label it
    clearly as estimated or stale, and reconcile it against official REST consumption
    before considering general release.

### Backlog gates
- Sprints 40-43 require focused unit and integration fixtures before release work begins.
- Experimental GraphQL fields must fail closed and must not replace official REST billing
  data without reconciliation.
- Features derived from `com.kraken.energy` require David Piper's explicit permission and
  appropriate attribution before implementation is merged.

## Sprints
1. **Foundation & API client** — tsconfig/types fix, `OctopusClient`, account/tariff helpers, unit tests.
2. **Electricity meter device (core)** — driver, custom pairing, discovery, price/standing-charge/balance, refresh.
3. **Homey Energy integration** — cumulative `meter_power` from consumption, usage + cost capabilities.
4. **Gas meter device** — driver, pairing, capabilities, gas energy integration.
5. **Dynamic pricing intelligence** — upcoming-rate cache, cheapest-slot, cheapest-N-hours, price levels.
6. **Rich Flow cards** — triggers/conditions/actions for price + cheapest-slot automations.
7. **Insights, reporting & settings** — insights logging, app/device settings, balance tokens.
8. **Robustness & polish** — 401/429 handling, unavailable states, localization, README, assets, validate.
9. **Real-time consumption (Octopus Home Mini)** — GraphQL Kraken token, `smartMeterTelemetry` → live `measure_power`.
10. **Dashboard widget** — current price / cheapest slot / usage summary.

## Phase 5 - COMPLETE: Bug bash hardening (Sprints 33-39)

Released as `v1.0.10`, installed on the local Homey Pro, and submitted as Homey
Build 10 for certification. All 44 tests pass; lint, audit, and publish
validation are clean apart from the two intentional cumulative-direction warnings.

33. **Automation correctness** - current-slot planning, contiguous windows, and complete energy plans.
34. **Refresh resilience** - bounded requests, generation-safe refresh locks, stale-price health, and poller single-flight.
35. **Meter and account safety** - identity-safe repair plus account-scoped dispatch and Saving Session state.
36. **Release security** - immutable Actions, least-privilege workflow tokens, authenticated-origin checks, and aligned runtime metadata.
37. **API optimisation** - in-flight balance deduplication, refresh caching, parallel independent calls, and tariff-specific timers.
38. **Integration coverage** - device planning, poller history, multi-account state, flow contracts, and release-policy tests.
39. **Reporting accuracy** - historical standing charges, DST-safe deadlines, stale dispatch expiry, and responsive settings.

Release commits are tagged by semantic app version.

## Multi-model review (Opus + GPT-5.5 code review, Sonnet feature review)

## Maintenance notes
- Dependency audit is clean with ESLint 8 plus a targeted `minimatch` override.
- `.npmrc` keeps `legacy-peer-deps=true` because Athom's current Homey ESLint
  config still declares older ESLint peer ranges. Revisit when
  `eslint-config-athom` supports the newer `eslint-plugin-homey-app@2` /
  ESLint 10 stack without raising the app's Node support beyond Homey's target.
- Homey publish validation intentionally keeps the import-only/export-only
  cumulative energy warnings visible; see the README publishing section.

### Resolved code-review findings that drove Sprints 26-39
- HIGH: budget/threshold "above/below" triggers re-fire every refresh (rolling 24h value changes constantly) — need crossing semantics.
- HIGH: no single-flight guard on refresh() → concurrent runs over-count the cumulative meter (read-modify-write race); store writes of cumulativeMeter + lastConsumptionEnd are non-atomic.
- HIGH: repair updates store creds but never rebuilds OctopusClient/KrakenClient → stale API key until restart; repair also doesn't update mpxn/serial identity.
- MEDIUM: localMidnight/localMonthStart use fixed 86,400,000 ms days → DST/month drift in price stats + monthly cost.
- MEDIUM: Economy 7 cost mispriced — night usage charged at day rate; monthly cost 404s for 2R tariffs.
- MEDIUM: activeTariff() can pick a future open-ended agreement (valid_from in future).
- MEDIUM: health treats any one successful sub-refresh as healthy → masks persistent price-fetch outage.
- LOW: saving_session_starting_soon can double-fire; KrakenClient lacks res.ok check/backoff; getDemand assumes array order = recency; enableLivePower can leak interval; pollers duplicate credentials/fmt/fire/notify (extract AccountPoller base).

### Feature-review Top additions
Agile new-rates-published trigger; export Flow triggers + parity (level/standing/earnings month/widget); gas Flow cards + gas embedded carbon; regional carbon + generation mix %; target-rate percentile condition; E7 night-rate condition/trigger; EV bump-charge; completed-dispatches trigger; tariff-change alert; adaptive refresh cadence; balance dedup; pairing key validation; calendar yesterday + peak/off-peak cost; next-charge-start capability.

## Phase 4 — COMPLETE (Sprints 26–32) + original branding
All built, validated at publish level, 26 tests passing, lint clean, reinstalled on the Homey Pro, pushed.
26. Correctness & reliability — refresh single-flight, atomic/cursor-safe cumulative meter, threshold-crossing triggers, repair rebuilds clients + identity, future-tariff fix
27. Time & tariff accuracy — DST-safe boundaries, Economy 7 register-aware cost, health price-failure, KrakenClient hardening, shared AccountPoller, starting-soon dedup
28. Export & Gas parity — export rate triggers + earnings month/projected + standing charge + widget; gas Flow cards + gas embedded carbon
29. Rate intelligence — Agile new-rates trigger, percentile condition, E7 night-rate cards, saving% token, next-charge-start capability
30. Carbon & green — regional carbon intensity + generation-mix renewable %
31. IOG deepening — completed-dispatch + bump-charge + tariff-change alert + repair-on-401 notification
32. API optimisation & UX — balance dedup cache, pairing validation, calendar-yesterday + peak/off-peak cost, adaptive cadence
Branding: original octopus app icon + images (NOT Octopus Energy's copyrighted mascot/logo).

## Phase 4 — recommended sprints (from the review)
26. **Correctness & reliability** — refresh single-flight + atomic/cursor-safe cumulative meter; threshold-crossing triggers; rebuild clients + full identity on repair; activeTariff ignores future agreements.
27. **Time & tariff accuracy** — DST-safe local boundaries; Economy 7 register-aware cost; health reflects price failure; KrakenClient hardening; shared AccountPoller; starting-soon dedup.
28. **Export & Gas parity** — export rate triggers + level/standing/earnings-month + widget; gas Flow cards + gas embedded carbon.
29. **Rate intelligence** — Agile new-rates trigger; percentile target-rate condition; E7 night-rate cards; saving% token; next-charge-start capability.
30. **Carbon & green** — regional carbon intensity; generation-mix renewable % + condition.
31. **IOG deepening** — EV bump-charge (best-effort); completed-dispatches trigger; repair-on-401 notification; tariff-change alert.
32. **API optimisation & UX** — adaptive refresh cadence; balance dedup cache; tighter consumption fetch; poller back-off; pairing validation; calendar/peak-offpeak cost; widget compact mode.


## Status: Sprints 1–10 COMPLETE
All built, validated at publish level (12 tests pass, lint clean), committed and
pushed to zarbjustin/homey-octopus-energy. App lives at C:\Users\jzarb\octopusenergy.
Only validator note: expected "missing cumulativeExportedCapability" (import-only meter).

## Phase 2 — COMPLETE (Sprints 11–18)
All built, validated at publish level, 22 tests passing, lint clean, committed and pushed.
11. Export / SEG meters — done
12. Smart-charge planner — done
13. Saving Sessions — done
14. Intelligent Octopus Go dispatches — done
15. Carbon intensity — done
16. Reporting & cost aggregation — done
17. Tariff comparison — done
18. Quality, localization (nl/de/fr) & publish prep — done

Shipping status: superseded by `v1.0.10`, which is currently in Homey certification.

## Phase 3 — COMPLETE (Sprints 19–25)
All built, validated at publish level, 23 tests passing, lint clean, committed and pushed.
19. Economy 7 / two-register tariffs — done
20. Health, status & resilience (connection alarm, last-updated) — done
21. Proactive notifications (plunge, saving sessions, dispatch, low balance) — done
22. Octoplus points & Free Electricity — done
23. Best-time intelligence + EV/battery charge planner — done
24. More widgets (timeline, carbon, summary) — done
25. CI hardening, localization pass (nl/de/fr titles), manual pairing override — done

## Phase 3 — recommended next sprints
19. **Economy 7 & multi-register tariffs** — detect E-2R/2-register meters; day/night
    unit-rate capabilities; register-aware cost. (Fixes the single-rate assumption — real gap.)
20. **Health, status & resilience** — alarm_generic connection alarm + last_updated
    capability; surface API/auth errors; settings-driven re-auth.
21. **Proactive notifications** — opt-in Homey timeline notifications for plunge prices,
    saving sessions, low balance, dispatch start.
22. **Octoplus & Free Electricity** — points balance, referral credit, Free Electricity
    sessions (distinct from Saving Sessions).
23. **Combined best-time intelligence + EV/battery planner** — blended price+carbon score
    + "good time to use power now" condition; target-SoC charge-schedule action.
24. **More widgets** — cheapest-slots timeline, carbon, balance/usage widgets.
25. **Full localization + CI hardening** — complete nl/de/fr; add test + validate to CI;
    manual product/region/MPAN override in pairing for discovery edge cases.

## Phase 2 — recommended next sprints (delivered above)
11. **Export / SEG meters** — model export meters (meter_power.exported + Outgoing/
    Agile Outgoing tariff + earnings). Also clears the export-capability warning.
12. **Smart-charge planner** — non-contiguous cheapest-N-slots, `smart_charge` boolean
    capability, "now is in the plan" condition; ideal for EV/immersion automations.
13. **Saving Sessions & Free Electricity** — GraphQL triggers (announced/starting/started),
    Octoplus points.
14. **Intelligent Octopus Go dispatches** — plannedDispatches/completedDispatches →
    "smart charge dispatch started"; expose next dispatch window.
15. **Carbon intensity** — National Grid Carbon Intensity → "greenest slot" automations.
16. **Reporting** — today min/max/avg/next price capabilities; month-to-date + projected
    bill (incl. standing charge); daily/weekly summaries.
17. **Tariff comparison** — estimate savings vs Agile/other products from real usage.
18. **Quality & reach** — inject HTTP layer for cost/gas/planner tests with fixtures;
    persist rates + align refresh to ~16:00 Agile publication; localization (nl/de/fr);
    real branding/screenshots; wire publish workflow to Homey token and certify.
