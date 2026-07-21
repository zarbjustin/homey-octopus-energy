# 17 — Risk Register

**Review date:** 21 July 2026  
**Scale:** likelihood and impact are Low / Medium / High / Critical. Exposure is
the combined pre-mitigation rating.

## Register

| ID | Category | Description | Likelihood | Impact | Exposure | Mitigation / controls | Owner discipline | Residual risk |
|---|---|---|---|---|---|---|---|---|
| R-001 | API / operational | Kraken budget exhaustion or field-specific throttling degrades live, dispatch, balance or auth across the account. | High | High | **High** | Keep F0 ≤90 req/hr governor, 429 gate and priority soft-skips (`lib/KrakenBudget.ts:17-18`, `:89-127`); complete S51 fairness, jitter, counters and one-hour test; inspect GraphQL point/error metadata. | Architecture + API + SRE | Medium: external apps and dynamic limits remain outside control. |
| R-002 | Architecture | `OctopusMeterDevice` god-object causes change amplification and hidden ordering regressions. | High | High | **High** | S52 characterization-first service extraction; typed ports; no behaviour/ID change; thin device façade. | Architecture + code quality | Medium until decomposition is complete. |
| R-003 | Refactor | S52 changes refresh order, cumulative meter writes, health or Flow edges. | Medium | High | **High** | Golden/characterization tests before movement; extract leaf services first; one cumulative writer; staged Test-channel smoke tests. | Code quality + QA | Medium due to implicit legacy behaviour. |
| R-004 | Concurrency | 90-second refresh watchdog permits an old and new generation to overlap and mutate capabilities/store. | Medium | High | **High** | Replace lock reset with cancellation/generation ownership; propagate `AbortSignal`; assert stale generations cannot write. | Architecture + code quality | Low/Medium after coordinator change. |
| R-005 | API | Versionless GraphQL fields/interfaces change, deprecate or become permission-dependent. | High | High | **High** | Re-introspect before each feature; synthetic fixtures; typed error codes; fail closed; official announcement watch. | API + QA | Medium: upstream can change without versioned endpoint. |
| R-006 | API / product | Planned/completed dispatch is interpreted as discounted or settled energy. | Medium | Critical | **High** | Preserve dispatch intent model (`lib/dispatch/types.ts:3-34`); REST billing authority; explicit estimated/planned/finalised labels; no price inference from completion alone. | Product + architecture | Low if wording/tests remain enforced. |
| R-007 | Field verification | **Open IOG field-verification item:** v1.0.20 seven-member tariff handling is not yet confirmed on the affected account. | Medium | High | **High** | Keep HANDOVER gate open; promote Build 20 to Test; request one privacy-safe diagnostic/confirmation; do not alter or declare resolved without evidence. | Product support + API | Medium until affected-account confirmation. |
| R-008 | Data correctness | REST and GraphQL disagree on tariff code/rates; fallback could misprice. | Medium | Critical | **High** | REST first; GraphQL only adopts live code; synthesize only trusted DayNight/FourRate schedule; fail closed on ambiguity (`docs/research/kraken-contracts.md`). | API + architecture | Low/Medium due to account-specific contracts. |
| R-009 | Security | API key/account duplicated in multiple device stores; repair leaves stale sibling credentials. | Medium | High | **High** | Complete S51g account-wide transactional propagation; consider account credential registry; retain original meter identity. | Security + code quality | Medium while per-device copies remain. |
| R-010 | Privacy | Persisted diagnostics/state use account-number or device-derived keys. | Medium | High | **High** | Opaque salted keys, migration, identifier-free aggregates, real-format redaction tests; never persist smart-flex IDs. | Security + privacy | Low/Medium after migration. |
| R-011 | Security / release | `HOMEY_PAT` compromise enables malicious app publication. | Low/Medium | Critical | **High** | Least-scope token, protected GitHub Environment/reviewer, main/tag SHA validation, rotation/revocation runbook, pinned publish action. | Security + release engineering | Medium because external action and maintainer accounts remain trusted. |
| R-012 | Supply chain | Dev dependency or GitHub Action compromise affects build/release despite zero runtime dependencies. | Medium | High | **High** | `npm audit` hard gate, lockfile review, immutable action SHAs enforced by tests (`test/release-security.test.js:14-21`), CodeQL, dedicated update PRs. | Security + release engineering | Medium. |
| R-013 | API / performance | Duplicate REST consumption, carbon and product reads increase latency/load and create inconsistent snapshots. | High | Medium | **High** | S51e short-TTL coalescing; request-scoped snapshot; S55 one catalogue; bounded time windows/grouping. | Architecture + API | Low after coalescing. |
| R-014 | Data correctness | Large consumption pages/time ranges cause memory, timeout or partial-history problems. | Medium | Medium/High | **Medium/High** | Use REST `group_by` for S54, paginate bounded periods, monitor response size/duration, preserve settlement-through date. | API + performance | Low/Medium. |
| R-015 | Product | Tariff comparison misleads by omitting eligibility, payment method, standing charge or consumption shape. | Medium | High | **High** | S55 actual-shape simulation, eligibility/confidence, “not evaluated” reasons, estimate wording, no auto-switch. | Product + data | Medium; future tariffs remain complex. |
| R-016 | Product | Estimated live gas is perceived as billed/current. | Medium | High | **High** | Keep Sprint 48 dropped; research-only, never billing. | Product + architecture | Low if non-goal is maintained. |
| R-017 | UX / trust | One aggregate freshness timestamp labels stale domains as current. | High | Medium | **High** | S53 per-source readings, stale-aware Flow tokens and widget badges; preserve F1. | UX + architecture | Low after S53. |
| R-018 | UX | Honest stale indicators appear to users as a regression or “less reliable” app. | Medium | Medium | **Medium** | Release notes, source/age explanation, last-known value retention, support playbook. | Product + UX | Low/Medium. |
| R-019 | Homey platform | Dynamic capability removal breaks user Flows/Insights history. | Low/Medium | High | **Medium/High** | Limit dynamic add/remove to opt-in live `measure_power`; preserve all other IDs; migration review for any change. | Homey platform + QA | Low. |
| R-020 | Homey Energy | Non-monotonic cumulative values or cursor races corrupt Energy reporting. | Medium | High | **High** | One consumption writer, atomic cursor semantics, restart tests, never add fake opposite direction; follow cumulative contract. | Data + QA | Low/Medium. |
| R-021 | Homey platform | Widget API/webview changes or Homey compatibility changes affect six widgets. | Medium | Medium | **Medium** | Maintain `>=12.4.0`, widget smoke tests, accessible fallback text, scoped APIs, announcement review. | Homey platform + frontend | Low/Medium. |
| R-022 | Security / frontend | Upstream strings or errors create XSS in widgets/settings. | Medium | High | **High** | Shared escaping/textContent, field allow-list, malicious input tests, no raw bodies. | Security + frontend | Low. |
| R-023 | Automation | Event/price/dispatch notifications or triggers repeat and cause automation storms. | Medium | High | **High** | Edge/crossing semantics, high-water marks, dedupe, quiet hours, successful-poll-only cancellation, tests. | Flow + QA | Low/Medium. |
| R-024 | API mutation | Boost, auto-join or preference writes execute without clear consent or are replayed. | Low/Medium | Critical | **High** | Explicit user action, target confirmation, idempotency/replay protection, no background retry, writes deferred unless documented/reversible. | Security + product + API | Medium for existing boost action; low for deferred features. |
| R-025 | Operational | Startup pollers stampede Kraken after app restart. | High | Medium | **High** | S51c deterministic startup jitter, shared account clients/budget, single-flight. | SRE + architecture | Low. |
| R-026 | Cache | Stale or rejected promise is retained and freezes data. | Medium | High | **High** | PAT-001 TTL+timestamp+single-flight+clear-on-reject; cache audit/tests; bounded registry. | Code quality + QA | Low. |
| R-027 | Cache / privacy | Raw account numbers used as in-memory cache keys are accidentally emitted in diagnostics. | Low/Medium | High | **Medium/High** | Treat keys as secret-adjacent, never stringify maps, central diagnostics DTOs, opaque correlation. | Security + architecture | Low. |
| R-028 | CI / manifest | `.homeycompose` and generated `app.json` drift or accidental version/ID change breaks release/users. | Medium | High | **High** | Manifest parity and release-security tests; publish validation; one sprint per PR; no S52 version bump. | Release engineering + QA | Low. |
| R-029 | Platform scope | Adopting `target_power`, Matter or Thread without a real actuator/hardware model creates unsafe or irrelevant features. | Low/Medium | High | **Medium/High** | Defer; use only with a concrete controlled-device driver and compatibility review. | Product + architecture | Low. |
| R-030 | External product | Tariffs/programmes such as Greener Nights or Flux eligibility change/end. | High | Medium | **High** | Live eligibility and published dated rows; announcement watch; no hard-coded schedules or time-limited programme dependency. | Product research + API | Medium. |
| R-031 | Licensing | Source/query/fixture reuse from GPL prior art creates attribution/licence obligations. | Low | High | **Medium** | Continue independent implementation from public contracts; record provenance; legal review before deliberate reuse (`docs/research/kraken-contracts.md`). | Architecture + legal | Low. |
| R-032 | Support | Diagnostics lack enough evidence to distinguish client, permission, active-filter and upstream failures. | Medium | High | **High** | Keep identifier-free census/counters, operation/error classes, freshness and build version; never add raw payloads. | Support + API + security | Low/Medium. |

