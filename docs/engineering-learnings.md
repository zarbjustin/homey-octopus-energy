# Engineering Learnings

## Purpose

This document captures durable constraints, root causes, and workflow gotchas that future maintainers and AI agents should reuse.

## Data Authority and Trust

- Missing rates must not silently skip consumption. Require the tariff's actual
  register even if that register returned no rows; never borrow the first night
  or standing row outside its validity. Explicit published zero remains valid.
- Preserve settled cumulative commits independently of cost calculation. A price
  gap must not stop usage ingestion or manufacture a cost crossing.
- Persist known coverage failures in existing source diagnostics. Demote retained
  costs immediately and clear that flag only on successful recomputation, not a
  later transport failure. Keep the last-success timestamp and numeric value.
- Tariff comparisons require a priced current baseline; existing numeric tokens
  cannot express unknown as £0. Use each candidate's register identity. A failed
  export discovery is not positive evidence that an account has no export meter.
- Historical session filtering must precede emission. Record lifecycle attempts
  before firing Flows; retention cannot remove still-actionable identities. Keep
  bounded seen-ID tombstones when pruning timed records so a retired ID's later
  reschedule cannot reannounce. Overflow is an explicit fail-closed diagnostic.
- Widget `get` methods can fetch transitively. Cache-only API tests must execute
  real device presentation getters on cold/stale/error paths, not just mock APIs.
- Dispatch absence is not enrollment evidence. Only complete validated snapshots
  can cancel or end prior intent; typed eligibility remains separate from freshness.
- Fence account cache writes and in-flight cleanup against credential rotation,
  not only device refresh generations. An old promise must not clear a new one.
- Homey CLI 4.3.1 is Node-22 compatible; current CLI 4.5.2 requires Node 24.
  Delivery used isolated CLI 4.5.2/Node 24.21.0 tooling without changing the app's
  Node 22 project baseline. Build normally immediately before installing: the
  October skip-build attempt packed a 131 MB test-mutated build and failed with
  a missing widget asset, leaving the app stopped; fresh normal build/install
  packed 3.43 MB and succeeded. CLI exit zero was not proof of install success:
  inspect the message and independently read back app state and device availability.
  CLI 4.3.1 can truncate large JSON when piping because its process exits before
  stdout drains. Use `--jq` source filtering for scoped, privacy-safe readback.

| Learning | Required behavior | Evidence |
|---|---|---|
| Octopus REST consumption is delayed settlement data. | Never show missing current-day data as zero. Use `null` or unavailable wording. | `refreshTodaySoFar` in `lib/OctopusMeterDevice.ts` |
| Intelligent Octopus Go public REST unit-rate feeds can be empty. | Use the authoritative account tariff rows for recovery. Do not price missing data at £0. | `lib/pricing/iogSchedule.ts`, `lib/KrakenClient.ts` |
| Intelligent Octopus Go rate rows include `rateType`. | Use `OFF_PEAK`, `STANDARD`, and related types. Do not infer day/night from one flat value. | `lib/pricing/iogSchedule.ts` |
| GraphQL data is not billing settlement. | Keep planned dispatches and EV rates separate from household billed rates. | `lib/effectiveRate.ts`, `lib/dispatch/` |
| Missing Carbon API intensity is unknown, not zero. | Drop invalid rows and fail closed when a full slot is not continuously covered. | `lib/carbon.ts`, `lib/planning/costCarbon.ts` |

## Planning and Trigger Semantics

- Configured charging plans need a fixed absolute deadline, a persisted remaining
  duration budget and per-run edges, not just first/last plan endpoints. Replans
  must not reset elapsed planned eligibility. It is not measured charging time.
- Persist transition attempts before dispatch. At-most-once attempts prevent
  restart replay but can lose an edge after a crash: retain a current eligibility
  condition and require an independent battery-native stop guard.
- Cache-only local boundary/expiry timers can handle partial final intervals
  without increasing provider polling. Stop timers on uninit/delete and fence
  in-flight persistence against timer resurrection during shutdown.
- New inverted price conditions must throw on unknown rather than return false;
  inversion of false can otherwise grant permission on missing prices.

