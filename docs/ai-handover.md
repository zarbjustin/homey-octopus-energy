# AI and LLM Handover

## Purpose

Use this file as the authoritative entry point for a new human, AI assistant, or Large Language Model (LLM). It contains only the current state. Historical detail remains in [`../HANDOVER.md`](../HANDOVER.md).

## Current Project State

9 October maintenance/support extension: combined candidate now has 742 passing
tests, independent Summary value badges and an explicit Settings support preview/
download via a protected cache-only API. Toolchain migration removes the older
unpatched dependency chain; full and production audits report zero findings. CI
now audits tooling separately. GitHub review, Pro install and Test delivery are
authorised and pending; no Live/Flow/battery authority. See
[current execution and acceptance record](handover/maintenance-freshness-support.md).

Local source update: 9 October 2026. Six additive charging cards and cache-only
Summary/settings improvements are implemented and validated with 726 tests.
The initial four setup/capacity/status cards are extended by a deduplicated
decision-change trigger and an explicit-input battery duration estimator with
SOC timestamp/age validation. Summary shows selected periods, budgets and caps;
health guidance separates independent source ages and unsupported/unknown dispatch.
They reuse the existing planner/controller without new polling or battery control. All 94
released Flow contracts remain unchanged. This is an **unreleased local candidate**;
source version remains 1.0.39 and released Build 39 does not contain these cards.
No commit/push, version bump, install or publication in this step. See
[scope, evidence and pending gates](handover/charging-summary-health-and-battery.md).

Release/install/channel readback: 7 October 2026. Scoped S78 charging guidance is
delivered as v1.0.39 / Build 39 Test and installed on the local Pro. All 678 tests,
build, lint, production audit, publish validation and release CI/CodeQL pass.
Production audit reported zero vulnerabilities. The four development-scope GitHub
alerts observed on 7 October are historical; the 9 October candidate has a clear
full npm audit. GitHub alert closure needs post-merge readback, not an inference.

5 October app-wide bug bash: delivered transport, throttle, balance, carbon, billing,
IOG ambiguity and gas fixes plus deadline optimisation; 672 tests after closing
BBA-10. Missing cost/night/standing coverage fails closed; last-known
costs and timestamps are retained with a source-specific coverage flag, while
settled cumulative readings continue. The
[current review](blueprint/08-bug-bash-report.md) records the evidence. User requested
App Store Test delivery completed on 5 October: v1.0.38 / Build 38.
Fresh 7 October readback found Build 38 already Live before this task; the agent
did not promote it. v1.0.39 is Test only; field/reporter gates remain open.

