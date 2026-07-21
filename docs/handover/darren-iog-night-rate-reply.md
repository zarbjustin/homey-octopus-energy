# Reply to Darren — IOG night rate + planned-dispatch fix

Context: Darren sent three diagnostics (21 Jul 2026):
- Octopus app "Your tariffs" screen shows a **distinct two-rate tariff**: Night **6.90p**,
  Day **28.86p**, standing **59.05p** — so the cheap band IS a published rate, not a settlement
  credit (this answers the open question from the v1.0.24 reply).
- Homey tiles (logs `a3e2c46c-…`, `f8ce44a4-…`) show everything priced flat at **28.86p**
  (Current/Next/Lowest/Highest/Average), **Off-peak cost today £0**, **Cheap-charge window
  (planned): No**, **Next planned charge slot: —** — even at 23:03, 25 min before the cheap window.
- Octopus app shows a live smart-charge plan (00:30–01:00, 02:00–05:30, 09:00–09:30).
- Logs: `Dispatch poll failed: Device status could not be fetched` / `Unable to fetch planned
  dispatches`.

---

Hi Darren,

That's a brilliant set of screenshots — they cracked both problems. Thank you.

**1. Everything priced at 28.86p / off-peak £0 / no cheap window — now fixable.**
You confirmed the important bit: your Night rate (6.90p, 23:30–05:30) is a *real published rate*,
not an after-the-fact credit. The catch is that Octopus's half-hourly API feed for your IOG
account only hands us the **single day rate (28.86p)** — the 6.90p band simply isn't in the data we
receive, which is why every price tile flattened and the cheap-charge planner couldn't find a cheap
window.

I've added a small setting so you can restore correct pricing: **Device → Settings → "IOG off-peak
(night) rate (p/kWh inc VAT)"** — set it to **6.90**. The app then builds a proper day/night price
across the guaranteed 23:30–05:30 window, so Current/Next price flip to 6.90p overnight,
Lowest/Highest/Average separate out, Off-peak cost today fills in, and the **Cheap-charge window /
Next planned charge slot** tiles start working again (those are the app's own cheapest-window
planner — they were blinded by the flat price). Leave it at 0 to keep the Octopus-published value.

**2. "Next planned charge slot: —" and the dispatch-poll errors — fixed.**
Separately, the app was failing to read your Zappi's smart-charge plan: one non-essential field
(the device's live status) was erroring and taking the *whole* dispatch read down with it
("Device status could not be fetched"). It now tolerates that so your planned dispatches can come
through, and it's more robust if one linked device hiccups. With your car plugged in you should see
the planned slots populate.

If you can update on Test, set the night rate to 6.90, and grab a fresh screenshot (ideally around
the 23:30 changeover), that'll confirm both fixes end-to-end.

Really appreciate the thorough testing, Darren.

Cheers,
Justin
