# Project Handover

Last updated: 19 July 2026

## Current state

- Repository: `zarbjustin/homey-octopus-energy` (public), default branch `main`.
- App ID: `uk.co.zarb.octopusenergy`.
- Current source version: `1.0.16`; release tag: `v1.0.16` (GitHub release published).
- Homey App Store: Build 13 / version `1.0.13` remains live. Build 16 / version
  `1.0.16` is in Test for affected-account verification and is not in certification.
- Build 15 / version `1.0.15` was retracted from certification on 19 July 2026 so
  Build 16 could replace it in Test.
- Test channel: https://homey.app/a/uk.co.zarb.octopusenergy/test/
- Build 14 / version `1.0.14` was also previously retracted from certification.
- Build status: https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/16
- Community support topic: https://community.homey.app/t/156860
- `main` contains the `1.0.16` release (tag `v1.0.16`, merge `1075391`).
- Version `1.0.16` was built, validated, packed, and installed successfully on
  `Justin's Homey Pro` on 19 July 2026.
- Sprint 41 was completed through PRs #10-#11 on `main` with 121 passing tests;
  lint, dependency audit and Homey publish validation pass as recorded below.
- GitHub has no open pull requests and the remote contains only `main`. Any local
  remote-tracking references for earlier `release/*` or `agent/*` branches are
  stale, fully merged history and can be removed with `git fetch --prune`.

## Next-model entry point

- Sprint 41 implementation is complete on `main`; future feature work starts
  with Sprint 42.
- Read `docs/handover/future-sprints.md` before selecting or implementing a
  future sprint. It contains the dependency order, acceptance gates, current
  release boundaries, and a copyable prompt for another AI model.
- Sprint 41's contract record is `docs/research/kraken-contracts.md`. The roadmap
  does not require David Piper's code; implementation remains original and based
  on public Octopus contracts. Any later source reuse is a separate GPL and
  attribution decision.
- Work on one sprint at a time using a short-lived branch and pull request. Do
  not combine an unrelated incident fix, release bump, or App Store action with
  a feature sprint.

## Active investigation — import current-price gap (`1.0.16` Test candidate)

- A user (Darren) on community topic 156860 reported an import electricity meter
  still showing a connection problem and blank price on `1.0.13`, while the Mini
  live readings and other integrations worked. Replacing the device reproduced the
  price failure immediately (deterministic — points away from stale device state).
- The fresh `1.0.15` diagnostic identifies an `IOG` import product for which
  both public REST rate requests return zero rows. Rediscovery and the product
  variant lookup return no alternative. The Test build's advisory/availability
  and points-backoff behavior worked as designed.
- What `1.0.15` changed for this incident:
  - A price-only gap no longer raises the generic connection alarm; it shows a
    non-blocking advisory and the device stays available (`refreshHealthDecision`,
    `setHealth`). This directly answers "shows a connection error in the status".
  - Guarded product-derived tariff-variant recovery: if rediscovery returns the
    same tariff code, it tries the code the product advertises for the meter's
    region/register count, reverting on failure (targets a variant mismatch).
  - Privacy-safe `price-gap diagnostic (no identifiers)` log line records row
    counts, open-ended counts, and day-only validity bounds so the next report
    distinguishes variant-mismatch vs closed-agreement vs upstream gap.
  - Octoplus points `Unauthorized.` no longer logs every cycle: it is treated as
    an unsupported field (null) with a 24 h backoff.
- The sanitised evidence, ranked hypotheses, and the decision tree for reading a
  fresh diagnostic are in `docs/reviews/import-price-gap-handover.md`.
- Sprint 41 adds a narrowly guarded production recovery: a matching current
  GraphQL `DayNightTariff` or `FourRateEvTariff` can supply IOG's household base
  day/night rates. It requires exact tariff and product identity and fails closed
  for mismatches, malformed rates, unsupported unions or GraphQL failure. Dispatches
  are not overlaid because the legacy account response does not prove device,
  SMART/BOOST type or settlement price.
- This candidate is released to Homey Test as Build 16 but is not confirmed on
  Darren's account. Do not claim the incident fixed or submit it for production
  certification until the affected account verifies it.
- A model-neutral review prompt is in
  `docs/reviews/import-price-gap-analysis-prompt.md` for independent analysis.
- Community post 14 promises a Test-build follow-up. Build 16 is now available at
  https://homey.app/a/uk.co.zarb.octopusenergy/test/ but the follow-up reply has
  been drafted but is not confirmed as posted. The approved draft tells Darren
  that `1.0.16` adds guarded legacy/four-rate IOG recovery, asks him to keep the
  existing device, and requests confirmation or a fresh diagnostic while blank.
  Do not report the post as published unless the user confirms it or the forum
  visibly shows it.

