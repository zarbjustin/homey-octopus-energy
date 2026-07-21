# Reply to Darren — v1.0.23 (Lowest/Highest/Average price today)

Context: Darren reported the **Lowest**, **Highest** and **Average price today** tiles were
blank on his Intelligent Octopus Go account, even though the **current price** had started
resolving correctly after v1.0.21.

---

Hi Darren,

Thanks again — that's a really useful spot. I found the cause.

Those three "today" tiles were being built from the rows Octopus publishes with a start-time
that falls **inside today**. On Agile that's fine (48 half-hour rows, each stamped today), but on
Intelligent Octopus Go your prices come through as a **few long-lived rows** whose start-time is
often before midnight — so the day/night rates were there and driving your *current* price, but
the "today" summary saw nothing stamped today and stayed blank.

**v1.0.23** changes the summary to read your prices straight from the live schedule at each
half-hour across the day, so it works the same for IOG as it does for Agile. The overnight cheap
rate and the daytime rate should now both show up in Lowest/Highest, with a sensible Average.

Once you're on the new build, could you check those three tiles and let me know:

- **Lowest today** — does it show your overnight IOG rate (~7p)?
- **Highest today** — does it show your daytime rate (~29p)?
- **Average today** — somewhere between the two?

If Lowest and Highest come out the **same** value, that tells me Octopus is only publishing your
*current* rate forward on your account rather than the full day, and I've got a follow-up for that
— but I expect this to sort it.

Cheers,
Justin
