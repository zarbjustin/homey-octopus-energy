# Maintenance, Metric Freshness and Support Snapshot

9 October 2026. This extends the [charging/UI candidate](charging-summary-health-and-battery.md).
Delivered as v1.0.40 / Build 40 Test and installed on the selected Pro. GitHub
CI/CodeQL, release provenance and scoped upgrade/API checks pass. Earlier local
candidate records describe intermediate states, not current availability. No Live promotion,
production Flow edit, forced refresh or battery command is authorised here.

## Implementation

- Upgrade `eslint-config-athom` to 4.0.2 and Homey lint plugin to 3.0.0, retaining
  ESLint 8 and Node 22. The newer TypeScript lint parser removes the unpatched
  `braces`/`globby` chain. Patch `js-yaml` to 4.3.2 and `brace-expansion` to
  1.1.21/5.0.12 in the lockfile. Remove the obsolete parser-specific override.
  `npm ci --ignore-scripts`, full audit and production audit report zero findings.
- Keep the existing unused-catch policy, permit Homey's TypeScript/CommonJS entry
  points explicitly and preserve the asynchronous onDeleted hook with a narrowly
  explained SDK-type exception. Promise executor formatting does not change timers.
  CI now audits development tooling separately; production release gates remain.
  Checkout/setup-node action pins remain unchanged. Legacy ESLint/glob deprecation
  warnings are not a claim that their whole ecosystem is modernised.
- Summary values have independent source badges: balance → balance, usage/cost
  (24h) → meter_data, month → monthly_cost, points → points. Never inherit the
  device-wide or billing-period refresh for a missing source. Invalid/future dates
  and missing/nonfinite values are unknown; valid zero remains zero. Retain values
  with stale badges and label usage/cost as delayed settlement.
- Badge ages describe the last successful **source check**, not necessarily the
  time the displayed reading changed. Existing background caches/reporting can
  reuse values; recent source checks do not guarantee live demand, complete future
  prices or complete settlement. No new polling or capability/settings/Flow ID.
- App Settings offers explicit Create → review/copy → Download JSON → Clear.
  Opening settings does not generate a snapshot, downloading does not recollect,
  and a failed retry clears any old preview. No automatic upload or persistence.
  Browser download may be blocked by the Homey container; the read-only text
  preview provides a copy fallback and remains a real-Homey acceptance check.
- New authenticated GET `/support/snapshot` builds an allowlisted cache-only
  snapshot, not a redact-and-export of raw objects. It contains app version,
  ephemeral meter positions/kinds, whitelisted source states/ages, plan decision
  and bounded caps/duration, session counts/attempt ages and dispatch aggregates.
  Unknown fields are null, not zero. Reads fail independently and sampling is
  bounded to 100 meters/accounts with explicit truncation flags.
- Exclude credentials, names, stable IDs (including opaque keys), raw settings,
  errors/logs/payloads, readings/balances, SOC, selected periods and deadlines.
  Counts and plan limits can still reveal household behaviour: review before
  sharing. The endpoint is protected by Homey, not public; no added permission.

## Evidence

- 742 tests pass, zero failures/skips. Covers privacy allowlists, invalid/future
  timestamps, null/zero semantics, bounded sampling, authenticated manifest route,
  failure isolation, user initiation/retry/clear and repeated real cached getters
  across cold/current/stale/failure paths with no provider calls or writes.
- Node 22 TypeScript/Homey builds, lint and publish validation pass; only the two
  expected directional cumulative warnings. Fresh reproducible install audits
  both development and production scopes with zero findings.
- All 94 released Flow contracts and every prior manifest field are preserved
  after excluding the six additive charging cards and the new protected API route.
- Synthetic 390px light/dark Summary visual checks, keyboard disclosure, no
  horizontal overflow and Settings keyboard generation/review/download/clear pass.
  The downloaded JSON was synthetic and retained outside Git. This is not Homey
  mobile/runtime, assistive-technology, requester or physical acceptance.
- Pre-install read-only Pro smoke at 21:00 UTC: v1.0.39 enabled/not crashed,
  two available meters, six Standard/five Advanced Flows. Baseline fingerprints
  recorded privately outside Git. One degraded dispatch account is known baseline.