### Draft reply to Darren

```text
Hi Darren,

Thank you again for the diagnostics and for helping test this.

I've now published version 1.0.16 to the Homey Test channel. It adds guarded
support for the newer Intelligent Octopus Go four-rate tariff contract identified
during the investigation, while keeping household and EV-specific rates separate.

You can install it here:
https://homey.app/a/uk.co.zarb.octopusenergy/test/

Please keep your existing Electricity Meter device rather than deleting and
pairing it again. Once updated, could you let me know whether the current household
price now appears?

If it remains blank, please submit another diagnostic while the price is missing
and include the approximate time. That will show whether your account exposes the
expected tariff contract or another variant we still need to handle.

Thanks again for your patience and detailed feedback. It has been extremely useful
in narrowing this down.
```

## Sprint 40 security reconciliation

- PR #3 selectively reconciled the useful parts of the superseded security PR.
- API and pairing requests now enforce HTTPS and trusted origins, follow redirects
  manually, redact upstream error bodies, and honour bounded `Retry-After` delays.
- Pagination validates each next URL, rejects repeated URLs, and has a 50-page cap.
- Pairing state is isolated per Homey pair session.
- The existing serial-aware transactional repair lifecycle remains intact.

## Sprint 41 Kraken contracts and IOG recovery

- Merged research PR: #10; merged production-completion PR: #11.
- Contract dossier: `docs/research/kraken-contracts.md`.
- Synthetic fixtures: `test/fixtures/kraken/`; a test rejects credential-shaped
  content and any fixture identifier not visibly prefixed `synthetic-`.
- Public schema research covers Home Mini telemetry, electricity tariff unions,
  smart devices, account/device dispatches and relative-price ownership.
- REST remains authoritative for meter identity, consumption, rate history and
  billing. GraphQL is operational/enrichment data except for the exact-match,
  fail-closed IOG household-base recovery.
- David Piper's GPL-3.0 repository was reviewed as prior art at commit `1042af3`.
  No code, query text, fixture, name or algorithm was copied/adapted. Private
  correspondence is not reproduced in this public repository.
- Sprint 43 owns device-aware SMART/BOOST and settlement semantics; Sprint 44 owns
  effective-price Flows. Sprint 41 intentionally does not infer discounts from
  ambiguous account-level dispatch windows.

## Sprint 43 device-aware dispatch truth model (DELIVERED, unreleased)

On branch `feat/sprint-43-dispatch-truth` (PR pending). New pure `lib/dispatch/`
core (types, deviceModel, reconcile state machine), device-scoped
`getDevices`/`getFlexPlannedDispatches` + `getCompletedDispatchWindows` (all via the
F0 budget), and a rewritten `DispatchPoller` that drives the existing
`dispatch_started/ended/completed/active` Flow cards from honest reconciled state.
A vanished planned window is cancelled only on a successful poll; a failed poll
retains prior state (never fabricates a cancellation/ended edge). Completed dedup
uses a high-water mark. Aggregate identifier-free `dispatch_diagnostics_v2`. No
price/effective-rate logic (Sprint 44). Dual-model design (Opus 4.8 + GPT-5.5) +
GPT-5.5 review; 167 tests pass; lint + build clean; no version bump. Next per the
spec is Sprint 45 (billing-period summary).

## Sprint 42 shared Kraken budget and live-data poller (DELIVERED, unreleased)

On branch `feat/sprint-42-shared-kraken-poller` (PR pending). Implements Foundation
F0 — one account-scoped Kraken request budget (`lib/KrakenBudget.ts`) enforced inside
`KrakenClient.post()`, with core/live/best-effort priorities and a 429 backoff gate —
plus a shared, subscription-based live-demand source (`lib/LiveDemandSource.ts`) with
an internal freshness struct (`lib/freshness.ts`, F1). Electricity live power now uses
the shared source instead of a 30s-per-device timer, fixing a latent throttling bug.
New app setting `live_demand_cadence_s` (60/120/300s, default 120). No version bump;
145 tests pass. Designed and reviewed with Claude Opus 4.8 + GPT-5.5. Spec:
`docs/handover/sprints-42-48-spec.md`; the next sprint per that spec is 43 (dispatch
truth model). Do not release without field verification.

## What v1.0.15 contains

