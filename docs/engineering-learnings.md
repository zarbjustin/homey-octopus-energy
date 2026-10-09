# Engineering Learnings

## Purpose

This document captures durable constraints, root causes, and workflow gotchas that future maintainers and AI agents should reuse.

## Data Authority and Trust

- Athom's Docker validate/version/publish actions wrap official CLI commands.
  Repeated Docker Hub HTTP 429 can fail before any app validation executes. In a
  deliberate maintenance change, run equivalent explicitly version-pinned CLI
  commands on the project's Node runtime; preserve publish validation, exact-tag
  provenance and genuine release checks. Keep headless publishing credentials
  step-scoped and never extract/log them. An exact CLI package pin does not lock
  every transitive tool dependency or expand the app's npm audit coverage.
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

- Decision notifications should compare semantic decision/whole-plan selection,
  not changing prices or countdowns. Persist a small attempt marker in the existing
  plan state, seed legacy plans silently and retain the evaluation timestamp across
  asynchronous lifecycle delivery. Failed diagnostics must not break old controls;
  persistence-before-emission is at-most-once, not guaranteed delivery.
- SOC-derived duration requires explicit usable capacity, AC input power, conversion
  efficiency and a real timezone-aware measurement timestamp. Reject stale/future
  readings; never replace the timestamp with Flow start time. At/above target is
  zero need, not a discharge instruction or a valid zero-duration configuration.
  Repeated changed-duration configuration resets the policy budget; an estimate
  helper is not continuous SOC control or proof the physical target will be reached.
- Health views must report independent source ages rather than call every source
  healthy after one successful refresh. Whitelist labels/advice instead of rendering
  raw diagnostic errors/IDs. Current source updates are not live settlement or
  complete future horizons; optional dispatch failures need no destructive re-pair.
- A cheap slot's existence does not establish enough capacity. Sum clipped real
  time across separated qualifying periods and require complete fresh coverage
  before reporting either sufficient or insufficient. A standalone next-local-
  deadline condition is distinct from a configured plan's fixed absolute deadline
  and persisted remaining budget; repeated setup would start a new budget.
- Whole-plan fallback selection does not mean the current period is fallback.
  Derive the current decision from the active selected slot and keep aggregate
  selection separate. Explain insufficient duration without relaxing the ceiling.
- Read-only plan diagnostics may expose unknown/unconfigured with labelled outputs;
  invertible conditions must raise on those states. Reconcile cached state without
  persisting, creating timers, replaying events or resetting the duration budget.
  An explanation is not a new trigger or proof of physical charging.
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
- Flow-owned price-band inputs are p/kWh upper bounds, not colour IDs. Direct
  values and optional Number-variable tags express the same limits; never silently
  inherit a widget instance's settings. Bands include their upper boundary, while
  “below X” charging eligibility is strict. Explain current checks, horizon
  availability and configured-plan lifecycle separately.
- A future-availability condition in an OR branch can allow a start during an
  expensive current slot. Use current plan eligibility at start; future existence
  is a planning question. Neither a condition nor Else continuously watches state.
- A battery-low event and a selected-period start are independent edges. Recipes
  need both guarded start paths to cover either order; two simultaneous Flows can
  still duplicate battery commands, so use idempotent actions or a user-owned guard.
  Stop runs must not depend on the battery remaining low or the price being cheap.
- Legacy price-change/cheapest-start triggers only run after an observed numeric
  change, not every equal-price boundary. Keep their contracts explicit; configured
  plan boundary/expiry timers are cache-only and do not require provider refreshes.

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
| Stale data must not create success-shaped automation. | Preserve an explicit unknown/error outcome when inversion of false could grant permission; actions fail explicitly on missing required data. |
| Unsupported GraphQL fields can break an otherwise useful query. | Keep optional fields isolated or backed off. Do not replace REST billing data. |

## Testing Patterns

- Action output tokens make a card Advanced-only in Homey, even without an
  explicit `advanced` flag. Check manifest tokens before promising Standard Flow
  setup; retain existing outputs and use a separately scoped additive no-output
  action if Standard-only configuration is required.
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
| A documentation sync is not app delivery. | Keep release SHA/channel/runtime observations dated; do not reinstall, republish or claim field acceptance merely to refresh a handover. |
| Cloud read access does not prove the CLI devkit upload route works. | If direct discovery fails and cloud devkit upload returns 400, use the supported Developer Tools build-install route on the explicitly selected Pro. Verify the installed version and identity/settings/Flow fingerprints independently; never use a clean install or restart as an unapproved connectivity workaround. |

## Security and Privacy

- Build support exports from whitelisted fields, never by serialising then
  redacting device/settings objects. Opaque keys are still stable identifiers.
  Use ephemeral positions, bounded counts, enums and null unknowns; exclude names,
  values, SOC, periods, deadlines and raw errors. User review/download is explicit,
  not auto-upload. Counts/plan caps can still reveal household behaviour.
- Per-value source ages must use the matching domain (month cost is monthly_cost,
  not billing_summary) and have no whole-device fallback. Name successful cached
  checks accurately; a recent check does not prove a new value or live settlement.
- A targeted lint-chain migration can remove an unpatched transitive dependency
  without changing Node 22/ESLint 8 or runtime dependencies. Verify npm ci, full
  lint/tests and both audit scopes; do not treat audit remediation as full ecosystem
  modernisation or infer GitHub alert closure before merging and readback.
- Store credentials only in Homey device storage or GitHub Secrets.
- Redact account numbers, meter identifiers, device identifiers, tokens, and API errors.
- Use synthetic Octopus-format identifiers in tests.
- Keep repair identity-safe. A replacement physical meter is a new device.
- Keep consent-gated writes disabled by default and fail closed.
- Abstract private support feedback into generic requirements. Do not commit
  sender identities, private-thread links, message quotes or screenshots. A
  support reply or intention to test is not an affected-account acceptance result.
