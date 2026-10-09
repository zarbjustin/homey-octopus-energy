# Maintenance, Metric Freshness and Support Snapshot

9 October 2026. This extends the [charging/UI candidate](charging-summary-health-and-battery.md).
Local validation is complete. GitHub review, release preparation, Pro installation
and Test delivery are authorised but not yet verified. Source version is 1.0.39;
released Build 39 does not include this combined candidate. No Live promotion,
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
  CI now audits development tooling separately; existing production release gates
  and immutable action pins remain unchanged. Legacy ESLint/glob deprecation
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

- 741 tests pass, zero failures/skips. Covers privacy allowlists, invalid/future
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
| Release provenance | Reviewed merge, green CI/CodeQL, release version/tag/build agree | Pending |
| Pro upgrade integrity | Normal install, running/enabled/not crashed, two available meters; identity/settings/Flow fingerprints unchanged | Pending |
| Snapshot runtime | Protected GET and Settings preview on Pro; expected version; no identifiers/errors; null unknowns retained | Pending |
| Widget runtime/mobile | Choose existing meters, independent badge ages, narrow layout, keyboard disclosure and retained focus | Pending |
| Standard setup / Number tags | Inspect card selection and fractional duration tags using a separately approved notification-only test Flow | Pending; no production Flow edits |
| Planning transitions | Actual unknown/recovery, fallback, deadline, cancellation and restart delivery | Pending; no forced provider outage/refresh/restart |
| SOC freshness | Real reading timestamps reject stale/future input; never substitute Flow time | Pending; no battery command |
| Test channel | Read back exact new version/build Test; Live remains unchanged | Pending |

Do not close shortened-S76, requester, IOG-night, unsupported-tariff, exact request
count or physical response gates from these checks. Existing workflows assign the
release version. No certification, Live or community posting follows automatically.

## Delivery Record

Pending review/CI, release workflow and independently verified Pro/Test readback.
