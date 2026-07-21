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

**1. Everything priced at 28.86p / off-peak £0 / no cheap window.**
You confirmed the key thing: your Night rate (6.90p, 23:30–05:30) is a *real published rate*. Digging
into Octopus's data feed, each half-hourly rate actually carries a hidden "type" tag (Standard vs
Off-peak) that the app wasn't reading — so it only ever saw your Standard 28.86p and priced the whole
day at it. The new build now reads that tag, so if your account publishes the 6.90p as an Off-peak
rate it will **automatically** build a proper day/night price — Current/Next flip to 6.90p overnight,
Lowest/Highest/Average separate out, Off-peak cost fills in, and the **Cheap-charge window / Next
planned charge slot** tiles (those are the app's own cheapest-window planner) start working again.

As a belt-and-braces fallback there's also a new **Device → Settings → "IOG off-peak (night) rate"**
box — if for any reason your account only exposes the day rate, set that to **6.90** and you'll get
correct day/night pricing anyway.

**2. "Next planned charge slot: —" and the dispatch-poll errors.**
Separately, one non-essential field (your device's live status) was erroring and taking the *whole*
smart-charge read down with it ("Device status could not be fetched"). It now tolerates that, so your
planned dispatches can come through, and it's more robust if a linked device hiccups.

Could you update to the new Test build, and send me **one fresh diagnostic log** after 23:30 with the
car plugged in? The log now prints exactly which rate bands your account publishes (e.g.
`STANDARD=28.86,OFF_PEAK=6.90`), which will confirm the automatic pricing end-to-end — and if it only
shows `STANDARD=28.86`, that tells me to point you at the manual box above.

Really appreciate the thorough testing, Darren.

Cheers,
Justin
