# Mini throttle recovery — 23 October 2026

## Evidence and scope

A manually submitted diagnostic on v1.0.40 Test shows seven consecutive
live-demand failures at approximately one-minute intervals: GraphQL
`KT-CT-1199` / `Too many requests`. It does not establish an app-process crash
or what originally exhausted the provider allowance. The separate missing
smart-charge-device error is not evidence that a Home Mini is absent.
This public record intentionally excludes reporter identity, private messages,
report/device/account IDs, screenshots and raw logs.

Portal readback on 23 October: Build 40 / v1.0.40 Test; Build 38 / v1.0.38 Live.
Build 40 contains one manual diagnostic; Build 38 has no listed reports.

## Implementation

- Classify the observed GraphQL throttle code or exact throttle messages in the
  HTTP transport layer, before success reward, auth retry or partial-data handling.
- Use existing account-wide HTTP-429 exponential cooldown and Retry-After support.
  No immediate retry, new cadence, credential reset or extra provider request.
- Skip Mini discovery/demand while a shared cooldown is active. Existing cadence
  recovers after the gate expires and the local budget permits it.
- Preserve last-known values and original timestamps. Cache-only readback ages
  retained readings; Summary shows stale/no-data separately from rate limiting.
- Summary advice is whitelisted, escaped and does not expose upstream error text
  or account identity. Settings explains why toggling/re-pairing is unnecessary.
- Existing capability, Flow, setting and device identities are unchanged.

## Verification and delivery

- All 754 tests, including 12 new regressions, pass on Node 22.23.2.
- Fresh-checkout `npm ci`, full/production audits (zero vulnerabilities), lint,
  normal Homey build and publish validation pass. Only the two expected
  cumulative-direction warnings remain. Generated app manifest is unchanged.
- Local cloud-backed `.npmrc` and `.homeyignore` files are not materialised;
  packaging was verified in a fresh validation checkout without overwriting
  or committing those local files. Existing user changes are preserved.
- Implementation PR #57 is open; CI/CodeQL and normal patch release are pending.
- Source remains 1.0.40 pending the normal release workflow. No installation,
  channel change, production Flow edit, battery command or external reply yet.

## Acceptance gates

1. Full tests, lint, normal Homey build, audits and publish validation.
2. GitHub review/CI and normal patch-release provenance; verify tag and build.
3. Test channel readback; Live/certification remain unchanged.
4. Affected-account sustained live readings after automatic cooldown recovery.
5. Real Summary/mobile UI and any local installation are separate checks.

No real Mini response or complete rate-budget accounting is proven by synthetic
tests. Existing battery/IOG/shortened-soak acceptance gaps remain open.