## Test Acceptance Checklist

| Check | Method / expected result | Status |
|---|---|---|
| Release provenance | Reviewed merge, green CI/CodeQL, release version/tag/build agree | Verified v1.0.40 / Build 40 |
| Pro upgrade integrity | Supported upgrade, responding app API, enabled/not crashed, two available meters; identity/settings/Flow fingerprints unchanged | Verified; CLI running/ready flags unavailable |
| Snapshot runtime | Protected GET and Settings preview on Pro; expected version; no identifiers/errors; null unknowns retained | Protected GET verified; actual Settings preview/download still pending |
| Widget runtime/mobile | Choose existing meters, independent badge ages, narrow layout, keyboard disclosure and retained focus | Pending |
| Standard setup / Number tags | Inspect card selection and fractional duration tags using a separately approved notification-only test Flow | Pending; no production Flow edits |
| Planning transitions | Actual unknown/recovery, fallback, deadline, cancellation and restart delivery | Pending; no forced provider outage/refresh/restart |
| SOC freshness | Real reading timestamps reject stale/future input; never substitute Flow time | Pending; no battery command |
| Test channel | Read back exact new version/build Test; Live remains unchanged | Verified Build 40 Test; Build 38 Live unchanged |

Do not close shortened-S76, requester, IOG-night, unsupported-tariff, exact request
count or physical response gates from these checks. Existing workflows assign the
release version. No certification, Live or community posting follows automatically.

## Delivery Record

PR #54 initially passed lint/build/tests/audits but Athom's Docker wrappers failed
before validation with repeated Docker Hub HTTP 429 responses. A separate deliberate
maintenance commit replaces those three wrappers with their equivalent official
Homey CLI 4.3.1 commands on Node 22: publish-level validate, version/changelog,
and headless publish using the existing step-scoped secret. No secret is extracted
or logged, no check is skipped, and release PR/check/tag gates remain. The CLI pin
matches the locally validated tool; it is not a claim that all CLI transitive
dependencies are lockfile-pinned or covered by the app's development audit.
CodeQL's two case-sensitive HTML assertions were strengthened with mixed-case
fixtures and case-insensitive checks; runtime escaping was unchanged.

- Implementation PR #54 merged as `1ae9f39`, release PR #55 as `08784e7`.
  Current-head CI runs `37991835991`/`37991841363`, validation runs
  `37991835984`/`37991841354` and CodeQL `37991837192` succeeded.
- Version run `37992003666` and release-PR CodeQL `37992109851` passed.
  Release run `37992298423` created annotated tag/release `v1.0.40`, resolving
  to `08784e7bfd1366714a21e8db37ff8f28a3829953`.
- Exact-tag publish run `37992347564` succeeded and created Build 40 (1.91 MB).
  Manual Test promotion and supported Developer Tools Install on the selected
  Pro completed. Readback at 21:18 UTC confirmed v1.0.40 enabled/not crashed,
  two available meters and all four private before/after fingerprints unchanged.
  Six Standard and five Advanced Flows remain untouched. No clean install.
- Protected cached GET responds with schema 1, version 1.0.40, two successful
  freshness reads and an unconfigured electricity plan. Known degraded dispatch
  count remains one. This is app runtime evidence, not a configured-plan field pass.
  CLI `running`/`ready` flags are null, not falsely recorded as true.
- Developer Tools verifies Build 40 Test, Build 39 superseded and Build 38 still
  Live. No certification or Live promotion. GitHub Dependabot and open code-scanning
  alert readback show zero open alerts after merge. Future action-runtime/runner
  upkeep remains separate; the existing checkout/setup-node runtime warns about
  its Node 20 declaration while the app/CLI commands use Node 22.
- Baseline, post-upgrade smoke, support snapshot and portal proof remain private
  outside Git under the workspace's `artifacts` directory. Actual Settings/mobile,
  Number-tag setup, notification transitions, overnight/requester and physical
  acceptance remain explicitly open. No provider refresh, production Flow edit,
  restart, battery control or community posting was performed.
