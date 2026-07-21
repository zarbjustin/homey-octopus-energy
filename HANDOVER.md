# Project Handover

Last updated: 21 July 2026

## Current state

- Repository: `zarbjustin/homey-octopus-energy` (public), default branch `main`.
- App ID: `uk.co.zarb.octopusenergy`.
- Current source version: `1.0.24`; release tag: `v1.0.24` (GitHub release published). Homey
  **Build (v1.0.24)** uploaded to the App Store on 21 July 2026 (publish run `29866957322`,
  green). This build fixes the IOG **cost tiles showing £0** (Off-peak/Peak cost today, Cost
  yesterday, monthly/billing): the cost-history paths (`refreshMonthlyCost`,
  `refreshBillingSummary`, `refreshDayBreakdown`) fetched tariff rates from the public REST feed,
  which is empty for IOG, so all historical consumption priced at £0. New `costRatesForWindow`
  falls back to the authoritative live series (`this.rates`, resolved before the reporting phase)
  for single-register import meters when the REST feed is empty; two-register (Economy 7) meters
  are never substituted. See commit `3525d40`/fix + `test/cost-history-iog.test.js`. Prior build
  v1.0.23 (`4fb83a3`) fixed the IOG Lowest/Highest/Average price-today tiles staying blank
  (`refreshPriceStats` samples `rateAt` across the local day). **Known IOG limitation:** Darren's
  HalfHourly feed publishes only the single standard rate (~28.86p) — the overnight cheap band is
  not exposed as a half-hourly rate — so Lowest=Highest=Average and off-peak usage prices at the
  day rate (non-zero, but not the ~7p overnight rate). **Manual step remaining:** promote the
  build to Test/Live at
  https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy, then ask Darren
  (community 156860) to confirm the cost tiles now populate.
- Recent ships this line: v1.0.20 (IOG tariff-union + census), v1.0.21 (IOG HalfHourly.unitRates
  first-class pricing — Darren confirmed working, log `c0da5fef`), v1.0.22 / Build 22 (Sprint 60
- Recent ships this line: v1.0.20 (IOG tariff-union + census), v1.0.21 (IOG HalfHourly.unitRates
  first-class pricing — Darren confirmed working, log `c0da5fef`), v1.0.22 / Build 22 (Sprint 60
  stability & privacy hardening), v1.0.23 (IOG price-today tiles fix). Phase 2 (S52 god-object
  decomposition, BL-07) in progress: slice 1 landed `lib/timezone.ts` + `lib/redact.ts` (commit
  `7604646`); slice 2 landed `lib/DeviceScheduler.ts` (the three refresh timers) + `lib/health.ts`
  (pure `refreshHealthDecision`), commit `30b7acc`; slice 3 landed `lib/pricing/iogSchedule.ts`
  (`iogUnitRatesToRates` + `synthesiseIogDayNightRates`) + `lib/pricing/priceGap.ts`
  (`isRecoverablePriceGapError`), commit `a647d39`; slice 4 landed `lib/consumption/cumulative.ts`
  (`computeCumulativeUpdate` — the single cumulative-meter writer), commit `216e527`; slice 5
  landed `lib/planning/window.ts` (`computeRatesHorizon`, `computeUpcomingExtremes`,
  `isWithinCheapestPercentile`), commit `7f1d5d4` — `OctopusMeterDevice` now 2255 LOC (from 2399),
  zero user-visible change, 424 tests green. Next decomposition slice per
  `docs/blueprint/16-implementation-plan.md` §2.1: extract a thin `ReportingService`, then make the
  device a lifecycle façade, then BL-08 generation/cancellation safety (the cumulative-writer
  arithmetic is now isolated in `computeCumulativeUpdate`, ready for that guard).
- `main` HEAD is `9990cb4`. The v1.0.23 ship is commits `4fb83a3` (fix) + `9990cb4`
  (release bump). All pushed directly to `main` (owner bypass of the
  PR rule); CI, Validate, CodeQL, Create GitHub Release, and Publish Homey App all green.
- Previous: Build 19 / version `1.0.19` uploaded 20 July 2026 (S50 + S51 part 1);
  it is superseded by Build 20.
- Homey App Store: Build 13 / version `1.0.13` remains live. Build 17 / version
  `1.0.17` is in Test and under certification review.
- Build 16 / version `1.0.16` was retracted from certification on 20 July 2026 and
  is now marked superseded by Build 17. Builds 14 and 15 were retracted earlier.
- Test channel: https://homey.app/a/uk.co.zarb.octopusenergy/test/
- Build status: https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/20
- Community support topic: https://community.homey.app/t/156860
- CI note: the `Publish Homey App` and `CI` workflows run `npm audit` as a hard gate.
  A high-severity `brace-expansion` advisory (GHSA-3jxr-9vmj-r5cp) blocked the first
  v1.0.20 push and was cleared with a lockfile-only `npm audit fix` (commit `d552420`).
  Keep the audit gate green before any release push.
- GitHub has no open pull requests and the remote contains only `main`. Any local
  remote-tracking references for earlier `release/*` or `agent/*` branches are
  stale, fully merged history and can be removed with `git fetch --prune`.

## Next-model entry point

- **Immediate:** promote Build 20 to Test, post the drafted reply
  (`docs/handover/darren-iog-reply-v1.0.20.md`) to community 156860, and wait for
  Darren's fresh log. The new `iogResolve` census (`typenameHistogram`,
  `rawAgreementCount`, `serverActiveCount`, `rawActiveCount`, `invalidDateCount`)
  will say exactly which tariff typename his account uses and whether it is a
  client, `active:true`, or genuinely-upstream issue — then close the
  field-verification gate and update the reply/handover accordingly.
- After the IOG gate closes, resume the planned arc. Read
  `docs/handover/future-sprints.md` and `docs/handover/sprints-50-58-spec.md` for
  the dependency order, acceptance gates, and a copyable prompt for another model.
- Sprint 41's contract record is `docs/research/kraken-contracts.md` (now updated:
  the electricity-agreement `TariffType` is a 7-member interface — see the IOG
  follow-up section). Implementation remains original, based on public Octopus
  contracts.
- Release process (verified this session): bump `version` in `package.json`,
  `package-lock.json` (root + `packages[""]`) and `.homeycompose/app.json`, add a
  `.homeychangelog.json` entry, run `npx homey app build` to regenerate `app.json`,
  commit, push to `main` (auto-creates the tag + GitHub release via
  `homey-app-release.yml`), then `gh workflow run homey-app-publish.yml --ref main`
  to upload the App Store build. Keep `npm audit` green.
