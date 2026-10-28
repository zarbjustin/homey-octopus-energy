# AI and LLM Handover

Last updated: 28 October 2026. Authoritative current-state entry point. Older
candidate/next markers in historical records are not current instructions.

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
