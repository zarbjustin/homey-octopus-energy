# Charging Flow Setup and Controls

Updated: 9 October 2026. These examples use the configured-plan cards delivered
in v1.0.38. Updated hints are delivered in v1.0.39 / Build 39 Test and on local Pro.
The examples have synthetic regression coverage, not real-Homey or battery
acceptance. Nothing here installs a Flow or controls a battery.

The six cards and Summary/settings improvements in the **9 October source candidate** below are not yet released
or installed. v1.0.39 does not contain them. Release/Test delivery and real Homey
UI/requester checks remain separate gates.

## Choose the question first

| What you want to know | Card | What true means |
|---|---|---|
| Is a cheap slot available later? | There are slots below a price before a deadline | At least one qualifying slot exists between now and the deadline; it may not be active now |
| Is enough cheap time left? (source candidate) | There is enough cheap time before a deadline | The sum of remaining qualifying time reaches the supplied duration; not measured charging or SOC |
| Does the current slot meet my price cap? | A qualifying price slot is active now | The current slot is strictly below the cap, with a complete fresh horizon |
| Should my configured plan allow charging now? | Configured charging plan is active | Now is inside a selected period of this meter's configured plan |
| Why did my plan select this period? (source candidate) | Configured charging plan decision is… / Get charging plan status and explanation | Current preferred/fallback eligibility, waiting, insufficient capacity, elapsed budget or deadline; diagnostic action also describes unknown/unconfigured |
| Is the current price in a colour band? | Current price is in a configured band | The current price is in the supplied numeric band; no future schedule is created |
| Is now the cheapest remaining half-hour? | Now is the cheapest half-hour in the next X h | The current price ties the lowest remaining published price in that rolling window; not the whole calendar day |

A condition is checked when its Flow runs. It does not wait until it becomes
true or arrange another run. An OR branch that only checks future availability
can therefore start charging immediately, even while the current slot is costly.
An Else action is checked on that same run; it does not keep watching for a stop.

Example with invented prices: the current slot is 29p and the next slot is 18p.
There are slots below 20p before your deadline, but the plan is inactive now.
It becomes active when the 18p slot starts, not when it is first discovered.

## Setup Flow and Three Standard Control Flows