| Field | Value |
|---|---|
| Repository | `zarbjustin/homey-octopus-energy` |
| Branch | `main`; implementation PR #51 and release PR #52 merged |
| App version | `1.0.39` (release merge `f48f2e1`) |
| Homey build | `39` Test; `38` Live |
| GitHub release | [`v1.0.39`](https://github.com/zarbjustin/homey-octopus-energy/releases/tag/v1.0.39) |
| Publish workflow | `37635125770` succeeded, using exact release tag |
| Local deployment | v1.0.39 running on Pro; 2 available meters; identities/settings/6 standard/5 Advanced Flows unchanged |
| Last recorded release test baseline | 678 passing tests; build/lint/audit/publish validation and CodeQL green |
| Original formal backlog | Complete through `BL-31` |
| Next phase | Charging/reliability field acceptance, then S77/S78; S76 gaps remain open |
| Homey channel | Build 39 Test and Build 38 Live verified on 7 October; no certification/Live action by this task |

## Immediate Next Work

9 October: review the local charging-capacity/status candidate, then run GitHub
checks and the normal release workflow only within separately confirmed delivery
scope. Real Homey card selection and notification-only recipes remain untested;
physical battery response needs separate authority and evidence. Do not announce
the six cards or UI improvements as available on Test until readback proves delivery.
Battery sizing is explicit-input estimation only; automatic integration, continuous
SOC replanning, solar/export optimisation and a new widget are not implemented.
Existing S76 and broader S77/S78 gates remain.

7 October: the authorised S78 charging-guidance slice is delivered on Pro and Test:
clearer Flow hints, a [charging Flow guide](charging-flows.md)
with separate configure/start/late-battery/stop paths, and synthetic regressions.
678 tests pass; build, lint, production audit and publish validation pass. IDs,
arguments, tokens and runtime behaviour are unchanged. Legacy price/cheapest
triggers remain numeric-change-driven, explicitly documented rather than silently
changed. See [S78 execution](handover/s78-charging-guidance.md).
This is not full S78 closure: real Homey UI and requester acceptance remain pending,
as does broader health/onboarding work. No Flow edit, battery command, public post
or certification/Live promotion was performed. Release/install evidence is in the
S78 record, including the supported dashboard fallback after CLI connectivity failure.
The released configure action returns output tags and is Advanced-only. The
9 October candidate adds a separate no-output Standard setup action; the released
configuration action and its four output tags are preserved. Standard-only setup
is implemented locally but is not yet shipped functionality.

S81–S83 charging software is delivered for testing on 5 October:
14 additive cards, exact Homey-local deadlines, every qualifying slot, optional
bounded-duration fallback, and a persisted one-plan-per-meter lifecycle with
replans/restart deduplication. See
[`handover/sprints-81-83-charging-flows.md`](handover/sprints-81-83-charging-flows.md)
for contracts, Standard/Advanced Flow recipes and field gates.

Combined Node 22 build, 672 tests, lint, production audit (zero vulnerabilities),
publish validation and GitHub release checks pass. All 80 existing Flow contracts
unchanged; 14 additions. Source/local/Test delivery is verified; real-Homey UI,
requester and physical acceptance remain pending. No battery command, live Flow
edit, new widget or new provider polling cadence was introduced.

S76 monitoring ended early at user request on 5 October: stable sampled evidence,
not a verified 48-hour pass. Heartbeat `octopus-s76-read-only-soak` is paused.
Reporter, widget UI, IOG night and unsupported-tariff gates remain open.
[`handover/sprints-73-76-execution.md`](handover/sprints-73-76-execution.md)
records reliability delivery; S77–S80 remain separate proposed future work.

Build 39 is Test, Build 38 Live (channel readback 7 October). Test URL:
<https://homey.app/a/uk.co.zarb.octopusenergy/test/>.
The approved Test announcement was posted on 5 October in the
[public support topic](https://community.homey.app/t/156860/36).
Certification/Live promotion, future public posting and physical charging remain
separately approved actions.

### Latest Support Follow-up

5–6 October follow-up clarified Flow price-band inputs: enter numeric p/kWh
limits directly, or optionally use Number-variable tags. The inputs are upper
price bounds, not colour identifiers, and belong to the Flow rather than a widget
instance. See the charging record's price-band example. A current-price condition
checks when the Flow runs; horizon availability and configured plans are separate
cards. Guidance and an invitation for further feedback were sent; a question or
intention to test is not field confirmation. The 7 October S78 source update adds
future-versus-current and event-versus-condition guidance; UI/requester acceptance
remains open. Only generic requirements are retained here, not private messages.

## Recommended Reading Order

1. [`../AGENTS.md`](../AGENTS.md) for mandatory engineering and release rules.
2. [`roadmap-next.md`](roadmap-next.md) for remaining optional work.
3. [`engineering-learnings.md`](engineering-learnings.md) for durable implementation knowledge.
4. [`../HANDOVER.md`](../HANDOVER.md) for release history and incident context.
5. [`blueprint/14-engineering-backlog.md`](blueprint/14-engineering-backlog.md) for the completed formal backlog.

## Latest Delivered Sprint

Version `1.0.39` delivers the S78 charging-guidance slice: hint-only presentation
changes, Standard Flow recipes and six new regressions. Pro/Test delivery is
verified; real UI/requester and broader S78 work remain open.

Version `1.0.38` delivers S81–S83 charging software and the app-wide bug-bash
fixes including BBA-10. See the charging execution record and current bug-bash
report. Build 38 is now Live; physical/reporter acceptance remains open.

Version `1.0.37` previously delivered reliability S73–S75: persisted history-safe lifecycle,
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

- Last runtime/install/channel observations: 7 October. Local Pro v1.0.39
  running/enabled/not crashed; both meters available, all four identity/settings/
  standard/Advanced Flow fingerprints preserved. No clean install or re-pair.
- Official CLI 4.5.2 local/forwarded discovery failed; its supported cloud strategy
  rejected devkit upload with 400. Developer Tools Build 39 Install on the selected
  Pro succeeded and was independently read back. App/project Node 22 unchanged.
  Never reuse a test-mutated `.homeybuild` as an install package.
- The v1.0.39 publish workflow passed audit, lint, 678 tests, validation and upload.
  GitHub annotated tag/release resolve to `f48f2e1`. Build 39 Test, Build 38 Live;
  Live was observed, not promoted here. This is not an overnight/account matrix test.
- The previous v1.0.37 smoke registered all seven widgets. First successful session
  poll returned 71 expired rows with zero trigger attempts. No synthetic production
  event or manual Flow trigger was used.
- Dispatch was degraded at the last recorded readback; provider recovery/enrollment not established.
  Running/not-crashed is not proof of provider health or physical charging.
- S76 monitoring ended early with stable samples and coverage gaps; heartbeat paused.
  No verified 48-hour pass or reporter/field closure. Charging code is delivered
  for testing; field acceptance remains a separate gate.

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
6. Obtain charging/reliability field acceptance, then prioritise proposed S77/S78
   maintenance/support work ahead of optional S79/S80. S81–S83 software is already
   delivered in Test; do not reimplement it as pending roadmap work;
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
- 672 or more passing tests.
- No lint failures.
- No production dependency vulnerabilities.
- Publish validation succeeds with only the two documented cumulative-direction warnings.

## Important Interpretation Rule

`HANDOVER.md` is a chronological record. Older sections contain historical phrases such as “next”, “open”, and “remaining”. They are not current unless repeated in this file or [`roadmap-next.md`](roadmap-next.md).
