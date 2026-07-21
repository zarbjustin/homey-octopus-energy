# 14 — Engineering Backlog

> Consolidated, de-duplicated backlog synthesised by the orchestrator from every workstream
> (02–13, 16–19) and the existing `ROADMAP.md` / `sprints-50-58-spec.md`. Each item cites its source
> deliverable(s). Priority uses the blueprint scheme (P0 blocker/security/data-loss · P1 high user or
> maintainer risk · P2 important quality/UX/perf · P3 polish). Complexity S/M/L/XL. Milestones map to the
> phases in [16-implementation-plan.md](16-implementation-plan.md). The open **IOG v1.0.20 field-verification**
> item (R-007) is tracked in `HANDOVER.md`, not re-listed as work here.

## Epics
- **A — Stability & Kraken-budget hardening** (completes S51)
- **B — Architecture decomposition** (S52 — the `OctopusMeterDevice` god-object)
- **C — Security & privacy hardening**
- **D — Provenance, correctness & accessibility** (S53)
- **E — Settled-consumption insights & budget automation** (S54)
- **F — Tariff comparison 2.0** (S55)
- **G — Events & Power-ups automation** (S56)
- **H — Dispatch intelligence & preferences** (S57)
- **I — Carbon/cost optimiser & export/Flux** (S58)
- **J — Product surface: widgets, Flow, i18n, docs**

## Master backlog

| ID | Epic | Feature | Complexity | Priority | Deps | Milestone | Source |
|---|---|---|---|---|---|---|---|
| BL-01 | A | Reserved-core Kraken admission + fairness counters + 1-hour system budget test | M | P1 | — | Phase 1 | 07§budget, 17 R-001, 08 BB-04, sprints-50-58 S51b |
| BL-02 | A | Deterministic startup jitter to stop the boot poller stampede | S | P1 | — | Phase 1 | 07 cadences, 08 BB-03, 17 R-001, S51c |
| BL-03 | A | Short-TTL REST coalescer (method+path+window) for overlapping consumption/rates/standing | M | P1 | — | Phase 1 | 07 dup-calls, 17 R-013, S51e |
| BL-04 | A | Account-level Octoplus points cache (replace per-device cooldown) | S | P2 | BL-03 | Phase 1 | 07, S51f |
| BL-05 | A | Region-level carbon cache with source freshness | S | P2 | BL-03 | Phase 1 | 07, 08 BB-10 |
| BL-06 | B | Characterization/golden tests capturing current refresh order, cumulative writes, Flow edges | M | P1 | — | Phase 2 | 04§migration, 17 R-003 |
| BL-07 | B | Extract leaf services from `OctopusMeterDevice` (pricing, consumption, billing, scheduling) behind typed ports | XL | P1 | BL-06 | Phase 2 | 04 god-object, 03, 18, S52 |
| BL-08 | B | Single cumulative-meter writer + refresh **generation/AbortSignal** guard (kill stale-write race) | M | P1 | BL-06 | Phase 2 | 08 BB-07, 17 R-004 |
| BL-09 | B | Central utilities: `tz` formatting, `maskAccount`, redaction/sanitizer, typed `OctopusApp` | S | P2 | — | Phase 2 | 03 duplication, 18, 06 |
| BL-10 | C | Opaque salted keys for persisted diagnostics/state (+ migration, identifier-free aggregates) | M | P1 | BL-09 | Phase 1–2 | 08 BB-02, 06 S-MED-03, 17 R-010 |
| BL-11 | C | Account-wide transactional credential propagation on repair (no stale sibling creds) | M | P1 | — | Phase 1 | 08 BB-01, 06, 17 R-009, S51g |
| BL-12 | C | `encodeURIComponent` on `productCode`/`tariffCode` in 5 REST methods (L1) | S | P2 | — | Phase 1 | 06 L1 |
| BL-13 | C | Redaction parity for account number in `DispatchPoller.redact` (L2) | S | P3 | BL-09 | Phase 2 | 06 L2 |
| BL-14 | C | Publish behind a protected GitHub Environment + required reviewer; PAT rotation runbook | S | P2 | — | Phase 1 | 06 reconciled, 17 R-011 |
| BL-15 | D | Per-source freshness readings + stale-aware Flow tokens & widget badges | M | P1 | BL-07 | Phase 3 | 09, 08 BB-06, 17 R-017, S53 |
| BL-16 | D | Accessibility pass on widgets & settings (labels, contrast, focus, screen-reader) | M | P2 | — | Phase 3 | 02, 13, S53 |
| BL-17 | D | Resolve `octopus_usage_today` = rolling-48 vs true local-day (label first, migrate with notes) | M | P2 | BL-07 | Phase 3 | 08 BB-08 |
| BL-18 | E | Settled-consumption insights via REST `group_by`; budget/threshold Flow automation | L | P1 | BL-03,BL-07 | Phase 3 | 05§metadata, 07, 17 R-014, S54 |
| BL-19 | F | Tariff comparison 2.0: cached catalogue, eligibility, confidence, "estimate/not-evaluated", no "best" | L | P1 | BL-07 | Phase 3–4 | 08 BB-09, 17 R-015, S55 |
| BL-20 | G | Saving-Session "starting soon" de-duplication (track `startingSoon` IDs) | S | P2 | — | Phase 3 | 08 BB-05, S56 |
| BL-21 | G | Power-ups / Free Electricity automation cards + reminders | M | P2 | BL-15 | Phase 3–4 | 11, 12, S56 |
| BL-22 | H | Target-rate as a **stateless service** recomputed on `rates_published`; expose trigger + condition | M | P1 | BL-07,BL-15 | Phase 4 | 11, 10, ⚠disagreement #2 |
| BL-23 | H | Dispatch **read** surface deepening (planned/next-slot tokens, EV allowance window) | M | P2 | BL-15 | Phase 4 | 05, 09, 12 |
| BL-24 | H | Dispatch **control** (BOOST/schedule) — read-only-first, reference-client-verified, consent-gated | L | P2 | BL-23 | Phase 4–5 | 12, 05, 17 R-005/R-006, ⚠disagreement #1 |
| BL-25 | I | Carbon/cost optimiser for charge planning; export/Flux peak-earning optimiser | L | P2 | BL-18 | Phase 4–5 | 07, 19, S58 |
| BL-26 | J | New widgets (drill-down/interactive) — REST-derived by default | M–L | P2 | BL-15 | Phase 3–4 | 10 |
| BL-27 | J | New/expanded Flow cards (dispatch-aware, budget, export-peak, carbon-optimised) — REST-default | M | P2 | BL-15,BL-22 | Phase 3–4 | 11, ⚠disagreement #3 |
| BL-28 | J | Internationalisation beyond `en` (extract strings, add locales) | M | P3 | — | Phase 5 | 02, 13 |
| BL-29 | J | Docs: fix README release line (1.0.18→current); lint `test/`/JS; SBOM/provenance note | S | P3 | — | Phase 1 | 08 BB-13/BB-14, 03, 06 |
| BL-30 | H | API-client hardening: JWT `exp` parsing, contract test vs a documented authed endpoint, re-introspection ritual | S | P2 | — | Phase 2 | 05, 06 S-LOW-01, 17 R-005 |

