# Project Handover

Last updated: 13 July 2026

## Current state

- Repository: `zarbjustin/homey-octopus-energy` (private), default branch `main`.
- App ID: `uk.co.zarb.octopusenergy`.
- Current version: `1.0.10`; release tag: `v1.0.10`.
- Homey Developer Tools: Build 10 is submitted for certification and is under review.
- Automatic publication after certification approval is enabled.
- Test channel: https://homey.app/a/uk.co.zarb.octopusenergy/test/
- Build status: https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/10
- Version `1.0.10` is installed successfully on the local Homey Pro.
- Validation baseline: 44 tests pass, lint passes, dependency audit reports zero
  known vulnerabilities, and Homey `publish` validation passes.

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

1. Monitor Build 10 certification and respond to Homey reviewer feedback.
2. Smoke-test the Test-channel build on real Agile, gas, export, Economy 7, and
   Home Mini configurations where available.
3. Record user-reported defects as focused GitHub issues with sanitized logs.
4. Before the next feature phase, review GraphQL schema assumptions because the
   Kraken endpoints remain less stable than the public REST API.

## Useful release commits

- `98ad3fc` - bug-bash hardening implementation.
- `6ac139f` - Homey version bump and tag for `v1.0.10`.
- `0c87ef9` - npm metadata synchronized to `1.0.10`.
