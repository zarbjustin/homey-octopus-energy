# AI and LLM Handover

Last updated: 22 November 2026. Authoritative current-state entry point. Older
candidate/next markers in historical records are not current instructions.

## Octopus Go tariff and widget candidate

Go Flow card follow-up on 22 November adds an active condition plus observed
start and end triggers. The condition requires current REST price evidence for
the standard UK Go period. Triggers follow scheduled rate observations and
seed on startup without replay. The card build is validated locally and awaits
real Homey boundary verification. The owner approved the local install on
22 November. Independent readback confirmed all three cards on the import
meter, and the live active condition returned true during off-peak. Both meter
identity/settings fingerprints and six Standard/six Advanced Flow fingerprints
matched this install's preflight. The aggregate app settings fingerprint still
includes mutable runtime data and is inconclusive. The 07:30 report source and
schedule matched and its scheduled run remains pending.

The local candidate scales chart bars by rate duration and uses real rate ends.
It includes rates that cross midnight and keeps Agile half-hour selection.
The existing widget ID and settings keys are retained under the visible name
Electricity Prices. The scheduled tariff check now runs before prices so a
confirmed account change clears the old cached rates and is used in the same
refresh. The Energy Optimiser
and its matching Flow cards can plan over published long periods while
requiring complete, non-overlapping half-hour price and carbon coverage.
Go, Agile and the clock-change case pass in the widget tests.

22 November Pro readback found v1.0.44 enabled and not crashed, with recent
successful price refreshes and prices consistent with Go on the import meter.
The earlier Agile readback has cleared. Its original cause and the earlier
pre/post-install preservation gate remain unverified.

Node 22 validation passed with 796 tests, lint, the production audit, build and
publish validation (the two expected cumulative-direction warnings). The full
audit reports 7 moderate findings in the development lint dependency chain.
The owner subsequently approved the local upgrade. On 22 November the
normal packed install succeeded on the selected Pro. Independent readback
confirmed v1.0.44 enabled and not crashed, an available import meter and
current price sources. Two meter identity/settings fingerprints, six
Standard Flows and five Advanced Flows matched the immediate pre-install
readback. The aggregate app settings comparison included mutable billing
and Saving Sessions state and differed, so that aggregate is inconclusive
for preservation. Homey registered Electricity Prices under the existing
widget ID and still lists its dashboard instance. Browser access was
unavailable for a visual dashboard check. The install was local.

## Current baseline

| Gate | Last verified evidence |
|---|---|
| Repository | `zarbjustin/homey-octopus-energy`, `main`; fetch before work |
| Release | v1.0.44, annotated tag at `55ec370c967aed05f7f22fc926e8cf6b3d70c26f` |
| Implementation | PR #66 merged as `1da11fa`; release PR #67 as `55ec370` |
| Checks | 791 tests; lint, full/production audits, build, publish validation and release CI/CodeQL passed |
| Workflows | Version `40699134769`; release `40699514542`; exact-tag publish `40699638752` succeeded |
| Homey Test | Build 44 / v1.0.44 verified after portal reload and public listing |
| Homey Live | Build 41 / v1.0.41 at last 28 October release observation; not promoted by this work |
| Selected Pro | v1.0.44 enabled/not crashed, install result plus independent app read |
| Local acceptance | Full preservation/freshness readback blocked by Homey throttling; not passed |
| Reporter | Approved v1.0.44 Test reply sent and verified after reload on 28 October; awaiting new diagnostics |

Test link: <https://homey.app/a/uk.co.zarb.octopusenergy/test/>.
These are dated observations, not a fresh hardware/channel query by the next agent.

## Immediate next work: two separate tracks

1. Local prices/meter availability: before v1.0.44 both meters were registered
   but unavailable, with stale prices and REST 403 failures predating v1.0.43.
   Mini readings/writes were current. v1.0.44 removes permanent 403 recovery locks
   using existing bounded scheduling; 401 stays blocked. The original upstream
   denial and actual recovery are unproven. After throttling clears, make a
   low-frequency, scoped, read-only check of availability, cached price freshness
   and preservation fingerprints. Stop on throttling; no forced refresh/restart.
