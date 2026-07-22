# Flow cookbook — target-rate automations (S61 / BL-22–23)

Ready-to-build recipes for the target-rate + dispatch cards. All forward prices
are **estimates**; every card **fails closed** (does nothing) rather than guess.

## 1. "Run the dishwasher in the cheapest 3h under 15p before 07:00"
- **WHEN** — *A target-rate window started* → Duration `3`, By `07:00`, Max price `15`.
- **THEN** — turn on the smart plug.

The trigger fires **once** when the cheap window begins. If the cheapest 3h are
all above 15p, it simply doesn't fire (no wasted run at a bad price).

## 2. "Only charge the battery when it's genuinely cheap"
- **WHEN** — *The unit rate changed* (or a time trigger).
- **AND** — *Now is in a target-rate window* → Duration `4`, By `05:00`, Max price `10`.
- **THEN** — start charging. **ELSE** — stop.

## 3. "Don't fight my EV — defer to Octopus's own schedule" (Intelligent Octopus Go)
- **WHEN** — *A target-rate window started* → Duration `3`, By `07:00`, Max price `0` (no cap).
- **AND** — *A smart-charge dispatch does **not** start within* `120` min.
- **THEN** — run your appliance.

On IOG, Octopus already schedules cheap EV charging via **dispatches**. Use
target-rate for *appliances/battery*; use the dispatch condition so your Flow
stands down when the car's own cheap window is imminent.

## 4. "Tell me tonight's cheap plan" (notification)
- **WHEN** — *Rates published* (new prices landed).
- **THEN** — *Get the target-rate plan* → Duration `3`, By `07:00`, Max price `12`.
- **THEN** — send a notification using the tokens:
  *"Cheapest 3h: [[start]]–[[end]] at [[average_price]]p (target met: [[target_met]])."*

If the cap can't be met, `target_met` is **false** and `cheapest_available`
tells you the price you'd have to accept — branch on `target_met` to decide.

## Card reference
| Card | Type | What it's for |
|---|---|---|
| `target_rate_window_started` | Trigger | Push when a capped cheap window begins |
| `in_target_rate_window` | Condition | Gate: is now a capped cheap slot? |
| `get_target_rate_plan` | Action | Compute the plan → tokens (start/end/avg/`target_met`/…) |
| `dispatch_starts_within` | Condition | Is an IOG dispatch imminent? (fails closed if stale) |
| `get_next_dispatch` | Action | Next dispatch → tokens (start/end/type/…) |

Older overlapping cards (`in_cheapest_plan`, `within_cheapest_period`,
`price_percentile_below`) still work and keep their IDs — target-rate simply adds
the price cap, the push trigger, and the `target_met` result.
