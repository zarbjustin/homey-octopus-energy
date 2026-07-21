# Blueprint grounding pack (shared input)

> Working input for the multi-model blueprint. Every deliverable (`01`–`19`) draws on the facts here.
> Facts are grounded in the repo (file:line / manifest) or external sources (URLs). Anything not
> verifiable is flagged as an **assumption**. Compiled 21 Jul 2026 against `main` @ `f53026d`.

## 1. What the product is
Octopus Energy for Homey (`uk.co.zarb.octopusenergy`) — a **Homey Pro (local platform)** app that brings a
UK Octopus Energy account into Homey: live half-hourly prices, usage/cost, standing charge, account balance,
carbon intensity, Intelligent Octopus Go dispatches, Saving Sessions/Free Electricity, and a large Flow-card
surface for automating around dynamic (Agile/Go) pricing. Not affiliated with Octopus. Source: `README.md`.

- **Not** a device integration in the Zigbee/Z-Wave sense — it is a **cloud-account integration** (REST + Kraken
  GraphQL) that models meters as Homey devices.
- Positioning vs peers: the closest Homey competitor is **Tibber** (mature dynamic-tariff + smart charging).
  The maturity benchmark in the wider ecosystem is **Home Assistant's `BottlecapDave/HomeAssistant-OctopusEnergy`**
  integration (very feature-complete: intelligent dispatch controls, gas, target-rate sensors, wheel-of-fortune,
  greenness forecast, cost trackers). Other Homey energy peers: Frank Energie, Shelly, Sense, Emporia.
  Sources: web research (community.homey.app/t/136685; homey.app/apps; electricchoice/worldmetrics 2026 round-ups).

## 2. Platform & stack facts (verified)
- Homey **SDK v3**, `compatibility >=12.4.0`, `platforms: ["local"]` (Homey Pro only; no Homey Cloud/Bridge).
  Source: `app.json`.
- **TypeScript**, Homey Compose (`.homeycompose/`). **Zero runtime dependencies** (`package.json` `dependencies: {}`);
  dev-only: typescript, eslint (+ athom configs), @types/homey, @types/node.
- Scripts: `build` (tsc), `test` (tsc + `node --test`), `lint` (eslint). Source: `package.json`.
- **~7.9k LOC** across `lib/` (24 TS files), `app.ts`, 3 drivers. **366 tests** (32 test files, `node:test`).
- Manifest surface: **3 drivers** (electricity, export, gas), **6 widgets** (agile, carbon, export, price,
  summary, timeline), **Flow: 33 triggers / 17 conditions / 13 actions**. Source: `app.json`.
- Capabilities (custom + system): pricing (`measure_octopus_price`, `octopus_price_level/next/min/max/avg_today`,
  `octopus_good_now`), smart-charge (`octopus_smart_charge`, `octopus_charge_start`, `octopus_dispatching`),
  carbon (`measure_octopus_carbon`, `octopus_carbon_level`, `measure_renewable_percent`), energy/cost
  (`meter_power`(.exported), `octopus_usage_today`, `octopus_cost_*`, `octopus_earnings_*`, `octopus_standing_charge`),
  account (`measure_octopus_balance`, `octopus_points`, `octopus_updated`), gas (`meter_gas`, `measure_gas_carbon`).

### `lib/` module map (LOC) — note the god-object
| File | LOC | Role |
|---|---|---|
| `OctopusMeterDevice.ts` | **2392** | Device base — refresh loops, pricing, IOG recovery, cost calc, capabilities. **God-object; S52 decompose is already planned.** |
| `KrakenClient.ts` | 972 | GraphQL client (balance, IOG tariff, dispatches, saving sessions, budget-aware). |
| `OctopusClient.ts` | 484 | REST client (products, unit rates, standing charges, consumption). |
| `rates.ts` | 309 | Pure tariff helpers (unit-tested). |
| `planner/tie.ts` | 263 | Charge-planner tie strategies (earliest/latest/random). |
| `DispatchPoller.ts` / `dispatch/*` | 230+153+84+54 | Dispatch polling + reconcile truth model. |
| `analytics/priceAnalytics.ts` | 230 | Price-day analytics. |
| `LiveDemandSource.ts` | 217 | Home Mini live power. |
| `OctopusMeterDriver.ts` | 181 | Driver base (pairing). |
| `KrakenBudget.ts` | 175 | Shared per-account request budget (F0). |
| `SavingSessionsPoller.ts` | 169 | Saving Sessions / Free Electricity. |
| `carbon.ts` | 171 | Carbon intensity. |
| `effectiveRate.ts` | 132 | Opt-in IOG effective-rate estimate. |
| `AccountPoller.ts` | 111 | Account-scoped balance/points. |
| `billing/*` | 105+68+58+38 | Billing-period aggregate/tz/project/types. |
| `freshness.ts` | 59 | Provenance/freshness convention (F1). |
| `compare.ts` | 50 | Tariff comparison. |

## 3. Third-party APIs in use
- **Octopus REST** `https://api.octopus.energy/v1/` — products, electricity/gas tariffs, standard-unit-rates,
  standing-charges, consumption. HTTP Basic (API key as username, blank password). Public product/tariff endpoints
  need no auth. Client: `lib/OctopusClient.ts`. Source: `README.md`, docs.octopus.energy/rest.
