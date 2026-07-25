# AI and LLM Handover

## Purpose

Use this file as the authoritative entry point for a new human, AI assistant, or Large Language Model (LLM). It contains only the current state. Historical detail remains in [`../HANDOVER.md`](../HANDOVER.md).

## Current Project State

| Field | Value |
|---|---|
| Repository | `zarbjustin/homey-octopus-energy` |
| Branch | `main` |
| App version | `1.0.35` |
| Homey build | `35` |
| GitHub release | [`v1.0.35`](https://github.com/zarbjustin/homey-octopus-energy/releases/tag/v1.0.35) |
| Publish workflow | `30135586673` |
| Local deployment | Installed on Justin’s Homey Pro |
| Test baseline | 570 passing |
| Formal backlog | Complete through `BL-31` |

## Immediate Human Action

Promote Homey Build 35 to Test or Live:

<https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/35>

The build is uploaded. Promotion is a manual Homey Developer Tools step.

## Recommended Reading Order

1. [`../AGENTS.md`](../AGENTS.md) for mandatory engineering and release rules.
2. [`roadmap-next.md`](roadmap-next.md) for remaining optional work.
3. [`engineering-learnings.md`](engineering-learnings.md) for durable implementation knowledge.
4. [`../HANDOVER.md`](../HANDOVER.md) for release history and incident context.
5. [`blueprint/14-engineering-backlog.md`](blueprint/14-engineering-backlog.md) for the completed formal backlog.

## Latest Delivered Sprint

Version `1.0.35` completed `BL-25`, `BL-26`, and `BL-27`.

| Area | Delivered |
|---|---|
| Cost and carbon planning | Pure normalized contiguous-window optimiser in `lib/planning/costCarbon.ts` |
| Existing Flow compatibility | `plan_green_charge` ID preserved with expanded estimate and trade-off tokens |
| New electricity automation | `green_charge_window_started` trigger and `in_green_charge_window` condition |
| New export automation | `export_peak_started` trigger |
| Widget | Interactive Energy Optimiser with price/carbon priority and duration controls |
| Trust behavior | Complete price/carbon horizons, no invented carbon, estimate labels, partial-slot weighting |
| API budget | Zero new polling cadence; widget reads cached device state |

Key commits:

- `b05ab64` — optimiser implementation.
- `0b5458d` — v1.0.35 release metadata.
- `ffc316f` — Build 35 handover.
- `5101fbd` — local deployment record.

## Architecture Map

| Concern | Primary files |
|---|---|
| REST client | `lib/OctopusClient.ts` |
| GraphQL client | `lib/KrakenClient.ts` |
| Shared meter behavior | `lib/OctopusMeterDevice.ts` |
| Shared driver behavior | `lib/OctopusMeterDriver.ts` |
| Account request budget | `lib/KrakenBudget.ts` |
| Dispatch model | `lib/dispatch/`, `lib/DispatchPoller.ts` |
| Tariff rates | `lib/rates.ts`, `lib/pricing/` |
| Cost/carbon optimiser | `lib/planning/costCarbon.ts` |
| Target-rate planner | `lib/planning/targetRate.ts` |
| Billing/reporting | `lib/billing/`, `lib/reporting/` |
| Electricity adapter | `drivers/electricity/` |
| Export adapter | `drivers/export/` |
| Widgets | `widgets/` |
| Generated manifest | `app.json` |
| Compose sources | `.homeycompose/`, `drivers/*/*.compose.json`, `widgets/*/widget.compose.json` |

## Current Operational Status

- Local Homey Pro installation succeeded with `npx homey app install`.
- `npx homey app install --clean` returned a generic `Missing File` error. Normal installation succeeded without code changes.
- The Homey publish workflow passed install, production audit, lint, 570 tests, validation, and publish.
- GitHub tag and release `v1.0.35` exist.
- The repository is expected to remain clean after this handover update.

## Remaining Work

There is no committed roadmap debt.

Remaining work is optional or operational:

1. Promote Build 35 to Test/Live.
2. Smoke-test the Energy Optimiser widget and new Flow cards on the local Homey.
3. Perform the one-time live EV boost start/cancel verification.
4. Choose an optional future phase from [`roadmap-next.md`](roadmap-next.md).
5. Continue incremental Dutch Flow-card translation if desired.

## Resume Checklist

```bash
git switch main
git pull --ff-only
git status --short
npm ci
npm test
npm run lint
npm audit --omit=dev
npx homey app validate --level publish
```

Expected result:

- Clean worktree.
- 570 or more passing tests.
- No lint failures.
- No production dependency vulnerabilities.
- Publish validation succeeds with only the two documented cumulative-direction warnings.

## Important Interpretation Rule

`HANDOVER.md` is a chronological record. Older sections contain historical phrases such as “next”, “open”, and “remaining”. They are not current unless repeated in this file or [`roadmap-next.md`](roadmap-next.md).

