# AI and LLM Handover

## Purpose

Use this file as the authoritative entry point for a new human, AI assistant, or Large Language Model (LLM). It contains only the current state. Historical detail remains in [`../HANDOVER.md`](../HANDOVER.md).

## Current Project State

5 October app-wide bug bash: local transport, throttle, balance, carbon, billing,
IOG ambiguity and gas fixes plus deadline optimisation; 672 tests after closing
BBA-10 locally. Missing cost/night/standing coverage fails closed; last-known
costs and timestamps are retained with a source-specific coverage flag, while
settled cumulative readings continue. The
[current review](blueprint/08-bug-bash-report.md) records the evidence. User requested
App Store Test delivery, confirmed on 5 October. Delivery is in progress; no
new build/channel result is yet verified. No certification/Live authorisation;
field/reporter gates remain open.

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

S81–S83 charging software is implemented and validated locally on 5 October:
14 additive cards, exact Homey-local deadlines, every qualifying slot, optional
bounded-duration fallback, and a persisted one-plan-per-meter lifecycle with
replans/restart deduplication. See
[`handover/sprints-81-83-charging-flows.md`](handover/sprints-81-83-charging-flows.md)
for contracts, Standard/Advanced Flow recipes and field gates.

Local Node 22 build, 651 tests, lint, production audit (zero vulnerabilities) and
publish validation pass. All 80 existing Flow contracts unchanged. No new version,
install, commit, push or publication. Delivery and
real-Homey/requester acceptance remain pending. No battery command, live Flow
edit, new widget or new provider polling cadence was introduced.

S76 monitoring ended early at user request on 5 October: stable sampled evidence,
not a verified 48-hour pass. Heartbeat `octopus-s76-read-only-soak` is paused.
Reporter, widget UI, IOG night and unsupported-tariff gates remain open.
[`handover/sprints-73-76-execution.md`](handover/sprints-73-76-execution.md)
records reliability delivery; S77–S80 remain separate proposed future work.

Build 37 is Test, Build 36 Live (last channel check 4 October). These are the
released v1.0.37 states, not this new local candidate. Test URL:
<https://homey.app/a/uk.co.zarb.octopusenergy/test/>.
Certification/Live promotion, public posting and physical charging remain
separately approved actions.

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
- S76 monitoring ended early with stable samples and coverage gaps; heartbeat paused.
  No verified 48-hour pass or reporter/field closure. Charging code is complete locally;
  deployment and field acceptance are separate gates.

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
6. Follow the approved future ordering after reliability evidence: S77/S78,
   S81–S83 charging Flows, then optional S79/S80. Charging local execution is authorised; its field/delivery acceptance is pending;
   see [`roadmap-next.md`](roadmap-next.md).

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
