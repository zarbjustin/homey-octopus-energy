# S81–S83: Simpler Charging Flows

Captured: 4 October 2026. Updated: 5 October 2026.
Status: software delivered in v1.0.38 / Build 38 Test and installed on Pro; field acceptance pending.

## Implementation and Evidence

Primary mode is every slot strictly below a chosen p/kWh price. Optional duration
mode prefers cheap slots and supplements only the remaining duration, when the
user enables fallback, up to an inclusive hard maximum. All decisions use the
selected meter's cached rates and VAT setting. No new widget, API request,
provider polling cadence, battery command or live Flow mutation.

| Sprint | Local implementation | Evidence |
|---|---|---|
| S81 / BL-40 | Explicit bands; positive/inverted availability; rolling horizon and exact local deadline; unknown throws | Threshold equality, literal zero/negative caps, complete/fresh horizon and adapter inversion tests |
| S82 / BL-41 | Every-slot mode; bounded duration; preferred/fallback intervals; insufficient-capacity status; partial slots | Deterministic ties, opt-in supplement, hard cap, no partial success, duration-budget tests |
| S83 / BL-42 | Persisted configured plan; per-run entry/exit; price-republication replans; local boundary/expiry timer; restart dedup; cancellation | Pure/controller/device tests, crash-after-attempt, persistence failure, serialisation, cleanup and cache-only checks |

The charging-only gate passed 651 tests; the combined app-wide/reliability release
passed 672 on Node 22.23.2. Full Homey build, lint, production audit (zero
vulnerabilities) and Homey publish validation passed. Only the two expected
cumulative direction warnings were reported. All 80 existing generated Flow
card contracts match the v1.0.37 release exactly; 14 cards are additive.
Implementation PR #46 and release PR #47 merged; tag/release v1.0.38 resolve to
`6ff6c13`. Publish run `37378428284` succeeded; Build 38 promoted to Test only
on 5 October. Normal local upgrade/readback preserves two meter identities,
device settings and six standard/five Advanced Flow fingerprints.

## Contracts and Design Decisions

- Current price bands reuse the widget classifier with Flow-owned numeric bounds.
  Negative prices are separate; green is a price range, not a carbon claim.
- All new caps treat zero literally. Existing target-rate/cheapest-hours IDs and
  their legacy zero-means-uncapped contract are unchanged. The old target-rate
  calculation was audited; the bounded primitive adds strict full-horizon and
  partial-duration semantics without changing legacy behavior.
- Complete fresh half-hour coverage is required before claiming no slots. Unknown
  throws from conditions/actions, including inversion, rather than returning false.
  Configuring a plan with missing future prices stores a pending unknown policy;
  it does not start a run or activate fallback until complete rates arrive.
- Exact HH:MM resolves to the next real occurrence in Homey's timezone. Autumn
  ambiguity chooses the first future occurrence. A missing spring time chooses
  the next day's real occurrence; it is not shifted to an invented time.
- A configured plan fixes that absolute deadline. It never rolls to tomorrow on
  refresh. Repeated identical configuration before the deadline is idempotent.
- One configured plan per selected meter. Explicit replacement resets its budget;
  a rate replan or restart preserves elapsed planned-eligible duration. This is
  NOT measured charging time or delivered battery energy.
- Replans use the remaining duration, not the original amount. Adjacent selected
  slots stay active; gaps, partial final endpoints and deadline stop eligibility.
  Mid-slot price corrections are reevaluated from the existing refresh completion.
- The controller owns one local cache-only timeout for the next boundary/freshness
  expiry. It never calls refresh/network methods, and cleans up on uninit/delete.
- Each transition is persisted before attempting a Flow emission. This is
  at-most-once attempt semantics, not guaranteed delivery: a crash between
  persistence and emission can lose an event, and no synthetic replay is performed.
  Current eligibility and an independent battery stop guard are therefore required.
- Stale/incomplete prices remove eligibility and can emit run-ended with an unknown
  status; a valid recovery can begin a new eligible run. Failed reads do not mean a
  successful empty price plan. Clock rollback/malformed persisted state fails closed.

