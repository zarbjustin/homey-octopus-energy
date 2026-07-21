# Draft community reply to Darren — IOG price-source fix, third pass (v1.0.21)

Context: community topic 156860. Darren's log `78c9a84d` (v1.0.20) was the decisive one:
`typenameHistogram {StandardTariff:1, HalfHourlyTariff:1}`, `exactMatchFound:true`,
`halfHourlyCount:1`, REST `primaryCount:0`. His import agreement is a **HalfHourlyTariff** whose
REST feed is empty; its own `unitRates` are the real prices — which the app fetched then discarded.
He also flagged the smart-charge cards reading contradictorily ("window: No" vs "active: Yes") and
the "Not available" tile.

**Status: drafted, NOT yet posted.** Post only after v1.0.21 Build is promoted to Test. Keep the
field-verification gate open until Darren confirms.

---

Darren — third time lucky, and this time your log pinned it *exactly*. Thank you, genuinely — the new
diagnostic did precisely what it was meant to.

Here's what was happening, in plain terms. Your import tariff is published by Octopus in a "half-hourly"
shape — the real prices live in a list of half-hourly rows on your account. The app was fetching that
list… and then throwing it away, because it was still waiting for prices to arrive on Octopus's *public*
price feed, which for your tariff is simply empty. So it kept saying "no price for right now" forever.
That's why the tile showed "-" and the orange "temporarily unavailable" banner. Entirely my side, not
your setup.

**v1.0.21** fixes it properly:
- it now reads your **half-hourly prices straight from your account agreement** and uses them directly
  (the same way it handles Agile) — no more waiting on an empty feed, no guessing;
- it stays fail-safe: if a row genuinely doesn't cover the current half-hour it holds off rather than
  show you something wrong.

I also sorted the **smart-charging confusion** you (rightly) spotted. Those were two different things
wearing near-identical labels:
- **"Cheap-charge window (planned)"** — *the app's own* plan to charge in the cheapest slots (this needs
  your prices, so it was blank/"No" purely because of the price bug above);
- **"Octopus smart-charging now"** — whether *Octopus* is actively smart-charging your car (which can
  happen outside the cheap window — that's normal Intelligent Octopus Go behaviour).
They're now clearly named so "No" + "Yes" together makes sense, and the planned-window card shows "—"
(unknown) instead of a misleading "No" whenever prices aren't available yet.

Could you update to **v1.0.21** on Test and let it run a little? Your Current price, Price level and Next
price should populate, and the smart-charge cards should read sensibly. If anything's still off, one more
of your (fully anonymised) diagnostics will now tell me immediately whether your account is handing over
the half-hourly rows as expected — the new log even counts them and says whether one covers "now."

Genuinely appreciate your patience across three rounds of this — you've been the perfect debugging
partner. Let's get you that price. 🐙