- Work on one sprint/incident at a time using a short-lived branch. Do not combine
  an unrelated incident fix, release bump, or App Store action with a feature sprint.
- **Strategic blueprint (21 Jul 2026):** a multi-model (GPT-5.6 Sol + Opus 4.8 + GPT-5.5)
  product & engineering review lives in `docs/blueprint/` — start at
  `docs/blueprint/00-index.md`; `01-executive-summary.md`, `14-engineering-backlog.md`
  (BL-01…BL-30), and `15-prioritised-roadmap.md` drive the next 6–12 months. It ingests
  and cross-references (does not replace) `ROADMAP.md` and the S50–S58 spec.

## IOG price-gap root cause FOUND + fixed — RELEASED as v1.0.18 (PR #29)

The long-standing IOG import price gap (community 156860; logs `3b8df610` etc.)
was root-caused: for Intelligent Octopus Go there are **no half-hourly REST unit
rates**, so the only price source is the account's GraphQL agreement — but
`KrakenClient.getActiveIogTariff` matched that agreement with a **strict exact
match on the STORED tariff/product code**, and the stale stored code (the very
reason REST is empty) discarded the account's real active `DayNight`/`FourRateEv`
agreement, so no price was ever produced. The fix relaxes matching to prefer an
exact match, else fall back to the account's single unambiguous active IOG-family
household agreement (rejecting export/Economy-7/ambiguous cases; fails closed on
none), adopts the resolved code (with an anti-ping-pong guard so REST can't revert
it), throttles the forced recovery to once/6h, and — for the "timeout" perception —
stops logging expected `BudgetError` **soft skips** as errors (they retain the last
value) across the device refresh and all pollers, plus lengthens the IOG-tariff
cache (6h; exponential backoff on a persistent null) so a broken account stops
paying a `core` Kraken token every 30 min. Tri-model design (Opus 4.8 + GPT-5.5 +
GPT-5.6 Sol) + dual review; 354 tests pass, lint+build clean.

**Release status:** shipped as **v1.0.18** — PR #29 (fix) → PR #30 (release-safe
docs-currency test) → PR #31 ("Prepare release v1.0.18", tag `v1.0.18` + GitHub
release) → the "Publish Homey App" workflow published it to the Homey developer
account. **Remaining manual step:** promote the uploaded build to the **Test**
channel in the Homey Developer dashboard, then share the Test link with Darren.

**Still OPEN — the IOG field-verification gate.** The fix is a strong, reviewed
hypothesis but is NOT yet field-confirmed by the affected account. If it recurs, the
new identifier-free price-gap diagnostic (`iogResolve`: activeAgreementCount /
dayNightCount / fourRateCount / exactMatchFound / fallbackUsed, plus
`iogFallbackResolved`) will say whether the account even exposes an active agreement
in GraphQL — if it doesn't, the issue is upstream (no client synthesis is possible)
and we fail closed with the advisory. Do NOT declare the incident fixed until Darren
confirms on the Test build. The drafted community reply to Darren is in
`docs/handover/darren-iog-reply.md`.

## IOG follow-up — the v1.0.18 fix was INCOMPLETE (root cause now nailed)

A fresh community log (156860, log `7c389d7e`, 21 Jul 2026) from the same account
showed the v1.0.18 build STILL blank: `iogResolve.activeAgreementCount:0`,
`dayNightCount:0`, `fourRateCount:0`, repeated `Octopus returned no rate covering
the current time`. v1.0.18's note read this as "upstream / no client synthesis
possible". **That conclusion was wrong**, for two compounding reasons found this
session (tri-model: Opus 4.8 + GPT-5.6 Sol + GPT-5.5, verified against the live
public GraphQL + REST endpoints):

1. **The diagnostic was ambiguous.** `activeAgreementCount` was measured AFTER the
   household+date filters, so `0` conflated three different causes: no agreement at
   all, an agreement of a typename we don't handle, or a date-window/parse problem.
2. **`getActiveIogTariff` only handled 2 of the 7 `TariffType` interface members.**
   Introspection of `https://api.octopus.energy/v1/graphql/` confirms `TariffType`
   is an INTERFACE with possibleTypes `StandardTariff, DayNightTariff,
   ThreeRateTariff, FourRateEvTariff, HalfHourlyTariff, PrepayTariff,
   GasTariffType`. The query only requested `DayNightTariff` + `FourRateEvTariff`
   fragments, so an IOG agreement of any other type got `__typename` but **no rate
   fields**, was dropped by `isHousehold`, and counted as `activeAgreementCount:0`.
   IOG (`INTELLI-VAR-22-10-14`) is a **single-register** product (one
   `standard_unit_rate`), i.e. a GraphQL **`StandardTariff`** whose single
   `unitRate` we were discarding — hence "Day rate still blank".

**The fix (this session) — conservative, fail-closed:**
- Extended the query + `build()` to RESOLVE all five household import typenames,
  but only to obtain the **live tariff/product code for adoption**. A new
  `AccountIogTariff.scheduleTrusted` flag is `true` only for `DayNightTariff` /
  `FourRateEvTariff` (which expose an explicit two-band household schedule).
  `StandardTariff` / `ThreeRateTariff` / `HalfHourlyTariff` are `scheduleTrusted:
  false`: we never fabricate a day/night split from a single rate, three bands, or
  arbitrary half-hourly rows.
- `intelligentGoBaseRates` adopts the live code (fixing the stale stored code for
  ALL typenames) and then, when `!scheduleTrusted`, returns null — deferring to
  the **authoritative REST half-hourly rows**, which recover on the adopted live
  code (IOG REST returns the real two-band day/night rows once the code is
  current). Only trusted DayNight/FourRateEv are ever synthesised.
- **Decisive census** added to `IogResolveDiagnostic`, computed from a SECOND
  unfiltered `all: electricityAgreements` alias alongside `active: true`:
  `rawAgreementCount` (unfiltered) + `serverActiveCount` (active:true) +
  `typenameHistogram` (by `__typename`) + `rawActiveCount` + `invalidDateCount`,
  all identifier-free, plus per-type active counts. This distinguishes: no
  agreement (`rawAgreementCount:0`), an `active:true` quirk (`serverActiveCount:0`
  but `rawActiveCount>0`), an unhandled/foreign typename (`typenameHistogram`), and
  a date-parse problem (`invalidDateCount>0`).