Fixes and diagnostics for the import current-price gap and Octoplus points
(community topic 156860, posts #11–#12). Delivered via PR #5 and released in PR #6.

- Import price-only degradation is now surfaced as a non-blocking advisory
  (`setWarning`) instead of the generic connection alarm; the device stays
  available. `alarm_generic` is reserved for genuine connectivity/auth failures
  (`refreshHealthDecision`, `setHealth`). This is intentional: it does NOT revert
  to the pre-1.0.10 behaviour of showing a stale price as current.
- Guarded product-derived tariff-variant recovery (`tryProductVariantRecovery`):
  after same-code rediscovery, tries the tariff code the product advertises for
  the meter's region and register count, retries the price refresh once, and
  reverts the stored tariff code if the retry still fails (never persists an
  unverified guess).
- Privacy-safe price-gap diagnostic (`logPriceGapDiagnostic`): logs fuel, role,
  register, product family, dynamic flag, primary/fallback row counts, open-ended
  counts, and day-only validity bounds — no credentials, identifiers, tariff
  codes, or raw bodies.
- Octoplus points `Unauthorized.`/enrolment errors are treated as an unsupported
  field (`getOctoplusPoints` returns null via `isUnsupportedFieldError`) with a
  24 h backoff and a single log line; genuinely transient errors are re-thrown and
  capped to hourly retries.
- Fixes the `Update Homey App Version` workflow to sync `package.json` (and its
  lockfile) to the bumped version, so automated release PRs no longer fail the
  manifest-version test.
- Root cause of the missing current rate for the affected tariff is still open —
  see the Active investigation section and the incident handover doc.



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
  npm package metadata. The `Update Homey App Version` workflow now includes a
  "Sync package.json version" step that reconciles `package.json` and
  `package-lock.json` automatically; a manual `npx homey app publish` still
  requires you to sync npm metadata yourself, rerun tests, commit, and push.
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

## Release automation

- `Update Homey App Version` (`homey-app-version.yml`, manual `workflow_dispatch`)
  bumps the manifests + changelog, syncs `package.json`, validates, and opens a
  `release/vX.Y.Z` PR.
- `Create GitHub Release` (`homey-app-release.yml`) triggers on push to `main`,
  reads the version, and creates the annotated tag + GitHub release when missing.
- `Publish Homey App` (`homey-app-publish.yml`, manual `workflow_dispatch`)
  publishes the build to the Homey App Store (requires the `HOMEY_PAT` secret,
  which is configured).
- GitHub currently warns that the pinned checkout/setup-node actions target the
  deprecated Node 20 action runtime and are being forced onto Node 24. The
  warning did not affect Build 16, but the pinned actions should be reviewed in
  a separate maintenance change when upstream releases compatible revisions.
- CAVEAT observed on 19 July 2026: merging a release PR via the `gh` CLI did NOT
  emit the `push` event that triggers `Create GitHub Release` (merging via the
  GitHub web UI does). If a release PR is merged from the CLI, create the tag and
  release manually: `git tag -a vX.Y.Z -m "Release vX.Y.Z" <sha> && git push
  origin refs/tags/vX.Y.Z` then `gh release create vX.Y.Z --verify-tag --title
  vX.Y.Z --generate-notes`. `v1.0.15` was created this way; the automated release
  workflow successfully created `v1.0.16` after PR #14 merged.

## Next actions

1. Ask Darren to install Build 16 / `1.0.16` from the Test link without replacing
   the existing device.
2. Ask for one fresh diagnostic while the price is blank, or confirmation that the
   current household price now appears, plus the exact tariff/register type.
3. Read the `price-gap diagnostic (no identifiers)` and IOG recovery output;
   submit Build 16 for certification only after affected-account confirmation.
4. If the price remains blank, inspect the newly observed sanitised contract shape
   and extend fixtures before changing matching or fallback safeguards.
5. After production approval, announce `1.0.16` in the community support topic.
6. Continue monitoring the advisory/health behaviour and community feedback.
7. Smoke-test Repair for one electricity meter plus gas/export where available;
   confirm invalid credentials leave the existing device unchanged.

## Useful release commits

- `98ad3fc` - bug-bash hardening implementation.
- `6ac139f` - Homey version bump and tag for `v1.0.10`.
- `0c87ef9` - npm metadata synchronized to `1.0.10`.
- `a13f413` - meter recovery and current Octoplus integrations for `v1.0.13`.
- `43b4af3` - Sprint 40 API and pairing hardening.
- `f2d08f9` - import price-gap fixes, points backoff, diagnostics, guarded
  variant recovery, and price-only advisory health state (PR #5).
- `16e5143` - `v1.0.15` release: version bump, changelog, version-workflow fix (PR #6).
- `1075391` - `v1.0.16` release and Homey Build 16 source (PR #14).
- `69e2fdc` - Build 16 Test deployment and field-verification handover (PR #15).
