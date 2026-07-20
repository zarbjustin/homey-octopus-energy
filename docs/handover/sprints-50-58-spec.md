---
goal: Post-v1.0.18 stability, hardening, refactor and feature roadmap (Sprints 50–58)
version: 1.0
date_created: 2026-07-20
last_updated: 2026-07-20
owner: zarbjustin (with Copilot multi-model workflow)
status: 'In progress'
tags: [roadmap, bug, optimisation, refactor, feature, architecture]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

This is the full, executable specification for Sprints **50–58** — the roadmap produced from a
tri-model (Opus 4.8 + GPT-5.5 + GPT-5.6 Sol) read-only evaluation of the app at **v1.0.18** plus
fresh Octopus product/API research. It exists so any model or human can pick up a sprint in
isolation, understand exactly what to build, and — critically — know the **concerns and risks** that
must be addressed before the change is safe to ship on a **published** app.

Delivery status at time of writing:
- **S50 — DELIVERED & merged** (PR #33).
- **S51 — PART 1 DELIVERED & merged** (PR #34: token single-flight); remainder pending.
- **S52–S58 — Planned.**

The condensed roadmap table lives in `ROADMAP.md` ("Sprints 50–58"); the raw evaluation evidence is
in the session `plan.md §15`. This document is the authoritative, task-level spec.

## 1. Requirements & Constraints

These invariants are **non-negotiable** and apply to every sprint. A change that violates one is a
defect regardless of test status.

- **REQ-001**: Preserve every existing capability, driver, widget, and Flow-card ID. Any migration
  must be explicit and documented.
- **REQ-002**: Public REST is authoritative for settled/billed consumption, products, unit rates, and
  standing charges. GraphQL/telemetry is never presented as settled or billed.
- **REQ-003**: GraphQL fails **closed** — on any ambiguity or missing data, produce nothing rather
  than a guess. Never synthesise a price/figure not backed by a real source.
- **REQ-004**: Never label estimated / planned / relative / telemetry values as `current`,
  `settled`, or `finalised`. Honour the F1 provenance vocabulary
  (`current | estimated | stale | planned | finalised | unknown`).
- **REQ-005**: Privacy — no account number, meter point (MPAN/MPRN), serial, or device identifier in
  logs, diagnostics, or persisted keys (use opaque/salted keys). Tests must use real-format ids.
- **SEC-001**: Keep the F0 shared Kraken request budget intact (~≤90 req/hr/account). No change may
  let sustained traffic exceed the ceiling, and no path may bypass `KrakenClient.post()`.
- **SEC-002**: No secrets in source, logs, or commits. Redact credentials in error paths.
- **CON-001**: No `homey app build` is available locally — `.homeycompose/**` and `app.json` must be
  kept byte-consistent by hand; `release-security.test.js` enforces `package.json` == compose version.
- **CON-002**: Do not bump the app version or touch the manifest unless the sprint ships a
  user-facing capability/Flow change that requires it. Bug/refactor/optimisation sprints are
  version-neutral.
- **GUD-001**: Workflow — tri-model design (Opus 4.8 + GPT-5.5 + GPT-5.6 Sol) → converge → implement
  → dual-model code review (GPT-5.5 + GPT-5.6 Sol) → PR → green CI (lint/build/test + Homey
  publish-validate + CodeQL) → squash-merge → `git pull --ff-only origin main`.
- **GUD-002**: One sprint per short-lived branch + PR. Never combine an unrelated incident fix,
  release bump, or App Store action with a feature sprint.
- **GUD-003**: Every commit carries the required `Co-authored-by` and `Copilot-Session` trailers.
- **PAT-001**: Every in-instance/app cache carries `{ value, ts }` + an explicit TTL + an in-flight
  (single-flight) guard, and never memoises a rejected promise.
- **PAT-002**: Any GraphQL feature must **re-introspect the versionless Kraken schema** before build,
  ship read-only first, and be verified against a reference client (e.g. the bottlecapdave HA Octopus
  integration) before any write mutation is attempted.

## 2. Implementation Steps

### Implementation Phase 0 — S50 Stability bug-bash (DELIVERED)

- GOAL-050: Eliminate the three verified P0/P1 stability defects and unify the dispatch truth model.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-050a | `KrakenClient.getOctoplusSessions`: 10-min TTL + clear-on-reject on the per-account promise memo. | ✅ | 2026-07-20 |
| TASK-050b | `settings/index.html`: read the `dispatch_diagnostics_v2` aggregate the poller writes (was reading nonexistent `v1`); safe DOM render. | ✅ | 2026-07-20 |
| TASK-050c | `drivers/electricity/device.ts`: route `octopus_dispatching` through the reconciled `app.getDispatchView(account).activeNow`; drop the legacy account-scoped fetch + a BudgetError-as-error log; prune the orphaned per-device `dispatches` diagnostic on flush. | ✅ | 2026-07-20 |
| TASK-050d | `DispatchPoller.isActive()` + v2 `activeAccounts` recompute active-now against the clock (via `getAccountView`) so capability, `dispatch_active` condition, and settings agree. | ✅ | 2026-07-20 |
| TASK-050e | Cache-TTL audit of all app.ts caches (all already `ts`+TTL+inflight; octoplus was the only gap). | ✅ | 2026-07-20 |
| TASK-050f | Regression tests: octoplus cross-cycle expiry/reject; dispatch capability↔view; settings v2; clock-based active agreement. | ✅ | 2026-07-20 |

### Implementation Phase 1 — S51 Kraken budget & request-efficiency hardening (PART 1 DELIVERED)

- GOAL-051: Reduce Kraken request pressure and remove budget-fairness hazards **without** starving
  core auth/dispatch. **HIGHEST-RISK SPRINT** — touches the shared budget-admission path.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-051a | `KrakenClient.getToken` single-flight (per-instance in-flight promise; rejected fetch not memoised). | ✅ (PR #34) | 2026-07-20 |
| TASK-051b | Bounded/reserved core admission in `lib/KrakenBudget.ts` `TokenBucket.acquire`: cap sustained core to a reserved share so a core burst cannot indefinitely starve `live`/`best`, while auth/dispatch are **never** blocked outside a 429 gate. Add a config constant + snapshot field. | | |
| TASK-051c | Startup jitter in `lib/AccountPoller.ts` `start()`: replace the immediate synchronous first `runPoll()` with a small randomised delay (e.g. 0–15 s) so Account/Dispatch/SavingSessions pollers do not stampede on boot. Must remain test-injectable (deterministic in tests). | | |
| TASK-051d | Per-feature, identifier-free budget counters: extend `budgetDiagnostics()` to count acquisitions/denials per priority (and optionally per feature tag) for the settings diagnostics; no account keys. | | |
| TASK-051e | Coalesce duplicate REST reads: monthly-cost vs billing consumption/rates; the two per-refresh carbon calls; `discoverMeters` shared by tariff-check + export billing; product catalogue re-listed per candidate in tariff comparison. Use short-TTL request coalescing, not behaviour change. | | |
| TASK-051f | Account-level Octoplus points cache (currently re-fetched; wrap with `ts`+TTL like the other app caches). | | |
| TASK-051g | Account-wide repair credential propagation: when an API key is repaired on one meter, propagate to all sibling devices/pollers on that account and re-key the client/budget canonically (see `app.ts:67-108`, `OctopusMeterDriver`), so siblings don't thrash the shared client with a stale key. | | |
| TASK-051h | System-level test: a simulated 2-EV account over 1 h issues ≤~90 Kraken calls across all pollers/devices. | | |

### Implementation Phase 2 — S52 Decompose `OctopusMeterDevice` (Planned)

- GOAL-052: Break the ~2,358-line god-object into typed services with **zero** behaviour, ID,
  manifest, or version change.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-052a | Extract `PriceService`/`RefreshCoordinator`, `ConsumptionService`, `AccountReportingService`, `Health&Freshness`, `DeviceScheduler`, `TariffService`, and a thin `PlanningFacade` behind interfaces. | | |
| TASK-052b | Add a typed `OctopusApp` interface to replace repeated `homey.app as { ... }` structural casts. | | |
| TASK-052c | Consolidate duplicated timezone helpers into `lib/billing/tz.ts`; centralise `maskAccount`. | | |
| TASK-052d | Remove dead state (`refreshing`, unused `getCachedCompletedDispatches`, etc.). | | |
| TASK-052e | Add characterization tests capturing current behaviour BEFORE moving code; keep them green throughout. | | |

### Implementation Phase 3 — S53 Per-source provenance + accessibility (Planned)

- GOAL-053: Make freshness honest per data domain and make the UI accessible.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-053a | Per-domain freshness readings (price/consumption/balance/carbon/live/dispatch/billing) instead of one device timestamp; stop labelling a stale field "Current". | | |
| TASK-053b | Widget source badges reflect per-domain provenance; stale-aware Flow conditions/tokens. | | |
| TASK-053c | Settings save/error feedback (currently swallows all get/set errors). | | |
| TASK-053d | Accessible chart summaries + non-colour-only patterns; keyboard/SR discoverability. | | |
| TASK-053e | Terminology audit: "today" vs "rolling 24h/last-48-record" window wording. | | |

### Implementation Phase 4 — S54 Settled consumption insights + budget Flows (Planned)

- GOAL-054: Ship REST-authoritative usage/cost history and a monthly budget trigger.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-054a | REST `group_by` day/week/month usage & cost history; peak-share; settlement-through indicator. | | |
| TASK-054b | Monthly budget setting + over-budget / run-rate Flow trigger from the existing projection. | | |
| TASK-054c | Insights widget / summary drill-down. Live telemetry is never used as billing. | | |

### Implementation Phase 5 — S55 Tariff comparison 2.0 (Planned)

- GOAL-055: An honest, eligibility-aware tariff **estimate** (never "best", never auto-switch).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-055a | One cached product catalogue (kills per-candidate re-listing). | | |
| TASK-055b | Simulate actual consumption shape incl. standing charges for Agile/Go/Tracker(+gas)/Cosy + export pairing. | | |
| TASK-055c | Eligibility + confidence + explicit "not evaluated" reasons; output labelled an ESTIMATE. | | |

### Implementation Phase 6 — S56 Saving Sessions / Power-ups automation (Planned)

- GOAL-056: Event awareness + reminders for Power Down **and** Power Up.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-056a | Announced / starting-soon / active conditions for both event types; joined/accepted state where proven. | | |
| TASK-056b | Reminders with quiet-hours + lead-time + dedupe; event widget/timeline. | | |
| TASK-056c | Pending vs finalised reward wording (participation is intent, not settlement). | | |
| TASK-056d | Explicit-consent auto-join ONLY if a documented mutation exists — otherwise omit. | | |

### Implementation Phase 7 — S57 Planned-dispatch + IOG-preference research (Planned)

- GOAL-057: Dispatch-plan Flows + **read-only** IOG preference display, schema-verified.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-057a | `plan-starts-within` condition + a stable plan token for round-trips; standalone estimated-effective-rate condition. | | |
| TASK-057b | READ-ONLY target-SoC / ready-by display ONLY if live introspection confirms the schema; synthetic fixtures first. | | |
| TASK-057c | Any write mutation deferred behind explicit consent + rollback. No `price_finalised` unless REST/billing-backed. | | |

### Implementation Phase 8 — S58 Cosy/E7 + export/Flux + carbon optimiser (Planned)

- GOAL-058: Recommendation-only scheduling from published REST rows + carbon weighting.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-058a | Economy-7/Cosy schedule materialised from PUBLISHED REST rows (never hard-coded marketing schedules). | | |
| TASK-058b | Paired import/export plan; carbon-price weighting; greenest-window widget from `lib/carbon.ts`. | | |
| TASK-058c | Live Flux eligibility check ("temporarily unavailable" today); recommendations only, no hardware control. | | |

## 3. Alternatives

- **ALT-001**: Ship features (S54+) before the hardening/refactor. Rejected — the god-object and
  budget hazards would make every feature riskier and harder to review.
- **ALT-002**: One big "v2" release combining all sprints. Rejected — violates GUD-002; too large to
  review safely; a single regression would block the whole batch on a published app.
- **ALT-003**: Hard-cap core requests equally with live/best. Rejected — would risk starving auth and
  dispatch (the core purpose of the priority classes). S51 uses a **reserved** core share instead.
- **ALT-004**: Build IOG preference **writes** now. Rejected — undocumented/experimental schema;
  read-only first (PAT-002).

## 4. Dependencies

- **DEP-001**: S51 depends on S50 (stable dispatch/cache paths).
- **DEP-002**: S52 depends on stable truth paths from S50–51.
- **DEP-003**: S53 depends on S52 typed services.
- **DEP-004**: S54 depends on S53; S55 depends on S52 + S54; S56 depends on S50 cache fix + S51 budget;
  S57 depends on S50–53; S58 depends on S54–55.
- **DEP-005**: Toolchain — Node test runner (`node:test`), `tsc`, ESLint, `homey app validate`.
- **DEP-006**: External reference — bottlecapdave HA Octopus integration for GraphQL schema
  verification (S57). Public REST + versionless Kraken GraphQL.

## 5. Files

- **FILE-001**: `lib/KrakenBudget.ts` — F0 token bucket (S51b core admission, S51d counters).
- **FILE-002**: `lib/KrakenClient.ts` — `post()` choke point, `getToken` (S51a done), REST coalescing.
- **FILE-003**: `lib/AccountPoller.ts` — poller base `start()` (S51c jitter).
- **FILE-004**: `app.ts` — per-account caches, `getKrakenClient`, `invalidateAccountCaches`,
  repair propagation (S51g); `getDispatchView` (S50, consumed onward).
- **FILE-005**: `drivers/electricity/device.ts` + `drivers/electricity/driver.ts` — repair path (S51g).
- **FILE-006**: `lib/OctopusMeterDevice.ts` — S52 decomposition target (~2,358 lines).
- **FILE-007**: `lib/DispatchPoller.ts` — reconciled truth model (S50 done; S57 plan tokens).
- **FILE-008**: `settings/index.html` — diagnostics + error feedback (S51d, S53c).
- **FILE-009**: `lib/carbon.ts`, `lib/billing/*`, widgets `**/public/index.html` — S53/S54/S58.
- **FILE-010**: `test/**` — regression + system tests per sprint.

## 6. Testing

- **TEST-001**: Cross-cycle octoplus cache expiry + clear-on-reject (S50, done).
- **TEST-002**: Token-fetch concurrency single-flight + rejected-not-cached (S51a, done).
- **TEST-003**: Core-flood fairness — a core burst does not permanently deny live/best (S51b).
- **TEST-004**: Startup jitter spreads first polls (deterministic clock) (S51c).
- **TEST-005**: System budget — simulated 2-EV account ≤~90 Kraken calls/hr (S51h).
- **TEST-006**: Repair on one meter re-keys all siblings; no stale-key thrash (S51g).
- **TEST-007**: Characterization snapshot suite stays green across the S52 refactor.
- **TEST-008**: Per-domain freshness never marks a stale field current (S53a).
- **TEST-009**: Settled insights derive only from REST `group_by`; telemetry excluded (S54).
- **TEST-010**: Tariff comparison outputs an ESTIMATE with eligibility/confidence, never "best" (S55).
- **TEST-011**: GraphQL feature fails closed on missing schema; read-only enforced (S57).

## 7. Risks & Assumptions

Concerns/risks to address per sprint (this is the section you asked for):

- **RISK-051-STARVATION** (High): S51b/g touch the shared budget-admission path on a **published**
  app. A mis-tuned reserved-core share or a repair re-key bug could **starve auth/dispatch** or thrash
  the shared client → account-wide throttling for real users. Mitigation: never block core outside a
  429 gate; keep GraphQL fail-closed; ship behind exhaustive fairness + system-budget tests; dual
  review; consider staging via Test channel before promoting.
- **RISK-051-STALE**: Any request coalescing (S51e) must not serve obsolete data as current — coalesce
  only within a short TTL and preserve provenance (REQ-004).
- **RISK-052-REGRESSION** (Med/High): Decomposing a 2,358-line god-object risks subtle behaviour
  drift (refresh ordering, cumulative-meter writes). Mitigation: characterization tests BEFORE moving
  code; no behaviour change permitted; keep IDs/version fixed (CON-002).
- **RISK-053-FRESHNESS**: Splitting one timestamp into per-domain readings could flip currently-
  "green" widgets to "stale" — that is the correct, honest outcome, but communicate it (it may look
  like a regression). Watchdog overlap (a 90s refresh-lock discard that doesn't cancel the prior
  refresh) can still race capability/store writes — address as part of S53/S52.
- **RISK-054-BILLING-HONESTY** (High): Insights must be REST-authoritative and clearly marked
  "settled through <date>"; never blend live telemetry into billed figures (REQ-002).
- **RISK-055-MISLEAD** (High): A tariff comparison that omits eligibility, standing charges, or
  consumption shape could mislead a user into a worse tariff. Output an ESTIMATE with confidence +
  "not evaluated" reasons; never auto-switch; never call it "best".
- **RISK-056-REWARD**: Saving-Session/Power-up rewards settle later from meter reads — event
  participation is **intent, not settlement**. Auto-join only with explicit consent AND a documented
  mutation.
- **RISK-057-SCHEMA** (High): The Kraken GraphQL schema is versionless and IOG preference writes are
  undocumented/experimental. Mandatory re-introspection + synthetic fixtures + reference-client
  verification; read-only first; writes deferred behind consent + rollback (PAT-002).
- **RISK-058-DEPRECATION**: Greener Nights ends **31 Jul 2026** (do not build on it); Intelligent
  Flux is currently "temporarily unavailable" (live eligibility check); never hard-code Cosy/Flux/Go
  schedules when dated REST rows exist.
- **RISK-PRIVACY** (cross-cutting): Diagnostics/state historically keyed by raw device id / account
  number / MPAN-serial; synthetic-id tests miss it. Any touched surface must move to opaque keys +
  migration, with real-format ids in tests (REQ-005).
- **RISK-RELEASE**: `.homeycompose` ↔ `app.json` drift or an accidental version bump breaks the
  release-security test / publish (CON-001, CON-002).
- **ASSUMPTION-001**: The app remains cached one `KrakenClient` per account (so per-instance
  single-flight suffices). If that changes, S51a must move to an account-level token registry.
- **ASSUMPTION-002**: `homey app validate --level publish` remains the local proxy for publish
  validation (no `homey app build`).
- **ASSUMPTION-003**: The tri-model workflow remains available (Gemini sub-agents return empty — do
  not use them).

### Open external gates (not code)
- **GATE-IOG**: v1.0.18 IOG price-gap fix is a strong reviewed hypothesis but **not yet
  field-confirmed** by the affected account (Darren). Do not declare the incident fixed until
  confirmed on the Test build. Reply drafted in `docs/handover/darren-iog-reply.md`.
- **GATE-TEST-CHANNEL**: Promote the uploaded v1.0.18 build to the **Test** channel in the Homey
  Developer dashboard, then share the Test link.

## 8. Related Specifications / Further Reading

- `ROADMAP.md` → "Sprints 50–58" (condensed table + rejected-ideas list).
- `docs/handover/sprints-42-48-spec.md` — the prior arc's spec (F0/F1 foundations).
- `docs/research/sprints-42-48-research.md` — supporting Octopus API evidence.
- `docs/research/kraken-contracts.md` — Kraken contract record (Sprint 41).
- `HANDOVER.md` — current release state + S50/S51 delivery notes + open gates.
- Session `plan.md §15` — raw tri-model evaluation (verified bugs, quality/UX findings, research).
- bottlecapdave HA Octopus Energy integration — GraphQL schema reference for S57.
