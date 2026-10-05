# 08 — Bug-bash report

## App-wide follow-up — 5 October 2026

Scope: the entire app, not only charging. Reviewed REST/Kraken/carbon transport,
account caches, pairing/repair, scheduler/refresh fences, electricity/gas/export
pricing and usage, billing/reporting, dispatch/session lifecycle, all seven widget
routes, old/new Flow contracts and release checks. This is a local source and
fault-injection review, not exhaustive physical/Homey UI acceptance.

Baseline: 651 passing tests. Fixes use synthetic regressions; no real account
requests, credentials, raw crash logs, production Flow execution, install,
publication or public reply. Private feedback is represented only as generic
requirements; messages and identifiers are not stored here.

| ID | Priority | Confirmed issue / local fix | Evidence / status |
|---|---|---|---|
| BBA-01 | P1 | REST/Kraken/carbon stopped timing after headers, leaving body decoding unbounded | Shared whole-response timeout; stalled-body/abort/retry/REST lock regressions; fixed locally |
| BBA-02 | P1 | Kraken followed redirects and included upstream HTTP bodies in errors | Manual redirect rejection and status-only HTTP errors; no-follow/no-body regressions; fixed locally. Hardening, not evidence of an actual credential leak |
| BBA-03 | P2 | Shared Kraken gate ignored Retry-After; concurrent 429s could shorten it | Provider delay is a minimum and cannot shorten an existing gate; client/budget tests; fixed locally |
| BBA-04 | P1 | Missing/non-numeric balances became £0 | Only finite numeric balances accepted; genuine zero/negative preserved; fixed locally |
| BBA-05 | P2 | Future-only carbon could be greenest now; empty/boolean intensities became zero | Real current point and complete requested horizon required; gaps/duplicates/invalid intensity rejected; fixed locally |
| BBA-06 | P1 | Billing skipped unpriced consumption/standing days, understating totals | Missing import/export coverage and incomplete standing history throw before persisting; genuine zero preserved; fixed locally. Entirely absent standing coverage is now also rejected under BBA-10 |
| BBA-07 | P1 | Concurrent open-ended IOG rows could select price by array order | Raw conflicting intervals fail closed; explicit household bands still resolve; contradictory equal-start bands rejected; pure/device tests; fixed locally, affected-account retest pending |
| BBA-08 | P2 | Missing gas usage produced 0 kg carbon | Unknown/non-finite usage stays null; genuine zero/kWh preserved; fixed locally |
| BBA-09 | P3 | Deadline search created a formatter for every searched minute | One per search, DST unchanged; deterministic allocation regression. One local sample: 102 ms to 7 ms for the same next-day deadline, not a hardware guarantee |
| BBA-10 | P1 | Legacy costs silently skipped unpriced records; E7 and standing-charge fallbacks borrowed invalid rows | Fixed locally: reporting/comparison helpers reject missing/partial/non-finite prices and required night registers; absent standing charges are unknown, not free. Cost gaps retain last-known values, mark source coverage unavailable immediately, suppress cost triggers and preserve settled cumulative updates. Export lookup failures retain the prior billing summary; unpriced comparison baselines return unavailable. Device recovery/persistence regressions pass |

Validation after BBA-10: 672 tests, clean lint, production audit zero vulnerabilities, Homey
build and publish validation pass with only the two documented direction warnings.
All 80 prior Flow contracts unchanged; 14 charging additions delivered in Test.
Bug-bash fixes add no identity, provider timer or widget-driven acquisition.

### Community follow-through and optimisations

