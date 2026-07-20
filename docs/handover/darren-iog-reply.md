# Draft community reply to Darren — IOG price-gap fix (v1.0.18)

Context: community topic 156860 (Octopus Energy for Homey). Darren (@Darren_McCarthy)
reported an Intelligent Octopus Go import meter showing a blank price + connection
warning; diagnostics `3b8df610` etc. confirmed `primaryCount: 0` / `fallbackCount: 0`.
Root cause + fix shipped in **v1.0.18** (see HANDOVER.md). This reply is written in
zarbie's community tone (warm, plain-English, honest about needing field confirmation).

**Status: drafted, NOT yet posted.** Do NOT claim the incident fixed until Darren
confirms on the Test build. Post only after the v1.0.18 build is promoted to Test.

---

Good news @Darren_McCarthy — I think we've finally cracked it! 🎉

Your last diagnostic was the key. It turns out this was never a smart-meter or Home Mini problem at all — it's specific to how **Intelligent Octopus Go** publishes prices.

Unlike Agile or a standard variable tariff, IOG doesn't expose your half-hourly unit rates through Octopus's public price feed — there simply are no rows there (which is exactly what your `primaryCount: 0` / `fallbackCount: 0` was telling us). For IOG, the only place your real household day/night rate lives is on your **account agreement**. The app already knew to look there… but it was matching on the exact tariff code stored against your meter, and on your account that code had drifted slightly out of step. So the app kept looking for a code that no longer matched your live agreement and — frustratingly — walked straight past the real one sitting right next to it. Hence the endless "no rate covering the current time".

I've reworked that recovery so it now:

- reads your **actual active IOG day/night agreement** from the account even when the stored tariff code has changed (and quietly adopts the correct code so it stays fixed);
- keeps everything fail-safe — it will only ever use a genuine, active IOG import agreement, never guess, and never invent a price;
- stops those **"Kraken request budget exhausted"** lines showing up as errors. Those were actually harmless — the app deliberately skipping an optional refresh to stay under Octopus's shared rate limit and keeping your last value — but they read like faults in the log, which wasn't fair on you. They're now treated as the quiet, expected skips they are.

This is all in **v1.0.18**, which I've just pushed to Test. Once it lands, could you update and let it run for a bit? Your import price and the connection warning should both sort themselves out.

One honest caveat: I can't see your account from my side, so while I'm confident in the fix, you're my ground truth here. If anything's still off, the new build writes a much clearer (still fully anonymised) diagnostic that will tell me straight away whether your account is handing over the agreement as expected — so a fresh log would pin it down immediately.

Thanks again for sticking with me on this one and for the brilliant diagnostics — genuinely couldn't have found it without them. 🙏🐙