## New Additive Cards

| Area | IDs |
|---|---|
| Bands / availability | `configured_price_band`, `threshold_slots_available`, `threshold_slots_before` |
| Current eligibility | `in_threshold_slot`, `charging_plan_active` |
| Inspection actions | `get_threshold_slots`, `get_threshold_slots_before`, `get_bounded_threshold_slots` |
| Persisted plan actions | `configure_charging_plan`, `cancel_charging_plan` |
| Persisted plan triggers | `charging_plan_run_started`, `charging_plan_run_ended` |
| Lower-level observed threshold edges | `threshold_slot_started`, `threshold_slot_ended` |

The lower-level threshold cards react to adjacent observed slot transitions and
same-slot numeric corrections; they seed on restart and do not catch up across
missed observations. Prefer the configured-plan cards for bounded duration,
deadlines, stale-data exits and robust replan/restart handling.

## Standard Flow Recipe: Every Cheap Slot

1. On a chosen daily clock event, configure the selected meter: mode **all**,
   below **10p**, deadline **07:00**; duration **1**, fallback **off**, maximum
   **10** (the last three fields are ignored in all mode). A pending unknown
   result waits for complete prices; no fixed 16:00 publication assumption.
2. When **Configured charging plan run started**, AND **Configured charging plan
   is active**, AND the battery's consent, target and safety conditions, THEN
   invoke the existing battery integration's idempotent charging-start action.
3. When **Configured charging plan run ended**, THEN invoke that integration's
   idempotent stop action. Do not put a price/availability condition before stop.
4. Independently configure a battery-native target/duration stop guard. These
   Flows cannot prove physical charging, handle all communication loss, or replace
   the battery's own protection. No example is installed by this implementation.

## Advanced Flow Recipe: Optional Bounded Fallback

- Configuration: mode **duration**, required **2 h**, preferred **10p**, fallback
  **on**, hard maximum **21p**, deadline **07:00**. It selects preferred intervals
  first, then the cheapest permitted supplement, never above 21p.
- Use `status`: **complete** is a complete admissible future-duration plan,
  **insufficient** has no eligible partial plan, **unknown** waits for complete
  fresh prices. Never treat unknown as proof of no cheap slots.
- Keep the same start/stop/independent-stop branches as the all-mode recipe.
  Each separate run gets its own entry/exit. Adjacent slots do not repeat start.
  The local timer handles a partial final interval instead of rounding to a full slot.
- Use threshold availability (or its inversion) for a separate price-policy
  branch, with an explicit error/unavailable branch. Never route errors into an
  expensive fallback. Cancelling the plan clears eligibility and emits ended if
  active, but requires the connected stop Flow for any physical stop.
- JSON inspection intervals may contain gaps. Never charge continuously between
  the first selected start and last selected end merely because both exist.
- Forward prices and opportunities are estimates, not bills or guaranteed savings.

## Deployment Evidence and Remaining Field Gates

Local software validation does not establish real Homey UI/condition inversion,
Flow dispatch delivery, affected-account feedback, or physical battery response.
Normal fresh-build local delivery and Test publication are verified above.
Real UI, requester, overnight/account and physical checks remain open. Live
promotion remains separate. S76 ended early with stable samples, not a verified
48-hour pass. No pending reliability field gate was silently closed.

## Purpose and Boundaries

Help users select affordable charging slots and explicitly choose a bounded
fallback when the preferred price is unavailable. Requirements were abstracted
from private feedback; do not publish private messages or identify the sender.

The user authorised completing S81–S83 locally while retaining S76 field gaps.
S77–S80 remain separate future proposals. No release dates, installation,
publication, live Flow editing or physical battery control are authorised here.

Reuse `lib/planning/targetRate.ts`, time-window helpers, cached rates and the shared
`lib/widgetPriceBands.js` classifier. Preserve all existing Flow/capability/widget
IDs. Check current target-rate semantics before extending rather than introducing
a second competing planner. Existing numeric threshold and non-contiguous
cheapest-hours cards should be explained in S78's Flow cookbook.