2. Reporter Mini: v1.0.43 did not resolve the reported absence of live readings.
   Bounded evidence shows successful polling with roughly half-hourly selected
   timestamps. v1.0.44 adds candidate counts and response timestamp ranges, not
   a confirmed fix. The sent reply requests 15–20 minutes of normal operation,
   a diagnostic report code, support snapshot and simultaneous Octopus-app check.
   No new v1.0.44 report or recovery was established at handover. Review evidence
   before changing meter discovery or adding a bounded recent-range query.

See [current execution and acceptance record](handover/recovery-and-mini-evidence.md).
No private message text/link, report code, raw logs or snapshot is stored in Git.
The owner can locate the existing reporter conversation in Homey Community.

## Transfer to another instance

Use [the cross-machine takeover guide](handover/cross-machine-takeover.md), including
the startup prompt and private-evidence inventory. Git is the portable project
memory; this chat, browser/CLI sessions, Homey state and private artifacts do not
move with a clone. Authenticate separately; never copy tokens.

## Delivered scope and open roadmap

- S73–S75 reliability delivered in v1.0.37. S76 ended early at the user's request;
  not a verified 48-hour pass. Reporter/UI/IOG-night/unsupported-tariff acceptance
  gaps remain; do not restart the old monitor automatically.
- S81–S83 charging software delivered from v1.0.38: price/horizon conditions,
  separated cheapest slots, capped optional fallback and persisted lifecycle.
- v1.0.39 guidance; v1.0.40 Standard setup, capacity/status, decision events,
  explicit-input SOC duration estimation, cached Summary/health and protected
  support export. Real UI/requester/physical acceptance remains separate.
- v1.0.41 GraphQL-success throttle handling; v1.0.42 quiet-path Mini diagnostics;
  v1.0.43 malformed/future sample selection; v1.0.44 bounded 403 recovery and
  privacy-safe Mini evidence. No reporter fix is proven.
- Remaining S77 maintenance/S78 onboarding precedes optional S79 solar/export
  and S80 run-now-or-wait advice. Automatic battery integration/continuous SOC
  control, a new widget and settled-spend digests are not delivered.

Read [roadmap](roadmap-next.md), [engineering learnings](engineering-learnings.md),
[charging guide](charging-flows.md), and [release history](../HANDOVER.md).

## Engineering and authority boundaries

Read `AGENTS.md` first. Node.js 22, TypeScript, Homey SDK v3. Preserve device,
capability, setting, Flow and widget IDs. REST is authoritative for billing;
missing/stale values are unknown, not zero. Keep widgets/support cache-only,
shared account budgets and current provider cadence. Do not loosen freshness.

This transfer is documentation/Git sync only. Do not reinstall, publish, submit
certification, promote Live, send another reply, alter production Flows/settings,
re-pair, replace credentials or control a battery without task-specific authority.

## Offline validation on a fresh checkout

```bash
npm ci
npm test
npm run lint
npm audit
npm audit --omit=dev
npx --yes --package=homey@4.3.1 homey app build
npx --yes --package=homey@4.3.1 homey app validate --level publish
```

Last release baseline: 791 tests. Expected publish warnings are only missing
exported cumulative capability on import and imported cumulative capability on
export. Do not invent opposite-direction zero values to silence them. Tests can
mutate `.homeybuild`; run a normal fresh build before any authorised install.

## Architecture map

| Concern | Source |
|---|---|
| REST / recovery | `lib/OctopusClient.ts`, `lib/BackgroundRecovery.ts` |
| Mini / GraphQL | `lib/KrakenClient.ts`, `lib/LiveDemandSource.ts`, `lib/KrakenBudget.ts` |
| Meter adapter | `lib/OctopusMeterDevice.ts`, `drivers/` |
| Dispatch | `lib/dispatch/`, `lib/DispatchPoller.ts` |
| Planning | `lib/planning/`, `lib/pricing/` |
| Billing/reporting | `lib/billing/`, `lib/reporting/` |
| UI | `widgets/`, `settings/`, `api.ts` |
| Manifest | Compose sources; generated `app.json` |
