# Reply to Darren — v1.0.24 (Off-peak cost today = £0)

Context: after v1.0.23 (price-today tiles), Darren reported "Still a few issues" with a
screenshot (diagnostic 24b31ae8-…) showing **Off-peak cost today = £0**, and Lowest / Highest /
Average price today all identical at **28.86 p/kWh**.

---

Hi Darren,

Thanks — that screenshot pinned it exactly. Two things going on, one fixed and one that's a
limitation of what your tariff exposes.

**1. Off-peak cost today showing £0 — fixed in v1.0.24 (on Test now).**
The cost tiles (Off-peak/Peak cost today, Cost yesterday, and the monthly/billing figures) were
pricing your usage from Octopus's *public* price list. On Intelligent Octopus Go that public list
is empty — which is the same quirk behind the earlier issues — so every unit of usage was being
valued at £0. They now price your usage from the same live rates as the "current price" tile, so
the cost figures populate. Please update on Test and check Off-peak/Peak cost today fill in.

**2. Lowest = Highest = Average = 28.86p (and off-peak priced at the day rate).**
This is a data limitation rather than a bug. Your IOG account only publishes the **single standard
rate (~28.86p)** to the API — the cheap overnight window isn't exposed as a separate half-hourly
rate we can read. So the app can only see 28.86p across the day, which is why those three tiles
match and why your overnight usage is currently valued at the day rate rather than ~7p.

To help me confirm: in the **Octopus app / your online account**, is the overnight rate shown as a
distinct unit rate (e.g. ~7p between 23:30–05:30), or is the cheap charging applied as a **credit /
adjustment** after the fact? If it's a published rate I can look at reading it; if it's applied at
settlement, the half-hourly price genuinely won't show it and I'd surface it differently (e.g. via
the guaranteed 23:30–05:30 window).

Appreciate you sticking with the testing — it's making the IOG support properly solid.

Cheers,
Justin