## Detailed cards for the near-term (P1 / Phase 1–2)

### BL-07 — Decompose `OctopusMeterDevice` (Epic B, XL, P1)
- **Description:** Extract pricing, consumption/cost, billing, and scheduling into pure `lib/*` services behind typed ports; leave a thin device façade. Target sequence per S52a–e; extract **leaf** services first.
- **Business value:** Unblocks S53–S58 safely; reduces change-amplification and regression risk on the 2,392-LOC class.
- **Technical value:** Testable seams, lower complexity, enables per-source provenance (BL-15) and settled insights (BL-18).
- **Dependencies:** BL-06 (characterization tests must exist first).
- **Acceptance criteria:** No user-visible behaviour, capability-ID, or Flow-edge change; all 366 tests still pass plus new service unit tests; `OctopusMeterDevice` reduced to a façade delegating to services; one cumulative-meter writer.
- **Testing:** Golden/characterization tests before movement; per-service unit tests; Test-channel smoke on a real Homey.
- **Docs:** Update `docs/handover/sprints-50-58-spec.md` S52 status; architecture note in `04`.
- **Risk:** R-002/R-003 (High until complete) — mitigate with leaf-first, staged extraction.

### BL-10 — Opaque diagnostic/state keys (Epic C, M, P1)
- **Description:** Replace account-number/device-derived keys in persisted diagnostics & saving-session state with salted opaque IDs; migrate old keys; keep aggregates identifier-free.
- **Value:** Closes the top privacy finding (S-MED-03/R-010, BB-02); protects users if a backup/settings export leaks.
- **AC:** No account/MPAN/serial in any persisted settings key or diagnostic payload; migration preserves history; redaction tests use real-format synthetic IDs.
- **Testing:** Real-format synthetic-ID redaction tests; migration round-trip test.
- **Risk:** Low/Medium after migration; verify no Flow/Insights key breakage (R-019).

### BL-01/BL-02/BL-03 — Budget hardening trio (Epic A, P1)
- **Value:** Directly protects the shared ~90 req/hr Kraken budget (R-001) — the single highest-exposure operational risk — and reduces boot-time throttling that can blank live widgets.
- **AC:** Reserved-core admission never starves auth/dispatch; startup calls jittered; a 1-hour simulated multi-device system test stays ≤ budget; overlapping REST reads coalesce within a refresh cycle.
- **Testing:** `test/kraken-budget.test.js` extension + a system-level budget test; coalescer unit test keyed by method+path+window.

### BL-11 — Account-wide credential propagation (Epic C, M, P1)
- **AC:** Repairing one meter re-keys all siblings on the same account atomically; no stale client remains; original meter identity preserved (`getData().id` unchanged).
- **Testing:** Multi-device repair regression test asserting siblings re-key and old clients are invalidated.

## Cross-discipline disagreements folded into the backlog
1. **Dispatch control (BL-24)** — Product wants write control (headline gap vs HA/Tibber); Architecture flags versionless-mutation risk (R-005/R-006). **Resolution:** ship read-only + reference-client-verified + consent-gated first; control is Phase 4–5, behind explicit opt-in, never inferred as settled price.
2. **Target-rate trigger (BL-22)** — Re-evaluation scheduling could bloat the device/budget. **Resolution:** implement as a stateless service recomputed on `rates_published`, exposing both a trigger and a condition — no new polling.
3. **New live widgets/cards vs budget (BL-26/BL-27)** — **Resolution:** new surfaces default to REST-derived data; any GraphQL-backed live surface must fit the F0 budget and be justified.