- Announcement reporter cannot currently retest; confirmation remains open.
  See the [public reply](https://community.homey.app/t/156860/34).
- Every qualifying slot stays the main charging recipe; duration/bounded fallback
  optional. Standard/Advanced Flow and physical acceptance remain open.
- Concurrent open-ended IOG rows are a contract/eligibility investigation, not
  permission to guess household/EV prices or allowance rules. Synthetic coverage
  does not establish the provider cause or affected-account recovery.
- S78: source-specific freshness, unknown versus none, estimates versus settlement,
  simpler examples/card discovery. Preserve existing IDs.
- S77: periodic official API/deprecation review and malformed synthetic fixtures.
  Keep the shared budget; no new quota polling without a measured budget.
- Measure a shared regional carbon cache across meters before changing cadence.
  Existing account coalescing and seven widget no-network tests remain green.
- Real widget selection/palettes, migration, overnight IOG and unsupported-tariff
  checks still required. No new crash-portal or physical test in this review.
  The earlier partial soak is not a 48-hour pass.

The user requested App Store delivery, then asked about the blocker. BBA-10 is
closed and delivered in v1.0.38 / Build 38 Test on 5 October. Normal local Pro
upgrade/readback preserves device/settings/Flow fingerprints. Publish run
`37378428284` passed; Live remains Build 36, with no certification submission.
Next: real UI/requester/overnight acceptance, then separately authorised
Flow/physical acceptance. No automatic Live clearance.

## Historical baseline — July 2026

The rows below are historical findings, not a current unresolved-bug list. Many
were implemented later; use the current handover/roadmap and follow-up above.

Scope: QA-style backlog from read-only analysis. Priority scheme: **P0** data loss/security/release blocker, **P1** high user impact or account-wide risk, **P2** important edge case/quality issue, **P3** polish. The open Intelligent Octopus Go v1.0.20 field-verification item is **explicitly excluded** and tracked separately in `HANDOVER.md:92` and `HANDOVER.md:157`.

## Prioritised bug backlog

| ID | Priority | Title | Area | Repro / hypothesis | Evidence | Suggested fix direction |
|---|---|---|---|---|---|---|
| BB-01 | P1 | Repairing one meter may leave sibling devices on stale credentials | Pairing/repair/lifecycle | Pair electricity+gas/export for one account, repair only one device with a new API key, then observe siblings still carrying old store credentials until each is repaired/restarted. This is partially documented as planned S51g. | Repair applies `nextStore` only to the current `device` (`lib/OctopusMeterDriver.ts:130`, `lib/OctopusMeterDriver.ts:153`); `applyCredentials` invalidates account caches but does not update sibling stores (`lib/OctopusMeterDevice.ts:488`); S51g names account-wide propagation (`docs/handover/sprints-50-58-spec.md:95`). | Add account-wide credential propagation through drivers/app, with a regression test that siblings re-key and no stale client remains. |
| BB-02 | P1 | Persisted diagnostics expose raw meter/account-derived identifiers | Privacy/data-correlation | Inspect Homey settings after refresh/poller activity. Device diagnostic key uses `getData().id`, which is built from fuel, MPAN/MPRN and serial; Saving Sessions state/diagnostics use raw account numbers. | Device id is `${meter.fuel}-${meter.mpxn}-${meter.serial}` (`lib/OctopusMeterDriver.ts:70`); integration diagnostics use `String(this.getData().id)` (`lib/OctopusMeterDevice.ts:639`); saving-session state and diagnostics key by account (`lib/SavingSessionsPoller.ts:70`, `lib/SavingSessionsPoller.ts:156`); privacy invariant says no account/meter ids in diagnostics (`docs/handover/sprints-50-58-spec.md:41`). | Migrate settings keys to opaque/salted IDs, prune old keys, and test with real-format synthetic IDs. |
| BB-03 | P1 | Startup poller stampede can spend Kraken budget immediately after app boot | API-failure/offline/reconnect | Restart app with multiple meters/accounts. App-level pollers run immediately while each device also performs initial refresh, creating a burst of token, dispatch, saving-session, balance and price calls. | `AccountPoller.start()` calls `runPoll()` before interval (`lib/AccountPoller.ts:24`); app starts saving and dispatch pollers together (`app.ts:321`, `app.ts:325`); devices refresh during init (`lib/OctopusMeterDevice.ts:235`); S51c plans jitter (`docs/handover/sprints-50-58-spec.md:91`). | Add deterministic startup jitter and a system budget test over a simulated multi-device account. |
| BB-04 | P1 | Core Kraken bursts can starve live/best-effort traffic after debt | Resilience/rate limiting | Under repeated core calls, token balance can be driven to `-capacity`; live/best requests are denied until refill catches up. This protects core but may make live widgets look stale for long periods. | Core always admits outside gate and floors at `-capacity` (`lib/KrakenBudget.ts:93`, `lib/KrakenBudget.ts:97`); tests document bounded core debt (`test/kraken-budget.test.js:82`); S51b requires reserved core admission (`docs/handover/sprints-50-58-spec.md:88`). | Implement reserved-core share/counters without blocking auth/dispatch; verify fairness and ≤90/hr. |
| BB-05 | P2 | Saving Session “starting soon” may fire repeatedly for the same event | User journey/notifications | When a joined event is within the 245-minute soon window, every 15-minute poll fires `saving_session_starting_soon` because only known/started/ended IDs are tracked. | State shape lacks a `soon` list (`lib/SavingSessionsPoller.ts:6`); soon trigger fires on every qualifying poll (`lib/SavingSessionsPoller.ts:75`); persisted state only trims known/started/ended/free-electricity IDs (`lib/SavingSessionsPoller.ts:132`). | Track `startingSoon` IDs or bucket by lead-time threshold; add tests for no duplicate soon trigger. |
| BB-06 | P2 | Device-wide freshness can show one stale domain as current | State/provenance | Force price success but carbon/billing/live failure. Widgets using `getDataFreshness` may report one overall device freshness rather than per-source status. | `getDataFreshness` derives only from `lastHealthyRefreshAt` and alarm state (`lib/OctopusMeterDevice.ts:304`); S53 asks for per-domain freshness (`ROADMAP.md:78`, `docs/handover/sprints-50-58-spec.md:109`). | Implement per-domain freshness readings and stale-aware widget/Flow tokens. |
| BB-07 | P2 | Watchdog-displaced refresh may still write stale data after newer refresh | Race/concurrency | Simulate a hung refresh that exceeds 90s, start a replacement, then let the older promise complete. The old promise no longer owns the lock but its internal Homey writes are not generation-guarded. | Watchdog resets lock after 90s (`lib/OctopusMeterDevice.ts:520`); finally only protects clearing the lock (`lib/OctopusMeterDevice.ts:532`); spec calls out old-refresh write race (`docs/handover/sprints-50-58-spec.md:239`). | Add refresh generation tokens around store/capability writes or abortable fetches in S52/S53. |
| BB-08 | P2 | “Today” usage is actually last 48 records / rolling window | Data correctness/UX | Compare `octopus_usage_today` around local midnight with actual local-day consumption. Code sums `last48` records fetched from a history window, not local midnight-to-now. | `last48 = sorted.slice(-48)` (`lib/OctopusMeterDevice.ts:845`); `octopus_usage_today` is set from `last48` (`lib/OctopusMeterDevice.ts:848`); S53 explicitly plans “today” vs “rolling 24h” audit (`ROADMAP.md:78`). | Rename/copy to rolling-24h where compatible, or compute true local-day usage while preserving existing IDs with clear docs. |
| BB-09 | P2 | Tariff comparison can overstate “best” without eligibility/confidence | Unexpected journey/financial guidance | Run `find_best_tariff` on limited history. It compares only a small product set, can omit eligibility/export/gas shape, and returns `best_product` wording. | Candidate list only Current/Agile/Go/Flexible (`lib/OctopusMeterDevice.ts:1807`); result uses `best_product` / `Current tariff (already cheapest)` (`lib/OctopusMeterDevice.ts:1874`); S55 says output an estimate never “best” (`ROADMAP.md:80`). | Rework as S55: cached catalogue, eligibility, confidence, “estimate/not evaluated” reasons, no “best” claim. |
| BB-10 | P2 | Carbon calls are uncached and can make “good now” stale or noisy | API-failure/performance | On short poll intervals or multiple electricity devices, carbon current+forecast are fetched every `refreshExtra`. A failure records diagnostics but leaves previous carbon values available. | Carbon fetches current+forecast per refresh (`drivers/electricity/device.ts:101`, `drivers/electricity/device.ts:111`); `good_now` uses cached price/carbon/dispatch (`drivers/electricity/device.ts:155`). | Add region-level carbon cache with freshness state; make `good_now` expose unknown/stale provenance. |
| BB-11 | P2 | Billing/export summary does repeated discovery and may show export unavailable rather than stale | Billing/edge case | For import meters with export, every billing summary discovers meters and fetches export consumption/rates; on transient discovery failure the catch turns export input undefined. Hypothesis: users may see export omitted instead of stale. | `exportBillingInput` calls `discoverMeters` (`lib/OctopusMeterDevice.ts:2128`); caller catches to `undefined` (`lib/OctopusMeterDevice.ts:2111`); export value is null when no export tariff (`lib/billing/aggregate.ts:72`). | Cache discovered export meter separately from transient errors; include reason/stale in billing summary. |
| BB-12 | P2 | Settings/state maps can grow by account over time without migration/pruning symmetry | Resource management/privacy | Pair/repair/delete across accounts and inspect `saving_sessions_state_v2` and diagnostics. They are keyed by account number and only trim event arrays, not account entries. | Saving-session state writes `allState[creds.accountNumber]` (`lib/SavingSessionsPoller.ts:133`); diagnostics writes `all[accountNumber]` (`lib/SavingSessionsPoller.ts:156`). | Bound account entries and clean up when `accounts()` no longer includes a key; migrate to opaque keys. |
| BB-13 | P3 | README current-release section is stale | Documentation/onboarding | Open README on current main; it says 1.0.18 while package/HANDOVER say 1.0.20. | README current-release text (`README.md:48`, `README.md:50`); source version 1.0.20 (`package.json:3`, `HANDOVER.md:9`). | Update README after Build 20 field-verification wording is known; keep `docs-currency` expectation current. |
| BB-14 | P3 | Lint excludes tests and JS while tests are a large safety net | Testing/tooling | Introduce a style/type mistake in a JS test; ESLint will not scan `test/` because ignore patterns exclude it. | ESLint ignore patterns include `test/` and `*.js` (`.eslintrc.json:3`); package lint uses eslint over repo (`package.json:10`). | Consider a separate test-lint pass or targeted checks after S52; avoid churn now. |

## Explicit exclusions and non-bugs

- **IOG v1.0.20 field verification is not in this backlog.** It remains an external validation gate, not a code/documentation bug in this workstream (`HANDOVER.md:92`, `docs/handover/sprints-50-58-spec.md:266`).
- Negative prices and spikes are handled deliberately: negative prices are never clamped in planner/analytics (`lib/planner/tie.ts:14`, `lib/analytics/priceAnalytics.ts:13`) and are tested (`test/planner-tie.test.js:65`, `test/price-analytics.test.js:72`).
- Gas live telemetry remains intentionally dropped as shippable work (`ROADMAP.md:84`, `docs/handover/sprints-42-48-spec.md:136`).

⚠ Cross-discipline note: Product may object that BB-08 risks changing a familiar `octopus_usage_today` value. Treat the current value as a compatibility contract; fix by adding clear wording/provenance first, then migrate calculations only with release notes and tests.