## Highest-priority treatment plan

### Immediate / Phase 1

1. R-001 Kraken budget and R-025 startup stampede — finish S51.
2. R-009 sibling credentials and R-010 identifier keys — repair/privacy hardening.
3. R-011 publisher token — environment, scope and rotation controls.
4. R-007 open IOG field verification — operational confirmation only.

### Phase 2

1. R-002/R-003 god-object and refactor regression.
2. R-004 overlapping refresh writers.
3. R-013/R-014 request duplication and consumption sizing.

### Before feature release

1. R-006 dispatch settlement semantics.
2. R-015 tariff comparison claims.
3. R-022 webview injection.
4. R-023 automation storms.
5. R-024 mutation consent/replay.

## Risk acceptance statements

- **Accepted:** two Homey validator warnings for import-only and export-only
  cumulative directions; adding fake zero capabilities would create worse data.
- **Accepted with monitoring:** conservative F0 may make live/best-effort data stale
  under pressure; this is preferable to account-wide throttling.
- **Not accepted:** guessed prices, raw identifiers in diagnostics, undocumented
  writes, auto-switching or estimated live gas presented as truth.
- **Externally gated:** the v1.0.20 IOG field-verification risk remains open until
  the affected account confirms behaviour; this document does not alter it.

## Review cadence

- Review R-001/R-005 monthly and after any GraphQL feature.
- Review R-011/R-012 on every release-pipeline dependency change.
- Review R-015/R-030 before tariff/programme launches.
- Review the full register at each S51-S58 sprint gate and after a production
  incident or Homey/Octopus API announcement.

⚠ **Cross-discipline note:** risk reduction sometimes delays visible features.
The recommended compromise is a short, behaviour-neutral S52 after S51, followed
immediately by user-visible S53/S54 work; do not turn architecture remediation into
an open-ended rewrite.
