# Project Handover

Last updated: 18 July 2026

## Current state

- Repository: `zarbjustin/homey-octopus-energy` (private), default branch `main`.
- App ID: `uk.co.zarb.octopusenergy`.
- Current version: `1.0.13`; release tag: `v1.0.13`.
- Homey App Store: Build 13 / version `1.0.13` is live.
- Automatic publication after certification approval is enabled.
- Test channel: https://homey.app/a/uk.co.zarb.octopusenergy/test/
- Build status: https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/13
- Community support topic: https://community.homey.app/t/156860
- Version `1.0.10` was the last confirmed local Homey Pro installation;
  `1.0.11` and `1.0.12` were metadata-only App Store releases.
- `main` contains a post-release maintenance candidate for `1.0.14`; it has not
  been versioned, installed, or published.
- Validation baseline: 68 tests pass, lint passes, dependency audit reports zero
  known vulnerabilities, and Homey `publish` validation passes.

## Post-v1.0.13 maintenance candidate

- Adds the missing custom Repair views for electricity, gas, and export meters.
- Makes Repair wait for in-flight work, apply credentials through the device,
  clear account-scoped caches, and discard a cached Home Mini device id.
- Stops plunge-price triggers and notifications repeating for every consecutive
  negative-price slot.
- Requires both price and carbon data for the Flow condition that promises both
  thresholds.
- Prices partial final EV charge slots using only the requested energy.
- Uses one-register candidate tariff codes when comparing from Economy 7.
- Prevents stale widget settings from silently displaying another meter and
  escapes user/upstream text rendered by widgets.
- Updates user-facing Free Electricity wording to Octopus Power Up while keeping
  the existing Flow IDs for compatibility.

## What v1.0.13 contains

- Keeps an otherwise reachable meter available when only its current price is
  temporarily missing; authentication still fails immediately and transient
  total outages require three consecutive refresh failures.
- Falls back to one bounded page of recent rates when a narrow date window omits
  a long-lived fixed or non-dynamic tariff rate.
- Rediscovers the active tariff and retries a failed price refresh once.
- Updates Octoplus points to the current `loyaltyPointsBalance` GraphQL contract.
- Moves Saving Sessions and Power Up events to Octopus's current authenticated
  backend schema and separates `TURN_DOWN` from `TURN_UP` events.
- Records redacted Saving Sessions poll diagnostics in the Homey app settings.

## What v1.0.12 contains

- Links the App Store listing to the public Homey Community support topic.
- Adds searchable tags for tariffs, meters, prices, gas, solar, and export.
- Removes App Store links to the private development repository.

## What v1.0.11 contains

- Adds Homey's native optional PayPal donation metadata for PayPal.me user
  `zarbie`.
- Homey only displays the Donate button for non-verified developers.

## What v1.0.10 contains

Sprints 33-39 completed the bug-bash hardening phase:

- Current Agile/export slots remain eligible in cheapest/peak "now" decisions.
- Contiguous plans reject missing half-hours and incomplete charge plans.
- Refresh locking is generation-safe; Carbon API calls have timeouts and retries.
- Empty current-rate responses make the device unhealthy instead of preserving a
  stale price as healthy.
- Saving Sessions and dispatch polling are isolated per Octopus account.
- Device repair refuses to silently bind to a different meter identity.
- GitHub Actions are pinned to immutable commits with explicit permissions.
- Authenticated Octopus pagination cannot leave the configured API origin.
- Balance requests are deduplicated and expensive reporting calls are cached.
- Standing charges use historical daily rates; deadlines are DST-aware.
- Device, poller, Flow-contract, repair, and release-policy tests were added.

## Architecture map

- `app.ts`: app-level Flow registration, shared balance cache, account pollers.
- `lib/OctopusClient.ts`: authenticated Octopus REST client and pagination.
- `lib/KrakenClient.ts`: Octopus GraphQL/Kraken account and smart-device calls.
- `lib/OctopusMeterDevice.ts`: shared refresh, pricing, consumption, reporting,
  planning, health, and scheduling behavior.
- `lib/OctopusMeterDriver.ts`: discovery, pairing, and identity-safe repair.
- `lib/AccountPoller.ts`, `DispatchPoller.ts`, `SavingSessionsPoller.ts`:
  account-scoped background event polling.
- `drivers/`: electricity, gas, and export specializations and Flow listeners.
- `widgets/`: Agile, price, carbon, export, summary, and timeline widgets.
- `.homeycompose/`: source manifests for capabilities, flows, drivers, and app data.
- `test/`: pure logic plus device, poller, repair, Flow, and release regressions.

## Invariants and decisions

- Node.js 22 or newer is required.
- `package.json`, `package-lock.json`, `.homeycompose/app.json`, and generated
  `app.json` must carry the same release version.
- Homey's publisher updates its own manifests and changelog but does not update
  npm package metadata. Always synchronize `package.json` and `package-lock.json`
  after a Homey version bump, rerun tests, commit, and push.
- API keys and account numbers belong only in Homey's device store. Never place
  real credentials in logs, screenshots, fixtures, issues, or documentation.
- Repair must preserve MPAN/MPRN and serial identity. A replacement meter should
  be added as a new device rather than silently changing an existing device.
- App-level Saving Session and dispatch state must remain keyed by account.
- Price-window helpers must include an active slot where appropriate and verify
  actual half-hour adjacency before calling a block contiguous.
- Import and export devices expose only the cumulative direction they measure.
  Do not add fake zero-value capabilities to silence validation warnings.

## Expected warnings

Homey publish validation reports exactly two accepted warnings:

- Electricity is cumulative import-only and lacks an exported capability.
- Export is cumulative export-only and lacks an imported capability.

These are intentional and documented in the README. Any additional warning or
validation error should be investigated.

## Release runbook

1. Confirm a clean worktree and aligned versions.
2. Run `npm run lint`, `npm test`, and `npm audit`.
3. Run `npx homey app validate --level publish`.
4. Install on the local hub with `npx homey app install` and smoke-test devices,
   widgets, and representative Flows.
5. Commit and push the implementation.
6. Run `npx homey app publish`, choose the intended version, enter the changelog,
   and allow the Homey CLI to commit/tag/push its version bump.
7. Synchronize npm package metadata to the new version and push that follow-up.
8. In Homey Developer Tools, publish the build to Test and submit it for
   certification. Keep automatic publication enabled when desired.

## Next actions

1. Install the maintenance candidate on the local Homey Pro and smoke-test Repair
   for one electricity meter plus gas/export where available.
2. Confirm an existing meter retains its Flows and cumulative history after
   Repair, and that invalid credentials leave the device unchanged.
3. Bump the patch version to `1.0.14`, add the changelog, commit/tag/push, and
   publish only after the local Repair smoke test passes.
4. Continue monitoring the live `1.0.13` tariff and GraphQL fixes through
   diagnostics and community feedback.

## Useful release commits

- `98ad3fc` - bug-bash hardening implementation.
- `6ac139f` - Homey version bump and tag for `v1.0.10`.
- `0c87ef9` - npm metadata synchronized to `1.0.10`.
- `a13f413` - meter recovery and current Octoplus integrations for `v1.0.13`.
