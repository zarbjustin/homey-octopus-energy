# Draft community reply to Darren — IOG fix CONFIRMED + "Next price" explained

Context: community topic 156860. Darren confirmed v1.0.21 works (log `c0da5fef`:
"Price-gap recovery: pricing from the account HalfHourly agreement rows (authoritative)",
message "I think its working :)"). His follow-up: he expected "Next price" to be the IOG
23:30→05:30 cheap window. This reply confirms the fix, explains Next-price semantics, and
asks one precise diagnostic question (does "Lowest today" show the ~7p rate?) to determine
whether his half-hourly rows encode the overnight rate or whether the cheap window is
dispatch-only.

**Status: drafted, ready to post.**

---

🎉 That's the one, Darren — thank you! Your log shows exactly what I was hoping for:

> Price-gap recovery: pricing from the account HalfHourly agreement rows (authoritative)

So the app is now reading your real half-hourly prices straight from your account and showing
them. Genuinely appreciate you sticking with me through all the back-and-forth to get here.

On your **Next price** question — good eye, and it's actually working as intended, it's just
that "Next price" means something a bit narrower than you'd expect:

- **Next price = the unit rate for the *next half-hour slot* (the coming 30 minutes)** — not
  "when the next cheap window starts". So during the day it correctly shows your day rate,
  and it'll only flip to the cheap overnight rate in the **half-hour just before 23:30**. If
  you glance at it around 23:00–23:30 you should see it drop to your ~7p rate.

One quick thing that'll tell us your data is fully healthy: what do **"Lowest today"** and
**"Highest today"** show on the device right now?

- If **Lowest today ≈ 7p** and **Highest today ≈ your day rate**, then your half-hourly feed
  includes the cheap window perfectly and everything's spot-on — Next price will show the 7p
  the moment the overnight slot is next.
- If **Lowest and Highest are the same** (both the day rate), that means Octopus is publishing
  your overnight cheapness via *smart dispatch* rather than in the half-hourly rate feed — in
  which case the guaranteed cheap window shows up through the smart-charging tiles rather than
  the unit-rate cards. Let me know and I'll make sure that's surfaced clearly.

Either way the "unavailable" bug is dead. And if it'd be genuinely useful, I'm very open to
adding a dedicated **"next cheap-rate window"** indicator for Intelligent Octopus Go — that
feels like the thing you actually want at a glance. Would that help? 🐙