| Learning | Required behavior | Evidence |
|---|---|---|
| Price and carbon use different units and scales. | Normalize each horizon before applying a user weight. | `lib/planning/costCarbon.ts` |
| A charge plan must be executable. | Select adjacent half-hour rows and require the full requested horizon. | `lib/planning/costCarbon.ts` |
| An in-progress slot has reduced remaining capacity. | New charge actions exclude it rather than promise a full half-hour. | `includeCurrentSlot` in `lib/planning/costCarbon.ts` |
| Conditions and triggers need current-slot awareness. | Conditions may include the current slot; new action plans should not. | `isInCostCarbonWindow` in `lib/OctopusMeterDevice.ts` |
| Equal-price slots still represent new time edges. | Track `rate.valid_from`, not only the numeric price. | `drivers/electricity/device.ts`, `drivers/export/device.ts` |
| Rolling recommendations can remain active across several slots. | Trigger only on a false-to-true transition, not every slot while active. | `costCarbonWindowStartedNow`, `peakWindowStartedNow` |
| Carbon and price refreshes form one recommendation snapshot. | Fire the optimiser trigger only after the same-cycle carbon refresh. | `refreshExtra` in `drivers/electricity/device.ts` |
| A partially used final slot changes cost and emissions. | Weight the final slot by remaining energy. | `energyPerSlotKwh` in `lib/planning/costCarbon.ts` |

## Homey Platform

| Learning | Required behavior |
|---|---|
| Homey Compose is the source of truth. | Edit Compose files, then regenerate `app.json` with `npx homey app build`. |
| Flow and capability IDs are user contracts. | Preserve IDs. Add new cards or tokens rather than renaming existing IDs. |
| Import and export meters are directional. | Keep the two expected cumulative warnings. Do not create fake opposite-direction values. |
| Widgets execute inside Homey’s widget environment. | Read cached device methods only, escape dynamic values, and expose accessible live regions and controls. |
| Widget colour thresholds are a cross-widget data contract. | Classify prices in one shared pure module, validate strict threshold ordering at the API boundary, and return the resolved options with the cached rows. |
| Colour alone cannot communicate a price band. | Pair palettes with textual range legends and exact per-bar accessible labels; keep current and cheapest markers independent from band colour. |
| Local clean install can fail generically. | Use `npx homey app install`. Retry without `--clean` if Homey reports `Missing File`. |

## API Budget and Failure Handling

| Learning | Required behavior |
|---|---|
| Kraken’s request allowance is shared by account and external clients. | Reuse account caches, single-flight calls, and the shared request budget. |
| A new timer multiplies by account and device count. | Do not add polling without a system-level request-count test. |
| Stale data must not create success-shaped automation. | Conditions return false and actions return explicit errors when required data is stale or incomplete. |
| Unsupported GraphQL fields can break an otherwise useful query. | Keep optional fields isolated or backed off. Do not replace REST billing data. |

## Testing Patterns

- Pure calculations belong under `lib/` and use deterministic unit tests.
- Device adapter tests can use `Object.create(OctopusMeterDevice.prototype)` with explicit stubs.
- Flow contract tests verify every manifest card has a runtime reference.
- Widget tests verify stale device IDs, escaping, freshness pass-through, and accessibility hooks.
- Time-window tests must cover:
  - current active slots;
  - incomplete horizons;
  - non-adjacent rows;
  - negative rates;
  - equal-price plateaus;
  - partial final energy;
  - United Kingdom daylight-saving transitions.

## Release and CI

| Learning | Required behavior |
|---|---|
| The development ESLint toolchain can carry advisories that are not shipped. | Use `npm audit --omit=dev` for the release gate. |
| Homey publication creates a Draft build. | Record the build ID and leave an explicit manual Test/Live promotion step. |
| GitHub Actions are pinned to immutable commit Secure Hash Algorithm (SHA) values. | Preserve SHA pinning when updating actions. |
| GitHub reports that some pinned actions use the deprecated Node 20 action runtime. | Review upstream Node 24-compatible action revisions in a maintenance sprint. |
| A historical `gh` command-line pull-request merge did not trigger the push-based release workflow. | Always verify the tag and GitHub release after a PR merge; create them manually if absent. |
| Sprint completion has three delivery targets. | Install locally, commit and push GitHub, then publish the Homey App Store build. |

## Security and Privacy

- Store credentials only in Homey device storage or GitHub Secrets.
- Redact account numbers, meter identifiers, device identifiers, tokens, and API errors.
- Use synthetic Octopus-format identifiers in tests.
- Keep repair identity-safe. A replacement physical meter is a new device.
- Keep consent-gated writes disabled by default and fail closed.