- Hardening: shared `dateStatus()` (empty/unparseable `validTo` now fails closed as
  invalid, not open-ended); `unitRates` guarded with `Array.isArray`; `app.ts`
  replays the census on cache hits (adoption still calls `invalidateIogTariff`).
- New fixtures + 7 tests (Standard / HalfHourly / ThreeRate resolution +
  untrusted-defer-to-REST + census disambiguation); 365 tests pass, tsc + eslint +
  `homey app validate --level publish` all clean. Tri-model design + review
  (Opus 4.8 primary; GPT-5.6 Sol + GPT-5.5 cross-checked the diagnosis AND the
  implementation — their mispricing-safety objections drove the fail-closed rework).

**Still to do:** ship as a new patch release, then have Darren install the Test
build and send one fresh log. The `typenameHistogram` will now say exactly which
typename his account uses — and `rawAgreementCount`/`serverActiveCount` will say
whether it's a client, `active:true`, or genuinely-upstream issue. Only then update
`docs/handover/darren-iog-reply.md` and close the field-verification gate.

**Release status:** shipped as **v1.0.20** — commits `e9a37b2` (fix) + `04c1d68`
(release bump) + `d552420` (brace-expansion audit fix) pushed to `main` (tag
`v1.0.20` + GitHub release auto-created by the release workflow). CI, Validate,
CodeQL and the "Publish Homey App" workflow all passed; **Build 20 / version
1.0.20** uploaded to the Homey developer account on 21 July 2026.
**Remaining manual step:** promote Build 20 to the **Test** channel at
https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/20, then
share the Test link with Darren and ask for one fresh diagnostic log.

## IOG third pass — v1.0.20 was STILL incomplete; HalfHourly root cause nailed (S59 → v1.0.21)

Darren's v1.0.20 log (`78c9a84d`, 21 Jul 2026) was decisive:
`iogResolve.typenameHistogram: {StandardTariff:1, HalfHourlyTariff:1}`,
`rawAgreementCount:2`, `exactMatchFound:true`, `halfHourlyCount:1`, REST
`primaryCount:0`/`fallbackCount:0`. → His **import** agreement is a
**`HalfHourlyTariff`** (the `StandardTariff` is his **export** meter, correctly
filtered out of the household set). His stored code already matched exactly, so
v1.0.20's "adopt code, else defer to REST" deferred to a **permanently-empty REST
feed** → price never resolved → "Current tariff price is temporarily unavailable."

**Systemic root cause:** we kept treating GraphQL as a "code-adoption fallback" and
REST as the sole price source. For a HalfHourly IOG account the authoritative
half-hourly prices are **already in the agreement's own `unitRates`** (rows with
`validFrom`/`validTo`/`value`/`preVatValue` — like Agile REST rows). **v1.0.20
fetched those rows and threw them away.**

**The S59 fix (v1.0.21):**
- **Price-source unification:** a `HalfHourlyTariff` agreement's own `unitRates` are
  now a **first-class price source** — mapped directly to rate rows and priced via
  `rateAt(now)`. `AccountIogTariff` retains `unitRates` (only rows with a parseable
  `validFrom` + finite values; a missing start is dropped, never back-dated — fail
  closed). DayNight/FourRate synthesis unchanged; Standard/ThreeRate still
  adopt-code-then-defer.
- **Cache safety:** the IOG-tariff cache TTL is now bounded to the row horizon
  (5–30 min) for HalfHourly (dynamic series), not the 6h used for fixed rates.
