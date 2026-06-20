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

Commits are tagged `Sprint N: ...` (mirrors the Vestaboard app convention).

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

Remaining to actually ship: add a HOMEY_PAT repo secret and run the Publish workflow
(or `homey app publish`), then complete certification in the Homey Developer Tools.

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

