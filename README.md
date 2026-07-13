# Octopus Energy for Homey

[Homey](https://homey.app) app that brings your **Octopus Energy** account into Homey — live half-hourly prices, energy usage and cost, standing charge, account balance, and a rich set of Flow cards for automating around dynamic (Agile/Go) pricing.

> Not affiliated with, or endorsed by, Octopus Energy.

## Features

- **Electricity Meter** and **Gas Meter** devices, auto-discovered from your account.
- Current **unit rate** and **standing charge** for your real tariff (Agile, Go, fixed, variable, Economy 7, …).
- **Price level** (plunge / cheap / normal / expensive) from thresholds you set.
- **Usage** and **cost** over the last 24 hours, plus a cumulative meter shown in **Homey Energy**.
- **Account balance** with Insights history (via Octopus's GraphQL).
- **Flow cards**
  - Triggers: price changed, price below threshold, price plunge (negative), price level changed, cheapest half-hour started, balance changed, balance below.
  - Conditions: price below X, is cheapest now, price level is, within cheapest period, balance below.
  - Actions: refresh now, find cheapest upcoming slot (returns start time + average price).

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