## S81 / BL-40 — Price Bands and Horizon Availability

- Add composable conditions for current price band and availability below a
  numeric p/kWh threshold within an explicit horizon/deadline and selected meter.
- Design both positive and negative availability checks; do not treat inversion
  of a failed/unknown check as permission to charge. Complete fresh coverage is
  required before claiming “no slots below the threshold”.
- Keep numeric ranges authoritative. Reuse widget boundary semantics, but do not
  silently borrow settings from an arbitrary widget instance. Define Flow-owned
  threshold inputs/shared configuration explicitly before implementation.
- Distinguish price-band green from low-carbon green. Text labels include ranges;
  palette changes do not change automation policy.
- Reevaluate from cached price publication/slot events, not a hard-coded 16:00
  assumption or a new outbound polling cadence.

Acceptance: exact threshold equality and negative/zero prices; invalid band order;
missing, stale and partial horizons; tomorrow not yet published; multiple meters;
midnight and UK DST. Unknown remains unknown in every branch, including inverted
conditions. New Flow IDs, argument contracts and fail-closed outcomes are tested.

## S82 / BL-41 — Bounded Cheapest-Slot Fallback

- Extend the existing planner with required duration, deadline, preferred cap,
  explicit fallback enablement and hard fallback maximum.
- Prefer slots meeting the preferred cap. Define partial preferred availability
  deterministically: use preferred slots first and supplement only the remaining
  duration with cheapest admissible fallback slots, if enabled.
- Return selected half-hours plus explicit preferred/fallback/not-evaluated or
  insufficient-capacity status. No partial plan masquerades as a complete plan.
- Never silently raise a cap or change “red” policy. A forbidden range remains
  excluded even when there is no cheaper alternative. Price ranges, not display
  colours alone, determine the policy.
- Define inclusive band boundaries versus strict “below X” separately. Preserve
  legacy `max_price = 0` meaning (uncapped) on existing cards; new contracts must
  express a literal zero/negative cap without ambiguity.
- Require a complete fresh horizon and account for partial current/final slots.
  Forward costs remain estimates, not settlement or guaranteed savings.

Acceptance: no preferred slots, some preferred slots, fallback disabled, hard cap
unmet, insufficient duration, equal-price ties, negative rates, separated slots,
price republication, missing tomorrow, and timezone boundaries. No new requests.

## S83 / BL-42 — Slot Lifecycle and Practical Recipes

- Audit and reuse existing plan-start/end hooks before adding new IDs. Define
  entry/exit for each contiguous run of selected half-hours, not just first/last
  endpoints of a plan containing gaps.
- Adjacent selected slots keep eligibility active; unselected gaps make it false.
  Replans, equal prices, refreshes and restarts must not duplicate start commands.
- Define stale-plan and restart behaviour explicitly: no fabricated valid plan,
  no reliance on a missed edge as a physical safety mechanism. Provide a
  current-eligibility check and an independent user-configured battery stop guard.
- Supply Standard/Advanced Flow examples for cheap-only charging, optional bounded
  fallback and separated slots; show start and stop branches and unavailable data.
- Battery commands remain in the user's existing integration, with their consent
  and battery safeguards. Do not add Octopus battery writes or edit live Flows.

Acceptance: synthetic lifecycle/contract tests, full release gates during later
authorised implementation, and real-Homey readback of example Flow behaviour.
Physical charging response requires separate explicit approval; simulated
eligibility is not proof of a battery response. Accessible wording and requester
feedback are recorded separately from automated tests.

## Delivery and Support Gates

Before implementation: resolve horizon/threshold arguments, Flow-owned band
configuration, plan identity and edge/restart semantics; review safe handling of
Homey condition inversion. Treat unsafe inversion as a release blocker.

Local implementation uses the repository validation workflow. Deployment and
publication use the delivery workflow only when separately authorised. Keep Test delivery, field confirmation and Live
promotion distinct. Keep private-source feedback out of public issues/PRs.
