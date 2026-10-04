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
| Local deployment | Unverified; August handover recorded an npm/CLI tooling block, not re-tested in October planning |
| Last recorded release test baseline | 577 passing; full suite not rerun for this documentation-only plan |
| Original formal backlog | Complete through `BL-31` |
| Next phase | S73–S76 reliability plan; `BL-32`–`BL-35` planned, not implemented |
| Homey channel | Build 36 observed Live on 4 October 2026 |

## Immediate Next Work

Read [`handover/sprints-73-80-spec.md`](handover/sprints-73-80-spec.md) and start
with S73 only when implementation is requested. The plan prioritises event
deduplication, cache-only widgets and dispatch eligibility; S76 closes field and
release verification. S77–S80 are proposed later phases, not authorised execution.

Build 36's promotion is closed: the publishing portal showed **Live** on
4 October 2026. Future builds still require separate channel verification:

<https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/36>

Local Homey Pro installation and remaining field checks are not confirmed by the
October review. Do not infer deployment from source, a GitHub release or portal status.

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
| API budget | Price-band implementation added no cadence; October review found older widget getter paths can fetch on cache miss (S74 addresses this) |

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

- Local Homey Pro installation is unverified. The August delivery record reports
  an npm TLS failure and no cached Homey CLI/session; this is historical tooling
  evidence, not a fresh October diagnosis. Check current tooling during delivery.
- The recorded v1.0.36 Homey publish workflow passed install, production audit,
  lint, 577 tests, validation, and publish; it was not rerun for this plan.
- GitHub tag and release `v1.0.36` exist.
- The August release handover expected a clean repository; October planning changes
  are documentation-only and are not committed or pushed by this request.

## October Reliability Review

- Community post 32 reports repeated Saving Session announcements. An isolated
  replay of the current poller confirmed historical-event replay with 51 rows;
  the manual diagnostic does not prove the affected account's exact event history.
- The current Agile widget can request a full refresh when prices are missing.
  Summary getter paths also need a cold-cache outbound-call audit.
- Dispatch lookup errors need evidence-based eligibility/degraded classification,
  not blanket suppression or fabricated empty successful plans.
- Twelve manual diagnostics were reviewed; the portal showed zero automatic
  crashes across all 36 builds. No crashes does not mean no functional failures.
- This review and sprint plan did not change runtime code or release anything.

## Remaining Work

The original backlog is complete, but new reliability work is now planned:

1. S73: event lifecycle/retention, restart-safe announcement deduplication and migration.
2. S74: cache-only widget routes, bounded background recovery and meter-selection check.
3. S75: dispatch eligibility, transient-failure handling and stale-state safety.
4. S76: release, local/Test smoke, IOG overnight and reporter verification gates.
5. Keep EV boost start/cancel verification separate and explicitly opt-in.
6. Reprioritise S77–S80 only after reliability evidence; see [`roadmap-next.md`](roadmap-next.md).

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
