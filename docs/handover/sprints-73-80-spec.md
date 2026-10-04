# Sprints S73–S80: Reliability First, Then Product Growth

Last updated: 4 October 2026

## Scope and Baseline

This specification records the original planning contract following the community
and diagnostic review. That planning turn changed no runtime code or release.
Execution is now authorised: S73–S75 are implemented and tested, with S76 delivery
in progress. Current evidence and remaining gates are in the
[`execution record`](sprints-73-76-execution.md); the baseline below is historical.

- Repository baseline: `main`, `2da305a`, v1.0.36; fetched remote agrees.
- Original backlog `BL-01`–`BL-31` is historical delivered scope; do not reopen it
  wholesale or treat its old field-verification notes as current instructions.
- Last recorded release test baseline: 577 passing. This planning turn did not
  rerun the full suite or validate a new app build.
- Homey Build 36 was observed Live on 4 October 2026.
- The dashboard showed zero automatic crashes across 36 builds. Twelve manual
  diagnostics were reviewed. Functional failures can exist without an app crash.
- S73–S76 are the recommended next execution phase; S77–S80 are gated proposals.

## Evidence and Confidence

| Observation | Evidence | Interpretation |
|---|---|---|
| Announcement Flow repeats every 15 minutes | [Community post 32](https://community.homey.app/t/156860/32), matching [Build 36 diagnostic](https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/36/crashes) | Unanswered user report on the current release |
| Only 50 known IDs are retained and expired rows are announced before lifecycle checks | `lib/SavingSessionsPoller.ts` | Confirmed code defect: isolated replay with 51 expired sessions produces 51 initial announcements, then one on each subsequent poll and after restart |
| Reporter-specific event history is absent from the manual log | Build 36 diagnostic | The reproduced defect is a strong candidate, not proof of the exact account's cause |
| Widget refresh participates in minute-spaced price/usage failures | Build 36 stack includes `getFreshAgileDayData`; `widgets/agile/public/index.html` loads every 60 seconds | Current widget path can amplify recovery work during an outage |
| Cache-only widget contract has exceptions | Agile API awaits `getFreshAgileDayData`; Summary awaits `getSettledDailyUsage` and `getEffectiveRateView` | Audit all widget getters, not only the obvious Agile retry path |
| Device/dispatch lookup can fail | Build 36 plus [Build 24 diagnostics](https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/24/crashes) | Classify unsupported, unknown and transient cases; do not assume all failures mean an ineligible account |
| Day-price recovery was confirmed; later overnight complaints followed | [Build 21](https://tools.developer.homey.app/apps/app/uk.co.zarb.octopusenergy/build/21/crashes), Build 24, later v1.0.26–27 fixes in `HANDOVER.md` | Preserve fixes and verify current overnight behaviour rather than reopening every old report |
| Widget colour enhancement was welcomed | [Community post 31](https://community.homey.app/t/156860/31) | Enhance existing widgets; a new price widget is not justified by this feedback |
| Meter selection had a separate complaint | [Community post 27](https://community.homey.app/t/156860/27) | Positive colour feedback does not prove meter selection is fixed |

Only sanitised descriptions and synthetic fixtures belong in this public repo.
Portal links require the developer's access. Do not copy raw logs or customer
identifiers into a fixture, GitHub issue, screenshot or release note.

## New Backlog

| ID | Sprint | Item | Priority | Status |
|---|---|---|---|---|
| BL-32 | S73 | Restart-safe, history-safe Saving Session and Power Up lifecycle | P1 | Planned |
| BL-33 | S74 | Cache-only widget acquisition and bounded background recovery | P1 | Planned |
| BL-34 | S75 | Evidence-based dispatch eligibility and degraded-state handling | P2 | Planned |
| BL-35 | S76 | Integrated verification, safe release and support closure | P1 | Planned |
| BL-36 | S77 | Maintenance and release-runbook hygiene | P2 | Proposed |
| BL-37 | S78 | Cached health, trust and onboarding presentation | P2 | Proposed |
| BL-38 | S79 | Paired import/export recommendation feasibility and implementation | P2 | Proposed |
| BL-39 | S80 | Run-now-or-wait advice from existing planners | P3 | Proposed |

Priorities: P0 security/data-loss/blocker; P1 high user or reliability impact;
P2 important quality/product work; P3 enhancement. No current finding establishes
a P0 crash or security incident.

## S73 — Event Lifecycle and Announcement Deduplication

**Goal:** announce a genuinely new eligible upcoming event once, without replaying
history or allowing retention limits to recreate events.

### Tasks

1. Turn the isolated 51-event reproduction into a failing automated regression.
   Add the same case for Power Up and audit all lifecycle dedup lists, including
   `started`, `ended` and per-lead-time `startingSoon` keys.
2. Extract a pure lifecycle/retention policy. Validate timestamps, end-after-start,
   stable provider ID and duplicate rows before emitting anything.
3. Use account-scoped, restart-persistent records with time-aware retention.
   Expired history must be filtered independently of ledger retention. Never fix
   this merely by changing 50 to a larger arbitrary slice length.
4. Preserve known v2 state during an idempotent migration. Enrich retained IDs
   from the current valid feed without resetting history or causing an upgrade
   notification storm. Define corruption recovery and a safe rollback strategy.
5. Keep eligible unjoined upcoming events announceable, but retain joined-event
   gates for Saving Session starting-soon/started/ended behaviour.
6. Record identifier-free counts: returned/valid/expired/new/suppressed events,
   tracked records, retention/overflow decisions, last attempt and last success.
   No raw provider IDs, account numbers or event payloads in diagnostics.

### Chosen Behaviour to Document in the Release

- Expired events first discovered in a history response emit no announced,
  started or ended Flow.
- An already-active event first discovered at startup seeds current state
  silently rather than replaying a start notification. Normal observed future
  events still produce their joined lifecycle transitions.
- Ended triggers represent an observed active-to-ended lifecycle, not arbitrary
  historical rows. Do not replay events missed entirely while the app was offline.
- Rescheduling the same provider ID does not create a second announcement.
- Starting-soon retains the existing per-Flow lead-time evaluation and one-attempt
  per-session/per-15-minute-bucket behaviour; do not reduce it to once per event.
- Persistence precedes trigger attempts where necessary to prevent restart replay.
  This is an at-most-once-attempt policy, not an exactly-once delivery guarantee:
  a crash between persistence and Homey accepting a trigger can miss a notification.
  Document that trade-off; do not blindly retry failed Flow calls.
- Retention may prune expired records, not still-actionable tracked events.
  If an explicit safety bound is reached, suppress untrackable emissions and
  report overflow rather than allowing a repeated notification storm.

### Acceptance and Tests

- 51, 100 and 500 expired events: zero lifecycle triggers, including after restart.
- More than 50 valid upcoming events: each admitted event announces once across
  repeated polls, shuffled/duplicate responses and restart; overflow is safe.
- Adding one new upcoming event produces exactly one announcement attempt.
- The same ID with changed times does not reannounce; invalid dates fail closed.
- Joined/unjoined gates, start/end boundaries, lead-time buckets and DST work.
- Two accounts with identical provider IDs remain isolated; multiple meter devices
  for one account do not multiply announcements.
- Migration preserves known events and opaque keys; failed writes and malformed
  stored state do not produce a history replay.
- No new polling cadence, requests, card IDs or enrolment actions.

**Touchpoints:** `lib/SavingSessionsPoller.ts`, a pure helper under `lib/`,
`lib/diagnosticsKey.ts`, `test/pollers.test.js`, `test/kraken-client.test.js`.

**Delivery:** independently releasable hotfix R1. A real session is useful field
evidence, but its availability must not delay deterministic regression testing.
Reporter-specific root-cause closure still requires suitable field evidence.

## S74 — Cache-Only Widgets and Bounded Background Recovery

**Goal:** viewing a widget never changes the account's API request rate, including
when caches are empty, stale or failing.

### Tasks

1. Audit every widget endpoint and every getter it invokes. Replace Agile's
   render-triggered full refresh with a cache-only read. Audit Summary's historical
   usage and effective-rate acquisition, including cold-cache behaviour.
2. Populate required presentation snapshots through existing background scheduling
   and account caches. Do not add a timer. If a snapshot is unavailable, show an
   explicit pending/unknown state rather than fetching during rendering.
3. Preserve existing cache horizons for expensive history data where practical.
   Any relocation to background acquisition must have a measured request budget
   and must not repeatedly refetch history on every normal device refresh.
4. Add scoped failure cooldowns to background recovery, single-flight acquisition
   and bounded retry behaviour. Keep price-only degradation separate from other
   account functions. One failing account must not block another.
5. Proposed defaults: network/5xx failures back off 5 → 10 → 20 → 30 minutes,
   evaluated only on existing scheduled opportunities; honour longer provider
   `Retry-After` values. Keep the existing account-wide Kraken 429 gate. Confirm
   defaults against existing cadences and budget tests before implementation.
6. Authentication errors remain visible and are not disguised as unsupported or
   indefinitely retried. A verified credential change clears relevant failed
   snapshots/cooldowns without resetting the account rate-limit bucket.
7. Keep cache reads responsive and display source age, unavailable prices and
   recovery state honestly. Background success clears cooldown state.
8. Reproduce the meter-selection complaint with multiple meters and stale IDs.
   Fix only a confirmed in-app defect; otherwise record the result and request
   clarification about which custom-widget option was used.

### Acceptance and Tests

- All seven widget APIs produce **zero outbound REST/GraphQL/Carbon calls** on
  cold, current, stale and failure paths; test transitive getters with spies.
- 100 reads, concurrent tabs, option changes and a simulated hour of 60-second
  frontend reads do not initiate a device refresh or increase outbound calls.
- Existing background request counts meet the configured account budget; optional
  history does not multiply by widgets, tabs or meters. REST counts are also
  measured even though REST is not the Kraken budget.
- Fake-clock tests cover cooldown progression/reset, long `Retry-After`, 429,
  401/403, one in-flight acquisition, restart/startup and multi-account isolation.
- Background recovery restores current prices and published next-day rows without
  widget interaction; an empty cache is not falsely labelled current or zero.
- Existing thresholds, palettes, cheapest-slot/current markers and selected-meter
  persistence remain unchanged. A stale selected ID never selects a different meter.

**Touchpoints:** `widgets/*/api.js`, `widgets/*/public/index.html`,
`lib/OctopusMeterDevice.ts`, `lib/DeviceScheduler.ts`, `app.ts`, relevant cache/
budget helpers, widget/refresh/budget regression tests.

**Out of scope:** new price widget, new API cadence, full device-class refactor,
new billing semantics, user-triggered outbound refresh buttons.

## S75 — Dispatch Eligibility and Graceful Degradation

**Goal:** explain why dispatch data is unavailable without fabricating a healthy
empty plan, current charging state or cancelled session.

### Tasks

1. Introduce a typed internal eligibility result: eligible, ineligible, unknown or
   degraded, with sanitised reason and observed time. Keep this separate from the
   existing `FreshnessState` vocabulary (`current | stale | unknown`).
2. Define a contract/evidence table before changing dispatch queries. A missing
   device error, tariff name or empty list alone is not proof of permanent
   ineligibility. Preserve verified legacy account-scoped support where applicable.
3. Distinguish valid no-plan success, explicit unsupported/not-enrolled evidence,
   discovery failure, authentication failure, throttling and transient provider
   failures. Use typed/verified contract signals; avoid a broad error-string catch
   that hides unrelated faults.
4. Back off confirmed unsupported acquisition with a bounded negative cache
   (proposed maximum 30 minutes), tied to existing discovery/scheduling. Re-evaluate
   when normal discovery/verified repair provides new evidence; never reset budgets.
5. Preserve the last plan as historical/stale on failed or partial reads. Never
   send failed discovery into reconciliation as a successful empty plan.
6. Carry eligibility/reason/freshness through existing dispatch settings and views
   with additive fields. Existing Flow IDs and planned-versus-active labels remain.
7. Aggregate counters distinguish unsupported accounts, transient failures,
   successful empty plans and freshness. Suppress repeated identical error logs,
   while recording meaningful transitions and recovery.

### Acceptance and Tests

- Synthetic fixtures cover eligible EV/charge point, verified legacy support,
  no device, nonparticipating/unknown device, account-not-enrolled evidence and
  successful zero planned windows.
- Null/partial device status, schema drift, 401/403, 429, network/5xx and candidate
  dispatch failures do not silently become ineligible or successful empty plans.
- Failed/partial polls emit **no fabricated cancelled/ended/completed triggers**.
  An authoritative eligible empty response retains the legitimate existing edge rules.
- Stale/unknown/ineligible dispatch conditions fail closed; retained plans are not
  presented as measured physical charging or a billed household discount.
- Supported accounts recover within the bounded cache/discovery policy after
  new evidence, without re-pairing; multi-account results remain isolated.
- Request-count tests prove unsupported accounts do not retry on every widget read
  or consume the core budget unnecessarily.
- Boost consent and eligibility safeguards remain unchanged; tests mock writes.

**Touchpoints:** `lib/dispatch/`, `lib/DispatchPoller.ts`, `lib/KrakenClient.ts`,
`app.ts`, dispatch-related device adapters/settings, synthetic Kraken fixtures.

**Out of scope:** new boost/schedule controls, automatic opt-in, silently enabling
existing EV-control settings, treating planned intent as measured charging.

## S76 — Field Validation, Release Confidence and Support Closure

**Goal:** distinguish code-tested, installed, published and field-confirmed outcomes.

### Tasks and Acceptance

- Run each sprint's focused tests plus full build, lint, tests, production audit,
  publish validation and `git diff --check`; retain only the two documented
  cumulative-direction warnings. Record actual test counts, not the old baseline.
- Check migration/restart on a Homey, all affected widget options and existing
  representative Flows. Use the official CLI, no `--clean` or device replacement.
- Exercise a synthetic lifecycle on a development/test Homey without enrolling in
  events or changing charging/battery settings. Keep production Flows untouched.
- Use a test matrix spanning Agile, Tracker/non-smart accounts, supported IOG,
  gas/export, multiple meters and cold/stale caches. Fixture evidence is mandatory;
  unavailable physical account types remain explicitly unverified.
- Proposed field soak: at least 48 hours spanning startup/restart and a relevant
  tariff boundary; inspect recovery/request counters, not just crash totals.
- Seek a reporter follow-up for announcement recurrence and meter selection when
  authorised to send it. Drafting is not posting; absence of reports is not closure.
- Keep live EV boost start/cancel as a separate explicit opt-in check. Software
  readback and physical charging response are different evidence.
- Record commit, CI run, local hub/app version, GitHub tag/release, Homey build,
  Test/Live channel and verification time independently. Promotion is manual.
- A fix remains “code-tested, field confirmation pending” until relevant evidence
  exists. Live promotion with an unavailable field check requires an explicit
  risk decision; never silently mark the check passed.
- Prepare a rollback/forward-fix plan. Preserve device identities and event ledgers;
  account for the older version's replay defect rather than assuming reinstalling
  v1.0.36 is harmless. No state purge or automatic clean install.

**Exit:** R3 is verified or has individually documented and explicitly accepted
field gaps. This gate does not hold the independently validated S73 hotfix hostage.

## Gated Follow-On Sprints

### S77 — Release and Maintenance Hygiene

Carry forward S67 without mixing supply-chain changes into the incident fixes.
Review pinned GitHub Actions against supported upstream revisions at execution
time; preserve full immutable SHAs and Node.js 22 app compatibility. Verify version,
publish and release runbooks; inventory remaining Dutch Flow translations and
complete them with reviewed strings. Decide explicitly whether to schedule or
decline the deferred device-façade refactor.

**Acceptance:** release-policy/locale-parity tests and full CI pass; version/tag/
build workflow is documented with actual evidence; no runtime behaviour change.

### S78 — Health, Onboarding and Trust

Carry forward S68 using S73–S75's cached diagnostics. Enhance existing settings
and widget status, rather than automatically adding another dashboard widget.
Show source age, dispatch eligibility, pending/unsupported/degraded reasons and
safe next steps. Add a short setup/Flow cookbook and consistent Current/Stale/
Estimated/Planned/Settled explanations.

**Acceptance:** zero new outbound requests from health views; diagnostic reasons
are redacted and actionable; keyboard/screen-reader checks pass; onboarding never
recommends deleting a healthy meter for an optional integration failure.

### S79 — Paired Import/Export Opportunities

Carry forward S69. First establish the user outcome and data feasibility, then
build a recommendation using published dated import/export rows and existing
planners. Reuse an existing surface unless a distinct workflow warrants a new one.
No battery control is included.

**Acceptance:** full contiguous horizons, correct timezone/negative-price handling,
separate import cost/export opportunity, eligibility/confidence, “not evaluated” on
missing data, estimates never guaranteed earnings. Stop at the feasibility gate
if the account data cannot support the proposed result.

### S80 — Run-Now-or-Wait Advice

Scope the advice portion of S70: state the next complete useful window and its
estimated cost/carbon trade-off using existing planners. Do not claim realised
savings or include a weekly/monthly digest in this sprint.

**Acceptance:** energy/duration inputs and complete price horizons are explicit;
partial current slots and missing data are handled honestly; recommendation and
baseline are comparable; no new polling or automatic appliance control.

## Execution and Release Rules

1. Start from fresh remote state and preserve unrelated changes. Work on one
   selected sprint at a time; do not pull optional product scope into a hotfix.
2. Agree the small contract/test matrix first, then implement synthetic regression
   tests and a focused patch. S73–S75 can be reviewed independently.
3. Preserve IDs/settings/repair identity, reuse existing pure services and caches,
   and update Compose sources before any generated manifest.
4. Every implemented sprint runs the mandatory repository validation commands.
   A release also needs local/Test evidence and the documented delivery workflow.
5. Implementation, GitHub push/merge, Homey upload, manual promotion, live control
   and public communications are separate actions. This planning request performs
   none of them; obtain the relevant authority when execution is requested.
6. Update current handover and roadmap statuses after each verified result.
   Keep older release history intact and never mark an optional sprint delivered
   because a similarly named historical item shipped.
