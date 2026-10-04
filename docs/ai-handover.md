# AI and LLM Handover

## Purpose

Use this file as the authoritative entry point for a new human, AI assistant, or Large Language Model (LLM). It contains only the current state. Historical detail remains in [`../HANDOVER.md`](../HANDOVER.md).

## Current Project State

| Field | Value |
|---|---|
| Repository | `zarbjustin/homey-octopus-energy` |
| Branch | `main`; implementation PR #42 and release PR #43 merged |
| App version | `1.0.37` (release merge `47e3297`) |
| Homey build | `37` Test; `36` remains Live |
| GitHub release | [`v1.0.37`](https://github.com/zarbjustin/homey-octopus-energy/releases/tag/v1.0.37) |
| Publish workflow | `37230914547` succeeded |
| Local deployment | v1.0.37 running on Pro; 2 available meters; identities/settings/6 standard/5 Advanced Flows unchanged |
| Last recorded release test baseline | 615 passing final integration gate; build/lint/audit/publish validation green |
| Original formal backlog | Complete through `BL-31` |
| Next phase | S73–S75 delivered for testing; S76 field gates in progress |
| Homey channel | Build 37 Test verified on 4 October 2026; no certification/Live submission |

## Immediate Next Work

Read [`handover/sprints-73-76-execution.md`](handover/sprints-73-76-execution.md)
for actual execution evidence and [`handover/sprints-73-80-spec.md`](handover/sprints-73-80-spec.md)
for the original acceptance contract. S73–S75 are released for testing.
The user authorised local install, GitHub PR delivery and Draft/Test publication;
Live promotion, public posting and charging writes remain separate approval steps.
S77–S80 are proposed later phases, not authorised execution.

Build 37 is verified **Test**, with
[test installation URL](https://homey.app/a/uk.co.zarb.octopusenergy/test/).
Build 36 remains **Live**. Future promotions still require approval and readback:

<https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/37>

Local installation was separately read back at 20:11 UTC. The 48-hour soak,
dashboard UI/settings interactions, unavailable tariff matrix, IOG night boundary
and reporter confirmation remain pending. Do not infer those from installation.

## Recommended Reading Order

1. [`../AGENTS.md`](../AGENTS.md) for mandatory engineering and release rules.
2. [`roadmap-next.md`](roadmap-next.md) for remaining optional work.
3. [`engineering-learnings.md`](engineering-learnings.md) for durable implementation knowledge.
4. [`../HANDOVER.md`](../HANDOVER.md) for release history and incident context.
5. [`blueprint/14-engineering-backlog.md`](blueprint/14-engineering-backlog.md) for the completed formal backlog.

## Latest Delivered Sprint

Version `1.0.37` delivered reliability S73–S75: persisted history-safe lifecycle,
cache-only widgets and bounded background recovery, and evidence-based dispatch
eligibility/fail-closed incomplete plans. 615 tests pass. See the execution record
for the exact contract and remaining field gaps.

Previously, `1.0.36` delivered community-requested price bands in S71–S72:

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

- Local Pro v1.0.37 normal install/readback verified; no clean install or re-pair.
  Official CLI 4.5.2 uses isolated Node 24.21.0 tooling; app/project Node 22 unchanged.
  A skip-build attempt failed with a missing widget asset; fresh build/install
  succeeded. Never reuse a test-mutated `.homeybuild` as an install package.
- The v1.0.37 publish workflow passed production audit, lint, 615 tests, validation
  and upload. GitHub annotated tag/release resolve to release merge `47e3297`.
- All seven widgets registered; meter values updated. First successful session
  poll returned 71 expired rows with zero trigger attempts. No synthetic production
  event or manual Flow trigger was used.
- Dispatch is currently degraded; provider recovery/enrollment not established.
  Running/not-crashed is not proof of provider health or physical charging.
- S76 soak and reporter confirmation remain open. No recurring monitor is scheduled.

## October Reliability Review

- Community post 32 reports repeated Saving Session announcements. An isolated
  replay of the current poller confirmed historical-event replay with 51 rows;
  the manual diagnostic does not prove the affected account's exact event history.
- The pre-implementation Agile/Summary widget acquisition paths were removed in
  S74; all seven endpoints have cold/current/stale/failure outbound-call regressions.
- S75 now handles dispatch eligibility/degraded state without false empty-success
  plans. No verified provider-specific not-enrolled code was available; generic
  lookup errors stay degraded rather than inventing eligibility evidence.
- Twelve manual diagnostics were reviewed; the portal showed zero automatic
  crashes across all 36 builds. No crashes does not mean no functional failures.
- The original review was read-only; subsequent implementation/testing delivery is
  recorded separately above and in the execution record.

## Remaining Work

The original backlog is complete. Reliability S73–S75 is delivered for testing:

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
- 615 or more passing tests.
- No lint failures.
- No production dependency vulnerabilities.
- Publish validation succeeds with only the two documented cumulative-direction warnings.

## Important Interpretation Rule

`HANDOVER.md` is a chronological record. Older sections contain historical phrases such as “next”, “open”, and “remaining”. They are not current unless repeated in this file or [`roadmap-next.md`](roadmap-next.md).