- **Smart-charge clarity:** retitled the two confusable capabilities —
  `octopus_smart_charge` "Smart charge window" → **"Cheap-charge window (planned)"**
  (the app's price-based planner) and `octopus_dispatching` "Smart charging active"
  → **"Octopus smart-charging now"** (Octopus's live dispatch); the planner now shows
  **"—" (unknown)** instead of a misleading "No" when no current price is available
  (gated on `rateAt(this.rates)`), resolving Darren's "window: No vs active: Yes"
  contradiction.
- **Instrumentation:** census gains `halfHourlyRowCount` + `halfHourlyCoversNow` —
  one more log then proves the fix works vs "no rate exposed anywhere = genuinely
  upstream (escalate to Octopus)."
- Tri-model reviewed (Opus 4.8 orchestrator + GPT-5.6 Sol + GPT-5.5); two blocking
  issues they raised (null-`validFrom` fabrication; 6h cache staleness) fixed. 372
  tests pass (incl. HalfHourly pricing, null-`validFrom` drop, all-historical
  fall-through, stale-price smart-charge null); tsc + eslint + publish-validate clean.
- **Overlap:** S59 folds in the price-provenance slice of S53 (BL-15/R-017) and the
  smart-charge clarity slice of S57, and resolves blueprint risk R-008. The rest of
  the S50–S58 / blueprint roadmap is unchanged. Docs: `docs/research/kraken-contracts.md`
  IOG section updated; Darren reply drafted in
  `docs/handover/darren-iog-reply-v1.0.21.md`.

**Still OPEN — IOG field-verification gate.** Ship v1.0.21 → Test, then Darren's next
log confirms via `halfHourlyRowCount`/`halfHourlyCoversNow`. Do not close until confirmed.

> **RESOLVED 21 Jul 2026 — gate CLOSED.** Darren confirmed on v1.0.21 (log `c0da5fef`):
> stdout shows `Price-gap recovery: pricing from the account HalfHourly agreement rows
> (authoritative)` and his message "I think its working :)". The IOG "day rate blank"
> incident (community 156860) is fixed. **One follow-up question** from Darren: he expected
> **"Next price"** to be the IOG 23:30→05:30 cheap window — but `octopus_price_next` is the
> next **half-hour slot** (`rateAt(rates, now+30min)`), so it correctly shows the day rate
> during the day and flips to the ~7p rate in the half-hour before 23:30. Whether his
> half-hourly rows encode the overnight rate is visible in `octopus_price_min_today` vs
> `_max_today` (ask Darren). A dedicated "next cheap-window" indicator for IOG is a possible
> future UX enhancement (innovation catalogue). Reply drafted in
> `docs/handover/darren-iog-reply-confirmed.md`.

**Release status (v1.0.21):** commit `d1faa86` pushed to `main`; CI, Validate, CodeQL,
Create GitHub Release (tag `v1.0.21`) and the "Publish Homey App" workflow all passed;
**Build 21 / version 1.0.21** uploaded to the developer account on 21 July 2026.
**Remaining manual steps:** (1) promote Build 21 to the **Test** channel at
https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/21; (2) post the
reply in `docs/handover/darren-iog-reply-v1.0.21.md` to community 156860 and ask Darren for
one fresh log. Confirm via the new census fields, then close the gate.

## Sprint 60 — Stability & privacy hardening (v1.0.22 / Build 22)

Delivered while awaiting Darren's v1.0.21 field confirmation (independent, low-regression).
Prioritised from the blueprint (`docs/blueprint/`): BL-01/02/03 + BL-10 + BL-11. Shipped as
**v1.0.22 / Build 22** (commits `6643c8f`→`959fc9e`; publish run 29849679021):
- **BL-02 (051c):** `AccountPoller.start()` jitters the first poll (0–15s) — no app-boot budget stampede.
- **BL-01 (051d/h):** identifier-free per-priority budget counters + a 1-hour system budget test.
  (Core-debt floor kept at `-CAPACITY`; a true reserved-core RATE ceiling (051b) is deferred.)
- **BL-03 (051e):** `OctopusClient.get()` short-TTL (10s) coalescing — dedupe concurrent + brief reuse,
  structured-cloned, bounded; overlapping refresh-cycle reads cost one request.
- **BL-10:** salted-opaque persisted keys (`lib/diagnosticsKey.ts`) for saving-sessions state/diagnostics
  + integration diagnostics, with lazy migration (always prunes the raw key). Pseudonymisation, not
  export-proof (salt shares the settings domain — documented). Settings UI now uses neutral labels.
- **BL-11 (051g):** repair propagates a rotated API key to sibling meters on the **same** account,
  QUIETLY (`device.reloadCredentials` — store + rebuild clients, no refresh, no budget reset); an account
  NUMBER change is not auto-propagated. `resetBudget` removed from `invalidateAccountCaches` (the
  account rate limit is key-independent — a rotation must not wipe the bucket/429 gate).

Tri-model reviewed (Opus 4.8 + GPT-5.6 Sol + GPT-5.5); three blocking issues (repair budget reset/burst,
account-change stranding, migration not pruning) fixed at root cause; final verdict no-blocker. 382 tests
pass; tsc + eslint + `homey validate --level publish` + `npm audit` clean.
**App Store submission (in progress):** Build 22 (v1.0.22) is being promoted to Test then submitted for certification → Live via the Homey Developer dashboard (chosen 21 Jul 2026: straight to certification/Live). Supersedes Build 21.
**Deferred (tracked):** true reserved-core rate ceiling (051b); the cache-generation guard for stale
in-flight writes (blueprint BL-08/R-004); a full app-level Kraken budget integration sim.

## Post-v1.0.18 roadmap (Sprints 50–58) + S50 delivered

A tri-model (Opus 4.8 + GPT-5.5 + GPT-5.6 Sol) read-only evaluation of the whole app
plus fresh Octopus research produced a 9-sprint roadmap (S50–S58) — now recorded in
`ROADMAP.md` ("Sprints 50–58"), with the **full task-level spec (requirements, per-sprint
tasks, concerns, risks, dependencies, files, tests) in `docs/handover/sprints-50-58-spec.md`**
and the raw per-bug evidence + "do NOT do" list in the session `plan.md §15`.

**Sprint 50 — Stability bug-bash: DELIVERED (unreleased), branch `fix/s50-stability-bugbash`.**
Three verified P0/P1 stability bugs fixed, all ID/manifest/version-neutral:
- **A. Octoplus cache freeze** — `KrakenClient.getOctoplusSessions` memoised the fetch
  promise per-account with NO TTL on a long-lived client, so the 15-min Saving Sessions /
  Free Electricity poller returned the first cycle's data forever (and could cache a rejected
  promise). Now a 10-min TTL + clear-on-reject; the two Octoplus getters still share one
  fetch per cycle.
- **B. Settings dispatch status blank** — settings read the nonexistent per-account
  `dispatch_diagnostics_v1`; the poller writes the `v2` aggregate `{accounts, activeAccounts,
  plannedWindows, errors, lastAttempt}`. Settings now render that aggregate (safe DOM APIs).
- **C. Two dispatch truth models could disagree** — the `octopus_dispatching` capability used
  the legacy account-scoped `getCachedPlannedDispatches` (extra F0 budget; could stay `true`
  after a failed poll) while the `dispatch_active` condition used the reconciled `DispatchPoller`.
  The capability now reads the reconciled, clock-accurate `app.getDispatchView(account).activeNow`.
  Review-driven follow-up: `DispatchPoller.isActive()` and the v2 `activeAccounts` count now also
  recompute active-now against the clock (via `getAccountView`) so capability + condition + settings
  always agree; the now-orphaned per-device `dispatches` integration diagnostic is pruned on flush.

Cache-TTL audit: all `app.ts` caches already carry `ts`+TTL+inflight guards; octoplus was the
only gap. Dual-model review (GPT-5.5 + GPT-5.6 Sol) confirmed A/B/C correct; both P2 findings
fixed. 358 tests pass; lint + build + Homey publish-validate green.

**Deferred to S51** (same credential/budget area): account-wide repair credential propagation;
F0 core-cap / token single-flight + startup jitter; the CI Node-runtime SHA re-pin (its own
maintenance PR). **IOG v1.0.18 field-confirmation remains the external gate** (awaiting Darren).

## Active investigation — import current-price gap (`1.0.17` Test candidate)

- A user (Darren) on community topic 156860 reported an import electricity meter
  still showing a connection problem and blank price on `1.0.13`, while the Mini
  live readings and other integrations worked. Replacing the device reproduced the
  price failure immediately (deterministic — points away from stale device state).
- The fresh `1.0.15` diagnostic identifies an `IOG` import product for which
  both public REST rate requests return zero rows. Rediscovery and the product
  variant lookup return no alternative. The Test build's advisory/availability
  and points-backoff behavior worked as designed.
- What `1.0.15` changed for this incident:
  - A price-only gap no longer raises the generic connection alarm; it shows a
    non-blocking advisory and the device stays available (`refreshHealthDecision`,
    `setHealth`). This directly answers "shows a connection error in the status".
  - Guarded product-derived tariff-variant recovery: if rediscovery returns the
    same tariff code, it tries the code the product advertises for the meter's
    region/register count, reverting on failure (targets a variant mismatch).
  - Privacy-safe `price-gap diagnostic (no identifiers)` log line records row
    counts, open-ended counts, and day-only validity bounds so the next report
    distinguishes variant-mismatch vs closed-agreement vs upstream gap.
  - Octoplus points `Unauthorized.` no longer logs every cycle: it is treated as
    an unsupported field (null) with a 24 h backoff.
- The sanitised evidence, ranked hypotheses, and the decision tree for reading a
  fresh diagnostic are in `docs/reviews/import-price-gap-handover.md`.
- Sprint 41 adds a narrowly guarded production recovery: a matching current
  GraphQL `DayNightTariff` or `FourRateEvTariff` can supply IOG's household base
  day/night rates. It requires exact tariff and product identity and fails closed
  for mismatches, malformed rates, unsupported unions or GraphQL failure. Dispatches
  are not overlaid because the legacy account response does not prove device,
  SMART/BOOST type or settlement price.
- This candidate is included in Homey Build 17 and is not confirmed on Darren's
  account. Build 17 is under certification review, but do not claim the incident
  fixed until the affected account verifies it.
- A model-neutral review prompt is in
  `docs/reviews/import-price-gap-analysis-prompt.md` for independent analysis.
- Community post 14 promises a Test-build follow-up. Build 17 is now available at
  https://homey.app/a/uk.co.zarb.octopusenergy/test/ but the follow-up reply has
  been drafted but is not confirmed as posted. The approved draft tells Darren
  that the Test build adds guarded legacy/four-rate IOG recovery, asks him to keep the
  existing device, and requests confirmation or a fresh diagnostic while blank.
  Do not report the post as published unless the user confirms it or the forum
  visibly shows it.

### Draft reply to Darren

```text
Hi Darren,

Thank you again for the diagnostics and for helping test this.

I've now published version 1.0.17 to the Homey Test channel. It adds guarded
support for the newer Intelligent Octopus Go four-rate tariff contract identified
during the investigation, while keeping household and EV-specific rates separate.

You can install it here:
https://homey.app/a/uk.co.zarb.octopusenergy/test/

Please keep your existing Electricity Meter device rather than deleting and
pairing it again. Once updated, could you let me know whether the current household
price now appears?

If it remains blank, please submit another diagnostic while the price is missing
and include the approximate time. That will show whether your account exposes the
expected tariff contract or another variant we still need to handle.

Thanks again for your patience and detailed feedback. It has been extremely useful
in narrowing this down.
```

## Sprint 40 security reconciliation

- PR #3 selectively reconciled the useful parts of the superseded security PR.
- API and pairing requests now enforce HTTPS and trusted origins, follow redirects
  manually, redact upstream error bodies, and honour bounded `Retry-After` delays.
- Pagination validates each next URL, rejects repeated URLs, and has a 50-page cap.
- Pairing state is isolated per Homey pair session.
- The existing serial-aware transactional repair lifecycle remains intact.

## Sprint 41 Kraken contracts and IOG recovery

- Merged research PR: #10; merged production-completion PR: #11.
- Contract dossier: `docs/research/kraken-contracts.md`.
- Synthetic fixtures: `test/fixtures/kraken/`; a test rejects credential-shaped
  content and any fixture identifier not visibly prefixed `synthetic-`.
- Public schema research covers Home Mini telemetry, electricity tariff unions,
  smart devices, account/device dispatches and relative-price ownership.
- REST remains authoritative for meter identity, consumption, rate history and
  billing. GraphQL is operational/enrichment data except for the exact-match,
  fail-closed IOG household-base recovery.
- David Piper's GPL-3.0 repository was reviewed as prior art at commit `1042af3`.
  No code, query text, fixture, name or algorithm was copied/adapted. Private
  correspondence is not reproduced in this public repository.
- Sprint 43 owns device-aware SMART/BOOST and settlement semantics; Sprint 44 owns
  effective-price Flows. Sprint 41 intentionally does not infer discounts from
  ambiguous account-level dispatch windows.

## Sprint 49 Trust & Polish (DELIVERED, unreleased)

On branch `feat/sprint-49-trust-polish` (PR pending). A consistency/docs/confidence
pass over the Sprint 42-47 arc — **no new data features, no new capabilities, no
Flow-ID changes, no version bump (stays 1.0.17)**.

- **F1 provenance everywhere:** all six widgets now render one shared, namespaced
  provenance badge (`.prov-badge` + `b-current/stale/unknown/estimated` — namespaced
  to avoid colliding with the price/carbon *level* `.badge`). `freshnessHtml(d,
  sourceLabel)` shows "Device refresh · Current/Stale/Unknown · age"; a connection
  problem is never shown as Current. App-derived recommendations (cheapest/peak slots)
  and the carbon forecast carry an explicit **Estimated** badge; published forward
  tariff rows (timeline/agile price rows) are NOT mislabelled as estimates.
- **F1 vocabulary (important):** `Reading<T>.state` has exactly three values —
  `current | stale | unknown`. `estimated | planned | finalised` are *presentation*
  provenance labels, NOT `Reading.state` values; docs and code must not conflate them.
- **Settings consistency + safety:** added the missing "Intelligent dispatch status"
  heading; relabelled the S44 toggle to "Show estimated IOG household rate in the
  Summary widget"; rebuilt the billing-summary list with `textContent`/DOM nodes
  instead of `innerHTML` (defense-in-depth against injected account/period/confidence
  strings). No settings keys added or changed.
- **Machine-checked consistency:** `test/ui-consistency.test.js` (node:vm evaluates the
  real `freshnessHtml`/`esc` per widget: current/stale/problem/unknown mapping +
  escaping of malicious input; asserts the namespaced badge and the estimate-vs-
  published distinction; asserts settings has no dynamic `li.innerHTML`) and
  `test/docs-currency.test.js` (README is 1.0.17, lists the six S47 card IDs, and the
  IOG gate stays "not field-confirmed").
- **Docs:** README refreshed to 1.0.17 with the S44 toggle + S47 advanced cards;
  ROADMAP row 7 marked delivered; this section added.

### Community feedback loop (Intelligent Octopus Go price-gap incident)
- Topic: community.homey.app t/156860. The reply to the reporter was drafted but must
  not claim the incident fixed until an affected account confirms on Build 17.
- When collecting a report: record build/version, date, tariff/register type, and
  whether the household price appeared; request only the privacy-safe diagnostic while
  the failure is visible; never request re-pairing or raw identifiers; do not treat
  "no new report" as confirmation.

### GitHub Actions Node-runtime maintenance (tracked, not done here)
- All workflow actions remain pinned to full 40-char SHAs (guarded by
  `test/release-security.test.js`). GitHub warns that `actions/checkout@v4` /
  `actions/setup-node@v4` run on the deprecated Node 20 action runtime.
- **Do this in a SEPARATE, SHA-pinned maintenance PR** (not a docs/UI sprint):
  re-pin checkout/setup-node to their newer 40-char SHAs (keep the `# v5` comment
  format), then re-run `release-security`, the full suite, and `homey app validate`.
  Never unpin to a floating tag. Not changed in Sprint 49 to keep the supply-chain
  change independently reviewable.

## Sprint 47 planner and tariff analytics (DELIVERED, unreleased)

On branch `feat/sprint-47-planner-analytics` (PR pending). Two new PURE, fully
unit-tested modules: `lib/planner/tie.ts` (TieStrategy earliest/latest/random with
a seeded deterministic RNG — FNV-1a + mulberry32; tie-aware contiguous
`selectCheapestWindow`/`selectExpensiveWindow` and non-contiguous `selectExtremeSlots`;
`planEnergy` returning a complete plan or null, never partial; `energyWeightedAverage`)
and `lib/analytics/priceAnalytics.ts` (`coveringRows` exact-tiling check;
`analysePriceWindow` duration-weighted average + median/quartiles + negative/spike
counts + relative off-peak share; `classifyBand` negative→spike→low→high→typical by
duration-weighted midrank; `spikeThreshold` = Q3 + max(1.5·IQR, 5p);
`estimatePlanSavings` vs a uniform-window baseline with pct null when baseline≤0;
`lowPriceEnergyShare`). Negatives are never clamped anywhere. Thin device adapters
(`findExtremeSlotAdvanced`, `planAdvanced`, `analysePriceDay`, `currentPriceBand`,
privacy-safe `plannerSeed` that hashes — never embeds — the device id). SIX new
additive, opt-in Flow cards (electricity `find_cheapest_slot_advanced`,
`plan_charge_advanced`, `analyse_price_day`, `relative_price_band_is`; export
`find_peak_export_slot_advanced`, `plan_export_advanced`); every existing card/ID/token
byte-unchanged; every output an explicitly-labelled estimate; nothing written to a
capability. Relative metrics declare window/population/boundary/tie-rule and fail closed
on an incomplete day (per docs/research/kraken-contracts.md). Driver compose ↔ app.json
kept byte-consistent and guarded by the new `test/driver-manifest-parity.test.js`. NO new
capabilities, NO version bump. Tri-model design (Opus 4.8 + GPT-5.5 + GPT-5.6 Sol) + dual
review; 305 tests pass, lint+build clean. Deferred (documented): a plan-token round-trip
condition and Economy-7 schedule materialisation. Next per the spec is Sprint 49 (Trust &
Polish).

## Sprint 44 dispatch and effective-price Flows (DELIVERED, unreleased)

On branch `feat/sprint-44-effective-price` (PR pending). New pure
`lib/effectiveRate.ts` (`computeEffectiveRate`) exposes an OPT-IN, confidence-tagged
ESTIMATED effective rate for Intelligent Octopus Go. Core honesty rule: for a
whole-home import meter the estimated effective rate EQUALS the authoritative
household base in every case — guaranteed 23:30-05:30 window = whole-home off-peak
(high), bonus SMART = EV-only benefit so household stays at base (medium), BOOST =
no assumed discount (low), unknown tariff/base = `null`. It is never below base,
never an EV rate, always `estimated:true`/`settlement:false`. EV peak/off-peak and
the midday-to-midday allowance window are surfaced SEPARATELY (never folded in). The
finalised previous half-hour rate is REST-authoritative only — `rateSource` tracking
in `OctopusMeterDevice` blocks the IOG GraphQL base-schedule fallback from ever being
presented as "finalised". Surfaced via the summary widget's `effectivePrice` hook
(`getEffectiveRateView`, no manifest change) with Estimated/confidence/REST badges,
all `esc()`-routed. Two new truthful app-level Flow triggers — `dispatch_cancelled`
and `dispatch_changed` (reschedule) — fire only on a successful non-stale poll
(`wasSeeded` + `lastNextKey` gating); `dispatch_started` gains a `type` token and
`dispatch_completed` a `delta` token; all existing dispatch Flow IDs preserved.
Shared, budgeted `app.getCachedIogTariff` (30-min TTL + inflight dedup, invalidated
in `invalidateAccountCaches`) dedupes the price-recovery and effective-rate reads —
no new polling cadence. `.homeycompose/flow/**` <-> `app.json` kept byte-consistent
and guarded by `test/manifest-parity.test.js`. NO new capabilities, NO version bump.
Tri-model design (Opus 4.8 + GPT-5.5 + GPT-5.6 Sol) + dual review; 225 tests pass,
lint+build clean. The `price_finalised` trigger and a standalone effective-rate Flow
condition were deliberately DEFERRED to Sprint 47 (a "finalised" trigger risks reading
as settlement). Next per the spec is Sprint 47 (planner + tariff analytics).

## Sprint 46 live-energy presentation and widgets (DELIVERED, unreleased)

On branch `feat/sprint-46-live-energy` (PR pending). Plumbing:
`DispatchPoller.getAccountView` (deviceId-free, clock-accurate snapshot + recent
finalised), `app.getDispatchView`, `OctopusMeterDevice.getLiveDemandView` (import/
export derived from the single signed Home Mini net reading; null-not-zero when
unavailable) and `getDispatchView`. The summary widget shows a live-power block,
planned-vs-finalised dispatch (finalised = "not a billed rate or settlement"), and
F1 provenance badges — all routed through `esc()`. `measure_power`/Homey Energy
unchanged; EV/household effective pricing deferred to Sprint 44 (inert `effectivePrice`
hook). Tri-model design + dual review (consensus P1: a stale window is never shown as
active). 189 tests pass; no new capabilities/IDs; no version bump. The per-widget badge
rollout (price/agile/carbon/export/timeline) continues on this plumbing. Next per the
spec is Sprint 44 (dispatch/effective-price Flows, scoped down).

## Sprint 45 billing-period summary (DELIVERED, unreleased)

On branch `feat/sprint-45-billing-summary` (PR pending). New pure `lib/billing/`
engine (tz, period, aggregate, project) computing "this billing period so far":
import cost + standing + export value + net, with a run-rate projection and
confidence bands always labelled estimated (F1). Period from a user `billing_day`
app setting (else calendar-month fallback, low confidence), DST-safe.
`OctopusMeterDevice.refreshBillingSummary` (import electricity, incl. export meter
lookup) persists a masked, identifier-safe `billing_summary_v1`; a settings-page
section shows it. No new capabilities/Flow IDs; no version bump; REST-authoritative,
restart-safe. Tri-model design (Opus 4.8 + GPT-5.5 + GPT-5.6 Sol) + review; 182 tests
pass. Next per the spec is Sprint 46 (live-energy presentation & widgets).

## Sprint 43 device-aware dispatch truth model (RELEASED TO TEST)

Merged through PR #21 and included in `v1.0.17` / Homey Build 17. New pure `lib/dispatch/`
core (types, deviceModel, reconcile state machine), device-scoped
`getDevices`/`getFlexPlannedDispatches` + `getCompletedDispatchWindows` (all via the
F0 budget), and a rewritten `DispatchPoller` that drives the existing
`dispatch_started/ended/completed/active` Flow cards from honest reconciled state.
A vanished planned window is cancelled only on a successful poll; a failed poll
retains prior state (never fabricates a cancellation/ended edge). Completed dedup
uses a high-water mark. Aggregate identifier-free `dispatch_diagnostics_v2`. No
price/effective-rate logic (Sprint 44). Dual-model design (Opus 4.8 + GPT-5.5) +
GPT-5.5 review; 167 tests pass; lint + build clean; no version bump. Next per the
spec is Sprint 45 (billing-period summary).

## Sprint 42 shared Kraken budget and live-data poller (RELEASED TO TEST)

Merged through PR #20 and included in `v1.0.17` / Homey Build 17. Implements Foundation
F0 — one account-scoped Kraken request budget (`lib/KrakenBudget.ts`) enforced inside
`KrakenClient.post()`, with core/live/best-effort priorities and a 429 backoff gate —
plus a shared, subscription-based live-demand source (`lib/LiveDemandSource.ts`) with
an internal freshness struct (`lib/freshness.ts`, F1). Electricity live power now uses
the shared source instead of a 30s-per-device timer, fixing a latent throttling bug.
New app setting `live_demand_cadence_s` (60/120/300s, default 120). No version bump;
145 tests passed at sprint merge; the combined release passes 167. Designed and
reviewed with Claude Opus 4.8 + GPT-5.5. Spec:
`docs/handover/sprints-42-48-spec.md`. Field-verify the shared polling and request
budget behavior in Build 17 before treating it as proven in production.

## What v1.0.15 contains

Fixes and diagnostics for the import current-price gap and Octoplus points
(community topic 156860, posts #11–#12). Delivered via PR #5 and released in PR #6.

- Import price-only degradation is now surfaced as a non-blocking advisory
  (`setWarning`) instead of the generic connection alarm; the device stays
  available. `alarm_generic` is reserved for genuine connectivity/auth failures
  (`refreshHealthDecision`, `setHealth`). This is intentional: it does NOT revert
  to the pre-1.0.10 behaviour of showing a stale price as current.
- Guarded product-derived tariff-variant recovery (`tryProductVariantRecovery`):
  after same-code rediscovery, tries the tariff code the product advertises for
  the meter's region and register count, retries the price refresh once, and
  reverts the stored tariff code if the retry still fails (never persists an
  unverified guess).
- Privacy-safe price-gap diagnostic (`logPriceGapDiagnostic`): logs fuel, role,
  register, product family, dynamic flag, primary/fallback row counts, open-ended
  counts, and day-only validity bounds — no credentials, identifiers, tariff
  codes, or raw bodies.
- Octoplus points `Unauthorized.`/enrolment errors are treated as an unsupported
  field (`getOctoplusPoints` returns null via `isUnsupportedFieldError`) with a
  24 h backoff and a single log line; genuinely transient errors are re-thrown and
  capped to hourly retries.
- Fixes the `Update Homey App Version` workflow to sync `package.json` (and its
  lockfile) to the bumped version, so automated release PRs no longer fail the
  manifest-version test.
- Root cause of the missing current rate for the affected tariff is still open —
  see the Active investigation section and the incident handover doc.



- Adds the missing custom Repair views for electricity, gas, and export meters.
- Makes Repair wait for in-flight work, apply credentials transactionally with
  rollback, clear account-scoped caches, and discard a cached Home Mini device id.
- Validates manual meter identities and verifies account credentials before a
  manually entered meter can be paired.
- Shares Kraken clients and dispatch requests per account, deduplicates concurrent
  requests, and bounds app-level caches.
- Adds privacy-safe per-integration diagnostics and device freshness state without
  exposing API keys, full account numbers, meter numbers, or serials.
- Stops plunge-price triggers and notifications repeating for every consecutive
  negative-price slot.
- Requires both price and carbon data for the Flow condition that promises both
  thresholds.
- Prices partial final EV charge slots using only the requested energy.
- Discovers real regional tariff codes from Octopus product metadata when
  comparing tariffs, including Economy 7 and gas tariff tables.
- Prevents stale widget settings from silently displaying another meter and
  escapes user/upstream text rendered by widgets. Widgets now expose stale or
  unhealthy data, accessible live regions and controls, and resilient long names.
- Updates user-facing Free Electricity wording to Octopus Power Up while keeping
  the existing Flow IDs for compatibility.

## What v1.0.13 contains

- Keeps an otherwise reachable meter available when only its current price is
  temporarily missing; authentication still fails immediately and transient
  total outages require three consecutive refresh failures.
- Falls back to one bounded page of recent rates when a narrow date window omits
  a long-lived fixed or non-dynamic tariff rate.
- Rediscovers the active tariff and retries a failed price refresh once.
- Updates Octoplus points to the current `loyaltyPointsBalance` GraphQL contract.
- Moves Saving Sessions and Power Up events to Octopus's current authenticated
  backend schema and separates `TURN_DOWN` from `TURN_UP` events.
- Records redacted Saving Sessions poll diagnostics in the Homey app settings.

## What v1.0.12 contains

- Links the App Store listing to the public Homey Community support topic.
- Adds searchable tags for tariffs, meters, prices, gas, solar, and export.
- Removes App Store links to the private development repository.

## What v1.0.11 contains

- Adds Homey's native optional PayPal donation metadata for PayPal.me user
  `zarbie`.
- Homey only displays the Donate button for non-verified developers.

## What v1.0.10 contains

Sprints 33-39 completed the bug-bash hardening phase:

- Current Agile/export slots remain eligible in cheapest/peak "now" decisions.
- Contiguous plans reject missing half-hours and incomplete charge plans.
- Refresh locking is generation-safe; Carbon API calls have timeouts and retries.
- Empty current-rate responses make the device unhealthy instead of preserving a
  stale price as healthy.
- Saving Sessions and dispatch polling are isolated per Octopus account.
- Device repair refuses to silently bind to a different meter identity.
- GitHub Actions are pinned to immutable commits with explicit permissions.
- Authenticated Octopus pagination cannot leave the configured API origin.
- Balance requests are deduplicated and expensive reporting calls are cached.
- Standing charges use historical daily rates; deadlines are DST-aware.
- Device, poller, Flow-contract, repair, and release-policy tests were added.

## Architecture map

- `app.ts`: app-level Flow registration, bounded account clients/caches, pollers.
- `lib/OctopusClient.ts`: authenticated Octopus REST client and pagination.
- `lib/KrakenClient.ts`: Octopus GraphQL/Kraken account and smart-device calls.
- `lib/OctopusMeterDevice.ts`: shared refresh, pricing, consumption, reporting,
  planning, health, and scheduling behavior.
- `lib/OctopusMeterDriver.ts`: discovery, pairing, and identity-safe repair.
- `lib/AccountPoller.ts`, `DispatchPoller.ts`, `SavingSessionsPoller.ts`:
  account-scoped background event polling.
- `drivers/`: electricity, gas, and export specializations and Flow listeners.
- `widgets/`: Agile, price, carbon, export, summary, and timeline widgets.
- `.homeycompose/`: source manifests for capabilities, flows, drivers, and app data.
- `test/`: pure logic plus device, poller, repair, Flow, and release regressions.

## Invariants and decisions

- Node.js 22 or newer is required.
- `package.json`, `package-lock.json`, `.homeycompose/app.json`, and generated
  `app.json` must carry the same release version.
- Homey's publisher updates its own manifests and changelog but does not update
  npm package metadata. The `Update Homey App Version` workflow now includes a
  "Sync package.json version" step that reconciles `package.json` and
  `package-lock.json` automatically; a manual `npx homey app publish` still
  requires you to sync npm metadata yourself, rerun tests, commit, and push.
- API keys and account numbers belong only in Homey's device store. Never place
  real credentials in logs, screenshots, fixtures, issues, or documentation.
- Repair must preserve MPAN/MPRN and serial identity. A replacement meter should
  be added as a new device rather than silently changing an existing device.
- App-level clients, Saving Session state, and dispatch state must remain keyed by
  account; cached credentials must be invalidated when an API key changes.
- Price-window helpers must include an active slot where appropriate and verify
  actual half-hour adjacency before calling a block contiguous.
- Import and export devices expose only the cumulative direction they measure.
  Do not add fake zero-value capabilities to silence validation warnings.

## Expected warnings

Homey publish validation reports exactly two accepted warnings:

- Electricity is cumulative import-only and lacks an exported capability.
- Export is cumulative export-only and lacks an imported capability.

These are intentional and documented in the README. Any additional warning or
validation error should be investigated.

## Release runbook

1. Confirm a clean worktree and aligned versions.
2. Run `npm run lint`, `npm test`, and `npm audit`.
3. Run `npx homey app validate --level publish`.
4. Install on the local hub with `npx homey app install` and smoke-test devices,
   widgets, and representative Flows.
5. Commit and push the implementation.
6. Run `npx homey app publish`, choose the intended version, enter the changelog,
   and allow the Homey CLI to commit/tag/push its version bump.
7. Synchronize npm package metadata to the new version and push that follow-up.
8. In Homey Developer Tools, publish the build to Test and submit it for
   certification. Keep automatic publication enabled when desired.

## Release automation

- `Update Homey App Version` (`homey-app-version.yml`, manual `workflow_dispatch`)
  bumps the manifests + changelog, syncs `package.json`, validates, and opens a
  `release/vX.Y.Z` PR.
- `Create GitHub Release` (`homey-app-release.yml`) triggers on push to `main`,
  reads the version, and creates the annotated tag + GitHub release when missing.
- `Publish Homey App` (`homey-app-publish.yml`, manual `workflow_dispatch`)
  publishes the build to the Homey App Store (requires the `HOMEY_PAT` secret,
  which is configured).
- GitHub currently warns that the pinned checkout/setup-node actions target the
  deprecated Node 20 action runtime and are being forced onto Node 24. The
  warning did not affect Build 17, but the pinned actions should be reviewed in
  a separate maintenance change when upstream releases compatible revisions.
- CAVEAT observed on 19 July 2026: merging a release PR via the `gh` CLI did NOT
  emit the `push` event that triggers `Create GitHub Release` (merging via the
  GitHub web UI does). If a release PR is merged from the CLI, create the tag and
  release manually: `git tag -a vX.Y.Z -m "Release vX.Y.Z" <sha> && git push
  origin refs/tags/vX.Y.Z` then `gh release create vX.Y.Z --verify-tag --title
  vX.Y.Z --generate-notes`. `v1.0.15` was created this way; the automated release
  workflow successfully created `v1.0.16` after PR #14 merged.

## Next actions

1. Ask Darren to install Build 17 / `1.0.17` from the Test link without replacing
   the existing device.
2. Ask for one fresh diagnostic while the price is blank, or confirmation that the
   current household price now appears, plus the exact tariff/register type.
3. Read the `price-gap diagnostic (no identifiers)` and IOG recovery output while
   Build 17 proceeds through certification; do not claim the incident fixed before
   affected-account confirmation.
4. If the price remains blank, inspect the newly observed sanitised contract shape
   and extend fixtures before changing matching or fallback safeguards.
5. After production approval, announce `1.0.17` in the community support topic.
6. Continue monitoring the advisory/health behaviour and community feedback.
7. Smoke-test Repair for one electricity meter plus gas/export where available;
   confirm invalid credentials leave the existing device unchanged.

## Useful release commits

- `98ad3fc` - bug-bash hardening implementation.
- `6ac139f` - Homey version bump and tag for `v1.0.10`.
- `0c87ef9` - npm metadata synchronized to `1.0.10`.
- `a13f413` - meter recovery and current Octoplus integrations for `v1.0.13`.
- `43b4af3` - Sprint 40 API and pairing hardening.
- `f2d08f9` - import price-gap fixes, points backoff, diagnostics, guarded
  variant recovery, and price-only advisory health state (PR #5).
- `16e5143` - `v1.0.15` release: version bump, changelog, version-workflow fix (PR #6).
- `1075391` - `v1.0.16` release and Homey Build 16 source (PR #14).
- `69e2fdc` - Build 16 Test deployment and field-verification handover (PR #15).
- `d7b1bac` - `v1.0.17` release and Homey Build 17 source (PR #22), including
  Sprints 42-43 and the Free Electricity (Power Up) Flow wording.