- **Kraken GraphQL** `https://api.octopus.energy/v1/graphql/` — account balance, IOG agreement/tariff, planned +
  completed dispatches, saving sessions. Token via `obtainKrakenToken` (memory-only). Client: `lib/KrakenClient.ts`.
- **Rate limits**: Kraken is **points/quota-based, per-account, ~100–125 req/hr, shared across ALL apps on the
  account** — the reason for the shared budget (`KrakenBudget.ts`, F0) and a known throttling constraint. Sources:
  developer.octopus.energy/docs/api/graphql/api-basics; `docs/handover/sprints-42-48-research.md`.
- **TariffType is a 7-member GraphQL interface** (StandardTariff, DayNightTariff, ThreeRateTariff, FourRateEvTariff,
  HalfHourlyTariff, PrepayTariff, GasTariffType) — verified via live introspection this session; drives the v1.0.20
  IOG fix. Carbon intensity likely via a separate source (`lib/carbon.ts` — verify endpoint).

## 4. Current Homey platform capabilities to evaluate against (external)
From the Homey Apps SDK (apps.developer.homey.app) + 2025/26 platform notes:
- **Widgets** (dashboard/mobile) — app already ships 6; evaluate depth vs new widget APIs.
- **Advanced Flow** — richer trigger/condition/action graphs; the app has a large Flow surface already.
- **Energy API** — register energy capabilities, real-time + historical consumption, Homey Energy integration
  (app uses `meter_power` cumulative). Evaluate the newer Energy features.
- **Device capabilities** — custom + system, capability options, dynamic capabilities.
- **Repair Flow / maintenance actions** — proactive re-pair/troubleshoot from the UI. **CORRECTION (verified by
  ws-product):** all three drivers DO ship a credential-repair flow (`drivers/electricity/driver.compose.json:77`,
  gas:62, export:64) — a strength. Opportunity is deepening it (e.g. account-wide re-key; see bug BB-01).
- **Matter / Thread** — relevant only if expanding beyond cloud-account scope (low fit for a supplier app).
- **Insights / Logic variables / Timeline notifications** — evaluate for observability & user reporting.
Sources: apps.developer.homey.app (capabilities, upgrade-to-v3), homey.app/developer.

## 5. Existing planning to INGEST (do not duplicate; cross-reference)
- `ROADMAP.md` — Sprints 1–58 history + design decisions + API notes (large).
- `docs/handover/sprints-42-48-spec.md` + `docs/research/sprints-42-48-research.md` — researched spec, revised order
  (`42→43→45→46→44→47→49`), two foundations **F0 shared Kraken budget** + **F1 provenance/freshness**, recommends
  **dropping Sprint 48 (live gas)** as misleading/low-value.
- `docs/handover/sprints-50-58-spec.md` — post-v1.0.18 roadmap: S50 stability (done), S51 Kraken single-flight
  (part done), **S52 decompose `OctopusMeterDevice`**, S53 per-source provenance + accessibility, S54 settled
  consumption insights + budget Flows, S55 tariff comparison 2.0, S56 Saving Sessions/Power-ups automation,
  S57 planned-dispatch + IOG-preference research, S58 Cosy/E7 + export/Flux + carbon optimiser.
- `docs/handover/future-sprints.md` — required-reading order + baseline.
- `HANDOVER.md` — current state (v1.0.20/Build 20), the **open IOG field-verification gate** (do not touch).
- `docs/reviews/import-price-gap-*` — the IOG incident analysis lineage.

## 6. Current release / operational state
- **v1.0.20 / Build 20** uploaded 21 Jul 2026 (IOG tariff-union fix + census). Build 13/`1.0.13` live; Build 17/`1.0.17`
  in Test/certification. CI gates: lint, `npm audit` (hard gate — a `brace-expansion` advisory blocked a push and was
  cleared), test, Homey publish-validate (two documented cumulative warnings), CodeQL. Release auto-tags on push to `main`.
- Community support topic: community.homey.app/t/156860. Open incident: IOG "day rate blank" (v1.0.20 shipped,
  **awaiting Darren's field confirmation** — separate, do not fold into the blueprint).
- **Known doc staleness**: `README.md` "Current release" still says `1.0.18` (now 1.0.20) — a minor finding for the
  Repo Health / Documentation deliverable.

## 7. Cross-cutting themes already visible (hypotheses for the models to test)
- **God-object risk**: `OctopusMeterDevice.ts` (2392 LOC) concentrates refresh, pricing, IOG, cost, capability logic.
- **Budget/throttle sensitivity**: everything must respect the shared ~100–125 req/hr Kraken quota (F0).
- **Provenance discipline**: the app is careful to label estimates/forecasts vs settled figures (F1) — a genuine
  differentiator vs naive integrations; protect it.
- **Maturity gap vs Home Assistant Octopus integration**: intelligent-dispatch *control* (not just read), target-rate
  automation, gas depth, greenness forecast — candidate feature gaps.
- **Platform under-utilisation candidates**: repair flow (re-auth), newer Energy API, Insights, richer widgets/Advanced Flow.

## 8. Guardrails for all deliverables
- Cite evidence (file:line or URL) for every claim; label unverifiable items as assumptions.
- Docs-only task — **no `lib/` code changes**. Do not touch the open IOG field-verification item.
- Reconcile with existing ROADMAP/specs; where the blueprint diverges, say so and justify.
- Surface model disagreements with trade-offs and a reasoned recommendation — do not force consensus.
