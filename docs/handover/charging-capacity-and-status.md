# Charging Capacity and Status Follow-up

The subsequent four approved follow-ups extend this candidate. Read the
[latest summary/health/battery record](charging-summary-health-and-battery.md)
for the combined six-card candidate and current evidence. This entry records the
initial four-card implementation, not an independently released build.

9 October 2026. Status: implemented and validated locally, **not released or
installed**. Source version remains 1.0.39; released Build 39 does not contain
these additions. The user authorised code investigation and implementation first.
No release, installation, live Flow change, battery command or support reply was
performed. This is a scoped charging/supportability follow-up, not full S78 closure.

## Scope and Contracts

| New card | Purpose | Boundary |
|---|---|---|
| `configure_charging_plan_standard` | No-output setup available to Standard Flows | Same arguments and single persisted controller as the existing Advanced action; no second scheduler |
| `enough_threshold_time_before` | Check a supplied duration strictly below a supplied price before the next local deadline | Sum remaining clipped time across separated slots; not measured charging, energy or SOC |
| `charging_plan_decision_is` | Check a known current plan decision | Unknown/unconfigured raises, including inversion; not a new event trigger |
| `get_charging_plan_status` | Advanced read-only decision, explanation, status, selection, active and estimate outputs | Reconcile cached prices without writes, polling, timers or event replay; unknown is explicitly labelled |

Known decisions distinguish current preferred eligibility, current bounded
fallback eligibility, waiting for a selected period, insufficient capacity, no
qualifying slots, duration completion and a passed fixed deadline. Aggregate
`selection` can be fallback while the currently eligible period is preferred.
Diagnostic-only results also include waiting for prices and not configured.

All 94 released Flow cards, their IDs/titles/arguments/tokens and all other
manifest fields remain unchanged after removing the four additions. The original
configuration action retains its four output tokens and remains Advanced-only.
There are no new settings, persisted keys, capabilities, dependencies or widgets.
The existing planner, cache update lifecycle and local boundary timers are reused.

## Planning Behaviour and Safety

- Capacity counts only time remaining now through the resolved deadline. Later
  cheap periods are irrelevant; complete fresh half-hour coverage is required.
  Gaps, overlaps, malformed rates or stale prices remain unknown, not insufficient.
- The independent capacity question uses the duration supplied to that condition,
  not a battery SOC target or a configured plan's remaining budget. Its next-local-
  deadline semantics do not roll a configured plan's fixed absolute deadline.
- Existing bounded planning supplements preferred slots early when necessary;
  it does not wait until all preferred opportunities are exhausted. Hard fallback
  maximum remains inclusive; preferred threshold remains strict. Insufficient
  total permitted capacity leaves eligibility off without relaxing any price cap.
- Ordinary cached-rate updates already re-evaluate remaining time and price
  corrections. No fixed 16:00 publication assumption or provider refresh is added.
- Planned elapsed eligibility is not proof of measured charging or delivered SOC.
  Independent native limits and stop Flows remain necessary. Automatic SOC sizing,
  solar and export control are not implemented in this follow-up.

See the [charging Flow guide](../charging-flows.md) for setup and guarded
start/late-battery/stop examples. Guidance marks candidate-only cards explicitly.

## Local Evidence

Before work, clean local `main` and fresh GitHub `main` readback both resolved to
`8e52c0aed1c30a0f516892d4c9414a29b0c0b078`. No commit or push in this step.

- Node 22.23.2; TypeScript build passes.
- 703 tests pass with zero failures or skips: prior 678 plus 21 new pure/device/
  listener cases and four generated card-parity cases.
- ESLint passes; production dependency audit reports zero vulnerabilities.
- Normal Homey build regenerates Compose into `app.json`; publish-level validation
  succeeds with only the two expected cumulative-direction warnings.
- Manifest comparison against the starting commit confirms all 94 released Flow
  contracts and all other manifest fields unchanged after excluding the additions.
- Synthetic tests cover partial current/final slots, separated periods, strict
  thresholds, explicit zero/negative prices, invalid input, incomplete/ambiguous/
  stale horizons, UK DST transitions, hard ceilings and early bounded fallback.
- Device/listener tests forbid provider calls and diagnostic writes/timers/events,
  cover unknown inversion, and prove both configuration actions share persistence,
  preserve elapsed budget and do not emit a duplicate start. Diagnostic reads do
  not replay lifecycle events or reset a plan.

No live provider, battery or production Flow was exercised. Existing dated
release/install/channel evidence remains in the [S78 record](s78-charging-guidance.md),
not current-delivery evidence for this candidate.

## Pending Delivery and Acceptance

1. Review the source candidate, obtain green GitHub checks and use the normal
   release workflow within separately confirmed delivery scope. Assign a new
   version there; do not upload changed code as released v1.0.39.
2. Build normally immediately before any authorised install; test harnesses mutate
   `.homeybuild`. Independently verify installation, channel and version, retaining
   identities/settings/Flow fingerprints. No clean install or re-pair is implied.
3. Check real Homey Standard card discovery/selection, mobile hints, literal
   numbers and compatible Number tags. Trial with notifications/logging first:
   partial current slots, preferred/fallback distinction, early fallback, separated
   periods, missing prices, price republication, fixed deadline and no duplicate edge.
4. Ask for required duration and desired policy; automatic battery sizing needs
   target/current SOC, usable capacity, validated rate and a concrete integration.
   Requester/UI acceptance does not establish physical battery response.
5. Keep S76 shortened-soak, reporter, overnight and unsupported-tariff gaps open.
   Broader S77/S78 and S79 solar/export proposals remain separate. Physical charging,
   certification/Live promotion and community posting need their own authority.

This record contains generic implementation requirements only. No private source
messages, identities, screenshots, payloads or private-thread links are retained.
