# Sprint S60 — Trust & Money (spec)

> Consolidated three-lens plan (Architecture / Product / Engineering). Sequences the
> next executable sprint from the blueprint roadmap (`docs/blueprint/15-prioritised-roadmap.md`,
> `16-implementation-plan.md`, backlog `14-…`). Supersedes the "optional ReportingService/façade"
> line in `HANDOVER.md` with a **narrow, BL-18-scoped** interpretation.

## Goal
Ship the **trust-and-money** value (BL-15 freshness → BL-17 correctness → BL-18 settled insights +
budget Flows) on a **clean reporting seam**, without embedding new subsystems in the 2,400-line
`OctopusMeterDevice`. Do the refactor *in service of the feature* — extract only what BL-18 touches;
defer the full `PlanningFacade`/device-as-façade.

## Resolved trade-off (the one disagreement)
- Product: ship value now, defer refactor. Architecture: full bounded refactor first. Engineering: median.
- **Decision:** extract **`ReportingService`** + make **reporting writes generation-safe** (a real
  correctness fix, not cosmetics) BEFORE BL-18; **defer** `PlanningFacade` and total device-façade.
  Then ship BL-15/17/18 in the same sprint. Value ships this sprint; BL-18 never touches the god-object.

## Scope (in order)
1. **Golden/characterization tests** for current reporting outputs (safety net). — S/M
2. **Extract `ReportingService`** — move `refreshMonthlyCost`, `refreshBillingSummary`,
   `refreshDayBreakdown`, `exportBillingInput`, `persistBillingSummary`. Behaviour-preserving;
   before/after golden outputs match. Typed ports (REST reads, clock/tz, settings, persistence,
   narrow capability publication). Not a dumping ground (price stats, points, tariff-change, health
   stay where they are). — M/L
3. **Generation-safe reporting + `settledThrough` fix** — thread the refresh generation into
   reporting writes so a superseded refresh can't overwrite a newer summary; fix `settledThrough`
   from `max(interval_end)` (lib/OctopusMeterDevice.ts:2156) to the latest **contiguous** settled
   interval from period start. Keep BL-08's serialized cumulative writer as final authority — do NOT
   cancel it. — S/M
4. **Thin device delegation cleanup** (only what ReportingService touches; no ID/behaviour change). — S
5. **BL-15** per-source freshness + stale-aware tokens/badges, incl. settlement provenance. — M
6. **BL-17** `usage_today` local-day vs rolling-24h correction (current usage = last 48 records,
   lib/OctopusMeterDevice.ts ~833). Before any "today" insight. — S/M
7. **BL-18a** typed `group_by: 'day'|'week'|'month'` (client already accepts `group_by`,
   lib/OctopusClient.ts:504) + a `SettledInsightsService` sharing ReportingService's calculators. — M
8. **BL-18b** budget settings + crossing-only Flows + stale/settled-aware widget/tokens. — L

## Deferred to a later sprint

**Deferred to a later sprint:** full `PlanningFacade`, device-as-façade completion, BL-16 (a11y),
BL-20 (saving-session "soon" de-dup), BL-21 (Power-ups). **Queued next:** BL-22 rolling target-rate.

## BL-17 decision (RESOLVED — relabel only; calc intentionally unchanged)

**Decision (22 Jul 2026):** keep the rolling **"last 24h"** calculation for `octopus_usage_today` /
`octopus_cost_today`; do **NOT** migrate to a strict calendar-day (midnight→now) window. The
honesty defect (BB-08 — a rolling window titled "today") is fully resolved by wording only: the
capability titles are already "Usage/Cost (last 24h)" and the Flow-trigger titles were aligned to
"Usage/Cost (24h) rises above …" (commit `98575d2`).

**Evidence / rationale:**
- The Octopus REST **consumption API lags ~24h** (half-hourly data is a day behind unless a Home
  Mini is present), so a true calendar-day figure reads **~0 for most of the day** and only fills in
  late afternoon/evening — a known, recurring "why is today's usage 0?" friction in the Home
  Assistant community.
- The community-reference integration (**BottlecapDave's HA Octopus Energy**) names sensors by their
  actual window — a `current_accumulative_consumption` (today) **and** a
  `previous_accumulative_consumption` (settled yesterday) — it does not relabel a rolling window as
  "today". We already expose settled calendar figures via `octopus_cost_yesterday` + month-to-date.
- Migrating the existing capability would be a **UX regression** (a ~0-then-jump tile) and would
  break the **compatibility contract** (BB-08): existing Flows built on "usage rises above X kWh"
  expect a ~24h total.
- Our always-populated rolling-24h is arguably a **better** at-a-glance tile than HA's sparse "today".

**Future enhancement (Phase 4, additive — NOT a fix):** if a true calendar "today so far" figure is
wanted, ADD a new, clearly-named capability (mirroring HA's current+previous split) rather than
changing the existing one. Tracked as **BL-31** (backlog `14-…`, roadmap `15-…` Phase 4).

**Next release note (drop into `.homeychangelog.json` at the next version bump):** "Renamed the
'Today's usage/cost' Flow triggers to 'Usage/Cost (24h)' so the wording matches what they measure
(a rolling 24-hour total, as the tiles already show)."

## Non-negotiables (BL-18 trust discipline)
- Settled vs estimate **visually + semantically distinct**; projection **always** labelled estimate.
- **"Settled through <date>" mandatory**; latest *contiguous* settled interval (fix `settledThrough`).
- **No "best"/"you saved £X"** claims; fail closed on partial windows.
- **REST-only, zero new GraphQL polling**; telemetry/live/dispatch never enter settled totals.
- `group_by` is **consumption-only** — use it for compact usage history; compute **cost/peak-share
  from bounded raw settled half-hours + historical REST rates**. Never the default `page_size:25000`;
  reuse/coalesce the monthly/billing reads (respect the 90 req/hr Kraken budget).

## Exit gates
- No manifest/capability-ID/Flow-edge/version change from steps 1–4.
- Before/after characterization outputs match; no duplicate cumulative writer; stale reporting cannot
  overwrite a newer summary; settled figures match a known bill window; partial windows fail closed.

## Architecture decisions
- `ReportingService` = bounded historical retrieval + monthly/billing calc + settlement completeness
  + import/export reporting + reporting DTOs, via typed ports.
- BL-18 → separate `SettledInsightsService` sharing ReportingService repositories; budget state +
  crossing decisions independently testable. ReportingService may schedule/publish.
- Generation contract wraps every capability/store/Flow/notification side effect (check generation
  immediately before each). BL-08 cumulative writer untouched.

## Risks
- R1 (highest): BL-18 before BL-15 → stale input poisons a "settled" tile (IOG-class trust incident).
  Mitigation: BL-15 first/concurrent.
- R2: refactor scope-creep into full façade → invisible sprint. Mitigation: hard-bound step 4.
- R3: settled gaps mis-rendered complete. Mitigation: contiguous `settledThrough` + fail-closed.
- R4: duplicate REST load → budget pressure. Mitigation: coalesce/bounded windows.
- R5 (operational, parallel): IOG v1.0.27 field-verification (Darren) still open — must not regress
  IOG pricing before confirmation. Not a code gate.

## Assumptions (validate at kickoff)
- ReportingService extractable behaviour-preserving with golden tests green.
- BL-15 freshness plumbing available to insights/budget tiles (provenance/health already extracted).
- Budget guardrail reuses `lib/billing/project.ts` projection — no new polling.
- No manifest/ID/Flow change in steps 1–4.
