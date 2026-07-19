# Project Handover

Last updated: 19 July 2026

## Current state

- Repository: `zarbjustin/homey-octopus-energy` (public), default branch `main`.
- App ID: `uk.co.zarb.octopusenergy`.
- Current source version: `1.0.14`; release tag: `v1.0.14`.
- Homey App Store: Build 13 / version `1.0.13` is live.
- Automatic publication after certification approval is enabled.
- Test channel: https://homey.app/a/uk.co.zarb.octopusenergy/test/
- Build 14 / version `1.0.14` is published to Test and under certification review.
  Automatic publication after approval is enabled.
- Build status: https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/14
- Community support topic: https://community.homey.app/t/156860
- Version `1.0.14` was installed successfully on `Justin's Homey Pro` on
  19 July 2026. A streamed development-mode startup check could not be run
  because Docker was not running on the development Mac.
- `main` contains the `1.0.14` release and matches uploaded Build 14.
- Validation baseline: 93 tests pass, lint passes, dependency audit reports zero
  known vulnerabilities, and Homey `publish` validation passes.

## Active investigation

- A user on the community support topic reports that an import electricity meter
  still shows a connection problem and blank price capabilities on `1.0.13`.
- Other integrations continue to return data, and replacing the device reproduced
  the price failure immediately. This points away from stale Homey device state.
- The submitted diagnostic is not committed because it contains user and device
  identifiers. The sanitised evidence, source analysis, hypotheses, and open
  questions are in `docs/reviews/import-price-gap-handover.md`.
- A model-neutral review prompt is in
  `docs/reviews/import-price-gap-analysis-prompt.md` for independent analysis.
- Current `main` / `1.0.14` still has the same current-rate fallback path as
  `1.0.13`; Sprint 40 did not claim to resolve this incident.

## Sprint 40 security reconciliation

- PR #3 selectively reconciled the useful parts of the superseded security PR.
- API and pairing requests now enforce HTTPS and trusted origins, follow redirects
  manually, redact upstream error bodies, and honour bounded `Retry-After` delays.
- Pagination validates each next URL, rejects repeated URLs, and has a 50-page cap.
- Pairing state is isolated per Homey pair session.
- The existing serial-aware transactional repair lifecycle remains intact.

## What v1.0.14 contains

- Adds the missing custom Repair views for electricity, gas, and export meters.
- Makes Repair wait for in-flight work, apply credentials transactionally with
  rollback, clear account-scoped caches, and discard a cached Home Mini device id.
- Validates manual meter identities and verifies account credentials before a
  manually entered meter can be paired.
- Shares Kraken clients and dispatch requests per account, deduplicates concurrent
  requests, and bounds app-level caches.
- Adds privacy-safe per-integration diagnostics and device freshness state without
  exposing API keys, full account numbers, meter numbers, or serials.
- Stops plunge-price triggers and notifications repeating for every consecutive
  negative-price slot.
- Requires both price and carbon data for the Flow condition that promises both
  thresholds.
- Prices partial final EV charge slots using only the requested energy.
- Discovers real regional tariff codes from Octopus product metadata when
  comparing tariffs, including Economy 7 and gas tariff tables.
- Prevents stale widget settings from silently displaying another meter and
  escapes user/upstream text rendered by widgets. Widgets now expose stale or
  unhealthy data, accessible live regions and controls, and resilient long names.
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

- `app.ts`: app-level Flow registration, bounded account clients/caches, pollers.
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
- App-level clients, Saving Session state, and dispatch state must remain keyed by
  account; cached credentials must be invalidated when an API key changes.
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

1. Independently review the current-rate gap using the sanitised incident handover
   and analysis prompt before choosing a fix.
2. Add privacy-safe rate-shape diagnostics and focused fixtures that reproduce the
   selected root cause before changing fallback or health behaviour.
3. Confirm the installed `1.0.14` meters continue refreshing normally.
4. Smoke-test Repair for one electricity meter plus gas/export where available;
   confirm invalid credentials leave the existing device unchanged.
5. Monitor Build 14 certification; Homey will publish it automatically after
   approval.
6. Monitor the new integration diagnostics and community feedback after release.

## Useful release commits

- `98ad3fc` - bug-bash hardening implementation.
- `6ac139f` - Homey version bump and tag for `v1.0.10`.
- `0c87ef9` - npm metadata synchronized to `1.0.10`.
- `a13f413` - meter recovery and current Octoplus integrations for `v1.0.13`.
- `43b4af3` - Sprint 40 API and pairing hardening.