In released v1.0.39, **Configure a charging eligibility plan** returns output
tags, so Homey makes it available only in Advanced Flow. Create the daily setup
there; the start, battery-low and stop Flows below can be Standard Flows.
[Homey's action-token documentation](https://apps.developer.homey.app/the-basics/flow/tokens#tokens-for-advanced-flow)
explains this restriction. The source candidate adds **Configure a charging
eligibility plan (Standard compatible)** with identical inputs and no output tags.
It uses the same controller and persisted plan, not a second scheduler. Once
released, use it for the setup below in Standard or Advanced Flow. Keep the original
Advanced action when you need its output tags. Existing cards are unchanged.

Choose your meter, deadline, cap, start threshold and target from your own battery
policy. The values below are examples, not a recommendation for a battery.
Keep the battery integration's protections and an independent native stop limit.
The Octopus app selects eligibility; your existing integration sends commands.

### 1. Configure the plan

**When:** a daily time you choose, before the intended charging deadline.

**Then:** on the chosen meter, **Configure a charging eligibility plan**:

Use Advanced Flow on v1.0.39. For the source candidate, the **Configure a charging eligibility plan (Standard compatible)** action supports Standard setup with the same fields.

- Selection: **all**.
- Price: **20 p/kWh**.
- Deadline: **07:00**, meaning the next real occurrence in Homey's timezone.
- Duration: **1 h**, fallback **off**, maximum **20 p/kWh**. These three fields
  are required inputs but ignored in all mode.

Do not add a battery force-charge action to this configuration Flow. Missing
future prices leave a pending unknown plan, without permission to charge.
Existing background price updates can resolve it later. No fixed publication
time or forced Octopus refresh every 30 minutes is required.

Configure before enabling the two start Flows below. Enabling a Flow while a run
is already active does not replay a missed start event. Use a deliberate, guarded
evaluation of current eligibility if needed; never bypass it by testing the battery
action alone. An identical policy/deadline is idempotent; a different policy or
deadline replaces the previous plan and can change eligibility immediately.
Do not repeatedly configure on a timer: a new deadline can replace the plan.

### 2. Start when a selected period begins

**When:** **Configured charging plan run started** on the selected meter.

**And:** **Configured charging plan is active**, battery is below your chosen
start threshold, and the battery integration's consent/safety conditions pass.

**Then:** the battery integration's idempotent charging-start action, using your
chosen target and rate. Do not use future-slot availability as an OR shortcut.

### 3. Start if the battery becomes low during an active period

**When:** the battery integration's battery-below-threshold event.

**And:** **Configured charging plan is active**, battery is still below the same
start threshold, and the same consent/safety conditions pass.

**Then:** the same idempotent charging-start action as Flow 2.

This handles a battery that was above the threshold when the price period began.
If the battery was already low beforehand, Flow 2 handles the later period start.
Two nearly simultaneous triggers can both run: the battery action must be safe to
repeat, or use a user-owned guard. Do not assume the app deduplicates battery
commands across separate Flows.

### 4. Stop when the selected period ends

**When:** **Configured charging plan run ended** on the selected meter.

**Then:** the battery integration's idempotent stop action.

Do not put a price, plan-active or battery-low condition before stop. A gap,
deadline, cancellation, changed plan or stale/incomplete prices can end a run.
Keep an independent battery-native target/time stop: Flow events are attempted
at most once, not guaranteed delivered after a crash or communication failure.

## Behaviour to expect

- Adjacent qualifying half-hours remain one active run, even at equal prices.
  A gap produces an end event; a later qualifying period produces a new start.
- The configured plan owns a local boundary/expiry timer using cached rates.
  Evaluating a condition is not a provider refresh.
- Unknown or stale prices raise an error from the current-eligibility condition,
  including inversion. An Advanced Flow error branch must not start charging or
  enable a more expensive fallback. A Standard Flow Else is not an error handler.
- Planned eligible duration is not measured charging time or delivered energy;
  battery conditions can prevent a start even while the plan is eligible.
- Colour bands use inclusive upper limits; slots “below 20p” exclude exactly 20p.
  Negative prices are separate from the green band. Direct numbers and optional
  Number tags do not inherit a widget instance's settings.
- The legacy unit-rate-changed and cheapest-half-hour-started triggers run on
  observed numeric price changes, not every equal-priced half-hour. They seed
  without firing on the first reading and are not a 30-minute watchdog.

## Cheapest duration is a different policy

If you want a required duration rather than every slot below a cap, configure
**duration** mode. It prefers qualifying slots and can supplement only the
remaining duration with the cheapest permitted slots when fallback is explicitly
enabled. Your hard maximum is not raised. See the
[bounded-fallback recipe](handover/sprints-81-83-charging-flows.md#advanced-flow-recipe-optional-bounded-fallback).

The rolling cheapest-half-hour condition is not a fixed cheapest-today schedule.
It compares available published rows, not a guaranteed complete horizon. Do not
invert a legacy cheapest/current-price condition to grant charging permission on
missing data; use the configured-plan eligibility condition's explicit error path.
Confirm whether you mean every slot below a cap, a fixed amount of cheapest time,
or one absolute cheapest half-hour before requesting a new card.

## Enough cheap time, not just one cheap slot (source candidate)

**There is enough cheap time before a deadline** accepts a required eligible
duration, strict price threshold and HH:MM deadline in Homey's timezone. It counts
separated qualifying periods, only the unelapsed part of the active half-hour,
and no time after the deadline. Missing, stale, overlapping or incomplete prices
raise an error even when the condition is inverted. A published price equal to
the threshold does not qualify; zero is literal, not a default value.

This is an independent planning question: the duration is supplied by the user,
not calculated from battery SOC or taken from the configured plan's remaining
budget. The deadline is the next local occurrence when the condition runs. The
configured plan retains its original fixed absolute deadline. Do not repeatedly
reconfigure just because a deadline condition now refers to the following day.
Neither condition watches the battery or starts a Flow by itself.

Example using invented values: choose **duration 3 h**, preferred **below 10p**,
deadline **16:00**, fallback **on**, maximum **25p inclusive**. If only one hour
below 10p remains, the existing duration planner supplements with the cheapest
two permitted hours before 16:00. A cheaper 22:30 slot does not count. The planner
may select a yellow-price period before a later green period: it does not wait
until cheap time is exhausted and risk missing the deadline. These colour labels
are illustrative; the policy uses explicit numeric prices, not widget colours.

If all permitted periods together cannot supply three hours, there is no eligible
partial plan: the decision is insufficient capacity. The hard maximum is not
raised automatically. If prices are incomplete, the decision is waiting for prices,
not insufficient capacity or no qualifying slots. Your native SOC/time stops
remain essential; the planner can spend eligible-time budget even if another
battery condition prevented physical charging.

## Explain a configured plan (source candidate)

The Standard-compatible **Configured charging plan decision is…** condition
offers:

- eligible now at the preferred price;
- eligible now using permitted fallback;
- waiting for a selected period;
- insufficient permitted time;
- no qualifying slots before the deadline;
- planned eligible-time budget elapsed;
- deadline passed.

Preferred/fallback here describe the **current period**, not all selected periods.
An active preferred slot can coexist with a fallback slot later in the same plan.
Unknown or unconfigured states raise an error in this condition, including
inversion; do not use an error branch as permission to charge. Pair any start
decision with **Configured charging plan is active** and battery protections.

**Get charging plan status and explanation** returns diagnostic output tags in
Advanced Flow: decision, explanation, status, whole-plan selection, eligibility
active and an estimate/safety label. It can explicitly report `waiting_for_prices`
or `not_configured`; its false active tag is not evidence of no cheaper slots.
It reads current cached state without writing, creating timers, emitting events,
resetting the deadline or sending battery commands. It is suitable for a user-owned
notification at setup or existing plan events. It does not create a new notification
cadence or a decision-change trigger itself; use the separate candidate trigger
below when you want change notifications.

Existing background price refreshes and local plan timers already replan against
the fixed deadline. Do not assume a specific publication time guarantees tomorrow's
prices are available; no forced-refresh Flow or new provider polling is needed.
Automatic SOC-based duration, solar forecasts and export control are not included.

## See the plan and data health (source candidate)

The existing **Octopus Summary** widget shows the selected electricity meter's
configured plan: explanation, Homey-local dated deadline, preferred price and
fallback ceiling, remaining eligible-time budget and selected periods. Expand
**Selected periods** for dates, prices and preferred/fallback labels. Unknown
selected time is not shown as zero. Gas/export summaries do not offer a charging plan.

Expand **Data health and next steps** for independently aged prices, consumption,
balance, carbon, billing and dispatch guidance. Current means a recent source
update, not live consumption, full future coverage or physical charging. Unsupported
dispatch does not require deleting the meter; unknown/degraded does not prove
non-enrolment. The settings page also shows each recorded source's last successful
update, failures and coverage gaps without rendering raw error payloads or IDs.
These views are cache-only and do not refresh Octopus or alter a configured plan.

## Notify when a decision changes (source candidate)

Use **Charging plan decision changed** as the When card with a user-owned
notification or logging action. It supplies `decision`, `explanation` and
`observed_at`, describing the plan at the evaluation time. Changes include initial
setup, waiting/recovery, preferred/fallback eligibility, whole-plan fallback
selection, insufficient capacity, duration completion, deadline and cancellation.
Changing numeric prices or remaining-time countdown alone does not repeat the event.
There is no automatic timeline notification; users choose whether/how to notify.

Older plans seed silently on upgrade. Decision attempts are persisted before
emission, so repeated refreshes and restarts do not replay them. Attempts are not
guaranteed delivery: a crash or earlier lifecycle-delivery failure can lose a
notification. A diagnostic delivery failure does not break existing setup/control
cards. No new timer or polling cadence is added. This is not a battery-start
trigger; a delayed event is not current permission. Recheck current eligibility
and keep independent battery-native stop limits.

## Estimate duration from a battery target (source candidate)

In Advanced Flow, **Estimate charging duration for a battery target** takes:

- current and target SOC percentages;
- usable battery capacity in kWh, not a nominal capacity with unknown reserve;
- constant **AC input** charging power in kW, not watts or DC output power;
- AC-to-stored-energy efficiency as a percentage;
- the actual SOC measurement timestamp in ISO format with timezone;
- maximum allowed reading age, explicitly chosen between 1 and 60 minutes.

The helper makes no battery/device calls. Supply literal values or compatible
Number tags and the real measurement timestamp from a validated integration.
Do not manufacture freshness by inserting the time the Flow happens to start.
Missing, invalid, future or stale inputs raise an error, not a zero-duration result.

Invented example: 30% to 80% of 10 usable kWh needs 5 kWh stored. At 2 kW AC
input and 90% efficiency, the estimate is 5 / 0.9 / 2 = about **2.78 hours**.
The output retains precision; it is not rounded down to a half-hour. When
`needs_charge` is true, pass `duration_hours` to the existing duration-plan setup
with your chosen price cap, deadline and fallback ceiling. The planner still
requires full fresh prices and can report insufficient capacity.

At/above target, `needs_charge` is false and estimated duration is zero. Use a
user-owned stop/cancel path if appropriate; never pass zero into plan configuration.
Estimates over 24 hours are rejected, not silently truncated to a partial target.

Configure once for the intended deadline. Repeated SOC recalculation with a changed
duration creates a different policy and resets the eligible-time budget; this
helper is not continuous closed-loop SOC planning. Constant-power assumptions omit
tapering, house loads and changing conditions, so reaching target is not guaranteed.
It does not discover battery limits or control hardware. Keep independent stops.
Automatic battery integration, solar forecasts and export optimisation remain separate.

## Test without battery commands first

Use a temporary notification/log action in place of start/stop commands. Record
the app version, approximate times, chosen cap/deadline, expected periods and
observed start/end/current-eligibility results. Exercise a battery-low event both
before and during an eligible period. Do not post identifiers or raw diagnostics.
Real-Homey UI, event delivery and physical response remain separate checks.
