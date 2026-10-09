# Charging Summary, Decision Events, Battery Estimate and Data Health

9 October 2026. All four recommended follow-ups are implemented locally on top
of the [initial capacity/status candidate](charging-capacity-and-status.md).
Source version remains 1.0.39. The combined six-card/UI candidate is **not in
released Build 39**, not committed/pushed, and not installed or published here.
No production Flow, battery setting or App Store channel was changed.

## Implemented Scope

1. **Plan summary:** the existing Summary widget shows the selected electricity
   meter's dated Homey-local deadline, preferred/fallback ceiling, remaining
   eligible-time budget and expandable selected periods with prices/labels.
   Unknown selected time is null, not zero; corrupt stored plans become a safe
   unavailable message. Gas/export meters do not offer a charging plan.
2. **Decision-change events:** the additive `charging_plan_decision_changed`
   device trigger carries decision, explanation and evaluation timestamp. Initial
   setup, semantic decision and aggregate fallback-selection changes emit once;
   prices/countdowns/equal-decision boundaries do not. Older plans seed silently.
   An optional `decisionKey` in the existing `charging_plan_v1` state is saved
   before emission; no new storage key, provider polling or timer is added.
3. **Battery-duration helper:** `estimate_battery_duration` is an Advanced action
   with explicit current/target SOC, usable kWh, AC input kW, efficiency percentage
   and real measurement timestamp/max age (1–60 min). It returns estimated stored
   and input energy, unrounded duration, needs-charge and assumptions/safety label.
   Invalid/stale/future timestamps and estimates over 24 h reject; at/above target
   returns zero need, not discharge or valid zero-duration plan setup.
4. **App-wide health presentation:** Summary/settings describe independently
   aged prices, consumption, balance, carbon and billing plus dispatch guidance.
   Optional unsupported dispatch is separate from unknown/degraded; neither
   requires deleting/re-pairing a healthy meter. Labels/advice are whitelisted;
   raw error payloads and identifiers are not rendered in the new health views.

Summary reads are cache-only, including cold, missing, stale and failed paths.
Existing widget refresh cadence is unchanged. Keyboard-operated disclosures
retain expanded state and focus across render refreshes and resize the widget.
No new widget, battery discovery, closed-loop SOC planning or solar/export logic.

## Preserved Contracts and Notification Limits

All 94 released Flow IDs/titles/arguments/tokens and other manifest fields remain
unchanged after removing the six additive cards. The original Advanced setup's
output tokens remain; the separate no-output Standard action shares its controller.
Existing eligibility run-start/end semantics and persisted duration budget remain.

Decision attempts are at-most-once, not guaranteed delivery. A crash between save
and emission, or a preceding lifecycle-delivery error, can lose a diagnostic;
restart does not replay it. Diagnostic-delivery failures are reported without
failing old configuration/control actions. There is no automatic timeline post:
users must attach their own notification/log action. Event tokens describe the
evaluation time, not necessarily the delivery time; recheck current eligibility
before any separately authorised battery action and retain native stop guards.

SOC duration assumes constant AC power and efficiency; tapering/house loads and
actual hardware response are not measured. Feed the estimate into the existing
duration planner only when needs-charge is true, once for the intended deadline.
Reconfiguring a changed duration creates a new policy/budget, not continuous
remaining-SOC adjustment. Never fabricate a measurement timestamp from Flow time.

## Local Validation

- Node 22 TypeScript build and normal Homey Compose build pass.
- 726 tests pass, zero failures/skips. Includes pure duration/health/summary,
  controller dedup/migration/restart/failure/timing and actual device/listener paths.
- All seven widgets retain cold/current/stale/failure zero-outbound-read tests.
- Lint passes; production audit has zero vulnerabilities; publish validation passes
  with only the two documented cumulative-direction warnings.
- Manifest comparison preserves all 94 released contracts and all other fields.
- Synthetic 390px Chromium light/dark Summary previews: no page errors or
  horizontal overflow, keyboard disclosure access, expansion/focus retention,
  height updates and one mocked cache API call. Settings preview verifies ages,
  coverage guidance, no raw error/ID rendering and no settings writes.
- Synthetic screenshots are outside Git. This is browser-level evidence, not a
  real Homey mobile/runtime, requester, battery or assistive-technology acceptance.

The first full run exposed two old adapter assertions which counted every trigger
as a control edge. They now explicitly expect the new diagnostic event while
retaining the original eligibility/control-edge and equal-price-boundary checks.

## Next Gates

Review/CI, release version assignment, authorised install and Test-channel readback
remain next. Build normally before installing; tests mutate `.homeybuild`.
No release, Live/certification or public posting authority is inferred here.

Use notification-only real Homey tests before physical control: select Standard
setup, inspect Summary/mobile hints, enter Number tags, supply real SOC timestamps,
verify unknown/recovery/fallback/expiry/cancel events and silent restart. Check
reading freshness and native SOC/time stops independently. Requester/overnight/
unsupported-account and shortened-S76 coverage gaps remain open; a passing unit
suite or synthetic browser is not their closure. Broader S77/S78 and S79/S80 remain
separate proposals; no private correspondence is reproduced.
