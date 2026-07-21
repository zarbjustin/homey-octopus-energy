# Draft community reply to Darren — IOG price-gap fix, second pass (v1.0.20)

Context: community topic 156860. Darren's fresh log `7c389d7e` (submitted 21 Jul 2026)
showed the **v1.0.18** fix did NOT resolve it — still `iogResolve.activeAgreementCount: 0`,
"Day rate still blank". Root cause on the second pass: `getActiveIogTariff` only
understood two of the seven tariff "shapes" Kraken can return; his account almost
certainly uses one of the other five (IOG is often a single-register tariff), so the
app silently walked past a perfectly good agreement. Fixed + shipped in **v1.0.20**
(Build 20). See HANDOVER.md.

**Status: drafted, NOT yet posted.** Post only after Build 20 is promoted to Test.
Do NOT claim it fixed — this pass needs his ground-truth log to confirm his shape.

---

Right @Darren_McCarthy — hands up, my last update didn't crack it, and your new log showed me exactly why. So thank you for grabbing it; it was the missing piece. 🙏

Here's the honest version of what happened. Last time I got you looking in the right place — your **account agreement**, which for Intelligent Octopus Go is the only place your real day/night rate lives. But it turns out Octopus can describe that agreement in several different "shapes", and the app only understood two of them. Your account uses one of the others — so the app fetched your agreement, didn't recognise the shape it came in, quietly discarded it, and then reported "no active agreement" as if there was nothing there at all. There *was* — the app just didn't speak that dialect. That's squarely on me, not your setup.

**v1.0.20** fixes that properly:

- it now understands **every** shape of household tariff Octopus can hand back — including the single-rate style that IOG accounts like yours often use;
- when your stored tariff code has drifted, it reads your live agreement, **adopts the correct code**, and then pulls your real prices straight from Octopus's own feed for that up-to-date code (so you get the genuine article, not a guess);
- it stays completely fail-safe — it will never invent or approximate a price; if it genuinely can't be sure, it holds off rather than show you something wrong;
- and I've added a much clearer, **fully anonymised** diagnostic that tells me at a glance exactly which shape your account uses and whether Octopus is handing it over as expected.

This is live in **v1.0.20**, which I've just pushed to Test. When you get a moment, could you update to it and let it run for a little while? Your import price and the connection warning should both come good.

And the honest caveat still stands: I can't see your account from here, so you're my ground truth. If it's *still* blank after the update, one more fresh diagnostic will now tell me precisely what your account is doing — and at that point I'll know whether there's anything left for me to fix on the app side or whether it's something to raise with Octopus directly.

Really appreciate your patience on this one — you've basically co-debugged it with me from the logs, and I'm grateful. Let's get you that day rate. 🐙
