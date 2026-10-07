# Charging Flow Setup and Controls

Updated: 7 October 2026. These examples use the configured-plan cards delivered
in v1.0.38. Updated hints are delivered in v1.0.39 / Build 39 Test and on local Pro.
The examples have synthetic regression coverage, not real-Homey or battery
acceptance. Nothing here installs a Flow or controls a battery.

## Choose the question first

| What you want to know | Card | What true means |
|---|---|---|
| Is a cheap slot available later? | There are slots below a price before a deadline | At least one qualifying slot exists between now and the deadline; it may not be active now |
| Does the current slot meet my price cap? | A qualifying price slot is active now | The current slot is strictly below the cap, with a complete fresh horizon |
| Should my configured plan allow charging now? | Configured charging plan is active | Now is inside a selected period of this meter's configured plan |
| Is the current price in a colour band? | Current price is in a configured band | The current price is in the supplied numeric band; no future schedule is created |
| Is now the cheapest remaining half-hour? | Now is the cheapest half-hour in the next X h | The current price ties the lowest remaining published price in that rolling window; not the whole calendar day |

A condition is checked when its Flow runs. It does not wait until it becomes
true or arrange another run. An OR branch that only checks future availability
can therefore start charging immediately, even while the current slot is costly.
An Else action is checked on that same run; it does not keep watching for a stop.

Example with invented prices: the current slot is 29p and the next slot is 18p.
There are slots below 20p before your deadline, but the plan is inactive now.
It becomes active when the 18p slot starts, not when it is first discovered.

## One Advanced Setup Flow and Three Standard Control Flows

The existing **Configure a charging eligibility plan** action returns output
tags, so Homey makes it available only in Advanced Flow. Create the daily setup
there; the start, battery-low and stop Flows below can be Standard Flows.
[Homey's action-token documentation](https://apps.developer.homey.app/the-basics/flow/tokens#tokens-for-advanced-flow)
explains this restriction. A fully Standard-only setup would need a new no-output
configuration card; that is follow-up work, not available in v1.0.39.

Choose your meter, deadline, cap, start threshold and target from your own battery
policy. The values below are examples, not a recommendation for a battery.
Keep the battery integration's protections and an independent native stop limit.
The Octopus app selects eligibility; your existing integration sends commands.

### 1. Configure the plan in Advanced Flow

**When:** a daily time you choose, before the intended charging deadline.

**Then:** on the chosen meter, **Configure a charging eligibility plan**:

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

## Test without battery commands first

Use a temporary notification/log action in place of start/stop commands. Record
the app version, approximate times, chosen cap/deadline, expected periods and
observed start/end/current-eligibility results. Exercise a battery-low event both
before and during an eligible period. Do not post identifiers or raw diagnostics.
Real-Homey UI, event delivery and physical response remain separate checks.
