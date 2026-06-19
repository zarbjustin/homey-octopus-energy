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

## Phase 2 — recommended next sprints
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

