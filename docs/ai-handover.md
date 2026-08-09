# AI and LLM Handover

## Purpose

Use this file as the authoritative entry point for a new human, AI assistant, or Large Language Model (LLM). It contains only the current state. Historical detail remains in [`../HANDOVER.md`](../HANDOVER.md).

## Current Project State

| Field | Value |
|---|---|
| Repository | `zarbjustin/homey-octopus-energy` |
| Branch | `main` |
| App version | `1.0.36` |
| Homey build | `36` |
| GitHub release | [`v1.0.36`](https://github.com/zarbjustin/homey-octopus-energy/releases/tag/v1.0.36) |
| Publish workflow | `31325567683` |
| Local deployment | Pending: npm registry unavailable and no cached Homey CLI session on the delivery Mac |
| Test baseline | 577 passing |
| Formal backlog | Complete through `BL-31` |

## Immediate Human Action

Promote Homey Build 36 to Test or Live:

<https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/36>

The build is uploaded. Promotion is a manual Homey Developer Tools step.

## Recommended Reading Order

1. [`../AGENTS.md`](../AGENTS.md) for mandatory engineering and release rules.
2. [`roadmap-next.md`](roadmap-next.md) for remaining optional work.
3. [`engineering-learnings.md`](engineering-learnings.md) for durable implementation knowledge.
4. [`../HANDOVER.md`](../HANDOVER.md) for release history and incident context.
5. [`blueprint/14-engineering-backlog.md`](blueprint/14-engineering-backlog.md) for the completed formal backlog.

## Latest Delivered Sprint

Version `1.0.36` delivered community-requested configurable price bands in S71–S72.

| Area | Delivered |
|---|---|
| Shared classifier | `lib/widgetPriceBands.js` applies negative/green/yellow/orange/red bands with deterministic inclusive boundaries |
| Settings | Editable 10p/20p/30p defaults, strict ordering validation, and safe fallback for invalid values |
| Widgets | Existing Agile Prices and Price Timeline enhanced; no overlapping new widget |
| Compatibility | Agile classic cheapest-slot colours remain selectable; current and cheapest markers stay independent |
| Accessibility | Standard, colour-blind-friendly, and high-contrast palettes plus text legends and exact per-bar labels |
| API budget | Zero new polling cadence; both widget APIs read existing cached device data |

Key commits:

- `57afaa3` — v1.0.36 implementation and release merge.
- PR [`#38`](https://github.com/zarbjustin/homey-octopus-energy/pull/38) — review and green CI history.

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

- Local Homey Pro installation is pending. On the delivery Mac, npm failed its TLS connection and the Homey CLI/session was not cached, so no local upload was attempted with incomplete tooling.
- The Homey publish workflow passed install, production audit, lint, 577 tests, validation, and publish.
- GitHub tag and release `v1.0.36` exist.
- The repository is expected to remain clean after this handover update.

## Remaining Work

There is no committed roadmap debt.

Remaining work is optional or operational:

1. Restore npm access, install/authenticate the official Homey CLI, and run `npx homey app install` for v1.0.36 on Justin's Homey Pro.
2. Promote Build 36 to Test/Live.
3. Smoke-test both price-band widgets with custom thresholds and a non-default palette.
4. Smoke-test the Energy Optimiser widget and new Flow cards on the local Homey.
5. Perform the one-time live EV boost start/cancel verification.
6. Choose an optional future phase from [`roadmap-next.md`](roadmap-next.md).

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
- 577 or more passing tests.
- No lint failures.
- No production dependency vulnerabilities.
- Publish validation succeeds with only the two documented cumulative-direction warnings.

## Important Interpretation Rule

`HANDOVER.md` is a chronological record. Older sections contain historical phrases such as “next”, “open”, and “remaining”. They are not current unless repeated in this file or [`roadmap-next.md`](roadmap-next.md).
