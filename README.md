# Octopus Energy for Homey

[Homey](https://homey.app) app that brings your **Octopus Energy** account into Homey — live half-hourly prices, energy usage and cost, standing charge, account balance, and a rich set of Flow cards for automating around dynamic (Agile/Go) pricing.

> Not affiliated with, or endorsed by, Octopus Energy.

## Features

- **Electricity**, **Gas**, and **Export/SEG** meter devices, auto-discovered from one or more accounts.
- Current **unit rate** and **standing charge** for your real tariff (Agile, Go, fixed, variable, Economy 7, …).
- **Price level** (plunge / cheap / normal / expensive) from thresholds you set.
- **Usage** and **cost** over the last 24 hours, plus a cumulative meter shown in **Homey Energy**.
- **Account balance**, Octoplus points, Saving Sessions, Free Electricity (Power Up), and Intelligent dispatches.
- Regional **carbon intensity**, renewable generation percentage, and price/carbon-aware charging plans.
- Agile, price, carbon, export, account summary, and upcoming-price timeline widgets, each showing a **provenance badge** (Current / Stale / Unknown) and clearly labelling app-derived recommendations and forecasts as **estimates**, never settled figures.
- Opt-in **estimated effective rate** for Intelligent Octopus Go on the summary widget — off by default, clearly labelled an estimate (never a bill or settlement), equal to your household unit rate with EV-device rates shown separately (enable it under Settings).
- **Flow cards**
  - Triggers cover prices, thresholds, charge windows, carbon, tariffs, dispatches (including `dispatch_cancelled` and `dispatch_changed`), account balance, and Saving Sessions.
  - Conditions cover cheapest/peak periods, price and carbon levels, renewables, dispatch state, account balance, and the `relative_price_band_is` relative price band.
  - Actions refresh data, plan price/carbon-aware charging, find export peaks, and compare tariffs.
  - **Advanced (opt-in) planner & analytics** with explicit earliest/latest/random tie strategies — `find_cheapest_slot_advanced`, `plan_charge_advanced`, `analyse_price_day` (electricity) and `find_peak_export_slot_advanced`, `plan_export_advanced` (export). Every output is an explicitly-labelled estimate.

## Setup

1. Get your **API key**: Octopus account → *Personal details* → *Developer settings*.
2. Find your **account number** (form `A-XXXXXXXX`), shown on your bills.
3. Add an **Electricity** or **Gas** Meter device and enter both when prompted.

Public tariff prices need no auth; consumption and balance use your API key.

## Development

```bash
npm install
npm run build        # tsc
npm test             # tsc + node --test
npm run lint         # eslint
homey app validate --level publish
homey app run        # run on a connected Homey
```

- TypeScript, Homey SDK v3, Homey Compose (`.homeycompose/`).
- API client in `lib/OctopusClient.ts` (REST) and `lib/KrakenClient.ts` (GraphQL, balance).
- Pure tariff helpers in `lib/rates.ts` (unit-tested in `test/`).
- Shared device/driver bases in `lib/OctopusMeterDevice.ts` and `lib/OctopusMeterDriver.ts`.
- Current release and operational context in [`HANDOVER.md`](HANDOVER.md).

## Current release

Source version `1.0.18` (Homey Build 18, in Test/certification). Sprints 42–47
are merged under this release: a shared Kraken request
budget and live-data poller, a device-aware dispatch truth model, a billing-period
summary, live-energy presentation and provenance badges, an opt-in estimated
Intelligent Octopus Go effective rate (never settlement), and an opt-in advanced
planner & tariff-analytics engine with earliest/latest/random tie strategies,
relative price bands, and negative-price/spike handling. Every estimated, planned,
or relative figure is labelled as such and is never presented as a settled bill.
The quality baseline is a clean lint and dependency audit, a full passing test
suite, and successful Homey publish validation. Version 1.0.18 also fixes the
Intelligent Octopus Go price gap (the household day/night rate now recovers from
your account agreement even after a tariff-code change) and stops expected API
rate-limit skips from surfacing as errors; that IOG recovery remains in Test and
is **not yet field-confirmed**.

## API reference

Octopus Energy REST + GraphQL: https://docs.octopus.energy/

## Publishing

CI workflows live in `.github/workflows/` (validate, version, publish).

To publish to the Homey App Store:

1. Create a **Homey Personal Access Token** at https://tools.developer.homey.app (Account → Personal Access Tokens).
2. Add it as a repository secret named `HOMEY_PAT` (Settings → Secrets and variables → Actions).
3. Run the **Publish Homey App** workflow (Actions tab → *Publish Homey App* → *Run workflow*), or locally:

   ```bash
   homey app publish
   ```

4. Finish the submission and certification in the Homey Developer Tools.

The app validates at `publish` level. Homey currently reports two expected
`energy.cumulative` warnings:

- `drivers.electricity` declares only `cumulativeImportedCapability` because an
  import meter should not report exported production.
- `drivers.export` declares only `cumulativeExportedCapability` because an SEG
  export meter should not report imported consumption.

Those warnings are intentionally left visible rather than adding fake zero-value
capabilities; the Homey publish validator still accepts the app.

## Security

Octopus API keys and account numbers are stored only in the Homey device store
and sent to Octopus Energy over authenticated HTTPS requests. Never include real
credentials in issue reports, screenshots, logs, or test fixtures. Report
suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
