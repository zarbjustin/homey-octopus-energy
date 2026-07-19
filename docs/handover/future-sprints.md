# Future Sprints: Next-Model Handover

Last updated: 19 July 2026

## Objective

This is the starting point for an engineer or AI model taking on Sprints 42-48.
It supplements `HANDOVER.md` and `ROADMAP.md`; it does not replace either file.

Work on one explicitly selected sprint at a time. Confirm its contracts and
acceptance criteria before editing code, keep the change reviewable, and do not
silently pull later-sprint scope forward.

## Current baseline

- Default branch: `main` in `zarbjustin/homey-octopus-energy`.
- Source and GitHub release: `1.0.16`, tag `v1.0.16`.
- Homey Build 16 / `1.0.16` is in Test and is not in certification. Build 13 /
  `1.0.13` remains live pending affected-account verification.
- Builds 14 and 15 were retracted from certification; Build 16 supersedes them.
- `1.0.16` has been installed successfully on the local Homey Pro.
- Sprint 41 was completed through PRs #10-#11 on `main` with 121 tests. Lint,
  dependency audit and publish validation retain exactly the two
  documented cumulative-direction warnings.
- The import current-price incident has a complete IOG household-base recovery
  for legacy and four-rate account contracts. It is released to Test but is not
  field-confirmed or production-released. Do not remove its diagnostics or relax safeguards.

## Required reading order

1. `HANDOVER.md`
2. `ROADMAP.md`, especially Sprints 41-48 and their backlog gates
3. `SECURITY.md`
4. `docs/reviews/import-price-gap-handover.md`
5. The architecture files relevant to the selected sprint
6. Existing tests for the same ownership boundary

Before implementation, inspect current GitHub pull requests and branches. Do not
assume this document is newer than remote `main`.

## Recommended order

1. **Sprint 42: shared Home Mini poller.** Establish one account-scoped live-data
   source with deduplication, freshness, cadence, and backoff.
2. **Sprint 43: dispatch truth model.** Define linked devices and SMART/BOOST
   dispatch semantics before exposing additional automation. Audit the current
   `dispatch_started`, `dispatch_ended`, `dispatch_completed`, and `dispatch_active`
   behavior so planned intent is not surfaced as confirmed charging or settlement.
3. **Sprint 44: dispatch/effective-price Flows.** Build on the Sprint 43 model;
   preserve all existing Flow card and capability IDs. Separate household base,
   EV-specific, estimated effective, and finalised previous-half-hour prices; add
   changed/cancelled and price-finalised events only where the contract supports them.
4. **Sprint 45: billing-period summary.** Keep official REST history authoritative
   and label projections and confidence explicitly.
5. **Sprint 46: live-energy presentation and widgets.** Reuse the Sprint 42 source
   while preserving `measure_power` and Homey Energy behavior. Make source freshness,
   estimated values, household-versus-EV pricing, and planned-versus-finalised outcomes
   visible without overstating certainty.
6. **Sprint 47: planner and tariff analytics.** Preserve negative prices, complete
   plans, contiguous-slot checks, and current-slot eligibility. Keep broader tariff
   comparison and visual analytics out of the Sprint 41 incident fix.
7. **Sprint 48: estimated live-gas pilot.** Keep it opt-in, clearly estimated,
   freshness-aware, and reconciled against official REST data.

Sprint 44 depends on Sprint 43. Sprint 46 should reuse Sprint 42. Sprint 48 stays
last because it is explicitly experimental. Sprint 45 or 47 may be planned while
41-43 are being researched, but shared contracts must not be duplicated.

## Sprint 41 outcome and continuing reuse gate

Sprint 41 produced original research, synthetic fixtures and an independently
implemented fail-closed IOG recovery. Its detailed result and provenance record
are in `docs/research/kraken-contracts.md`.

David Piper's `db-piper/com.kraken.energy` repository may still be reviewed as
prior art, but the roadmap does not require source reuse. Continue from public
Octopus contracts and original implementations. Any deliberate GPL source reuse
would require an explicit scope decision, licence compliance and attribution.

Any GraphQL fixture must be sanitised. Never commit API keys, account numbers,
MPANs/MPRNs, serials, Homey device IDs, authorization headers, exact user payloads,
or raw diagnostics. Experimental GraphQL must fail closed and must not replace
official REST billing data without reconciliation.

## Invariants

- Preserve existing Homey capability, driver, widget, and Flow card IDs.
- Preserve transactional, serial-aware Repair and account-scoped state.
- Preserve negative and time-varying prices; never substitute a representative
  product-summary price for a current dynamic-tariff slot.
- Never present stale data as current or healthy.
- Keep bounded requests, pagination origin checks, retries, caches, and logs.
- Distinguish connectivity/authentication failures from optional integration or
  price-only degradation.
- Keep new controls and capabilities localised and represented in Compose source;
  regenerate generated `app.json` through Homey tooling.
- Do not bump the app version or publish to Homey as part of feature development
  unless the user explicitly requests a release.

## Definition of done

For a selected sprint:

- Acceptance criteria and out-of-scope behavior are written before coding.
- New external response shapes have sanitised fixtures and failure tests.
- Shared behavior has focused regression coverage, including multi-account and
  DST/time-boundary cases where relevant.
- Existing identifiers and documented health semantics remain compatible.
- `npm run lint` passes.
- `npm test` passes.
- `npm audit` reports no known vulnerabilities.
- `git diff --check` passes.
- `npx --no-install homey app validate --level publish` reports no new warnings.
- Changes use a short-lived branch and protected pull request; all required CI
  and CodeQL checks pass before merge.
- `HANDOVER.md` and `ROADMAP.md` are updated to record delivered scope and the
  next safe action.

## Current community follow-up

Community post 14 promised Darren a Test-build link. Build 16 is now available at:

https://homey.app/a/uk.co.zarb.octopusenergy/test/

The follow-up should say that `1.0.16` adds guarded legacy/four-rate IOG household
price recovery on top of the health wording, points backoff, and privacy-safe
diagnostics. It must not claim
the underlying missing-rate cause is proven fixed. If the price remains blank,
ask for a fresh diagnostic while blank, the approximate time, exact import tariff,
and single-rate versus Economy 7 status. Ask the user to keep the existing device.

## Non-blocking maintenance warning

GitHub Actions currently warns that pinned checkout/setup-node actions target the
deprecated Node 20 action runtime and are being forced to Node 24. Build 16 and
the protected checks passed. Handle action updates in a separate maintenance PR,
retain immutable SHA pins, and rerun the release-policy tests.

## Copyable prompt

```text
You are taking over future sprint work for the public repository
zarbjustin/homey-octopus-energy. Start from the latest origin/main and do not use
an older local checkout.

Read HANDOVER.md, ROADMAP.md, SECURITY.md, and
docs/handover/future-sprints.md in full. Read the import-price incident handover
before changing tariff, rate, health, or diagnostics behavior. Inspect current
GitHub PRs and branches, then verify claims against source and tests.

Work only on the sprint I select. First state its acceptance criteria,
dependencies, risks, and out-of-scope items. Then implement it end to end unless
I explicitly request analysis only. Follow existing architecture and preserve all
Homey capability, driver, widget, and Flow IDs. Keep account data isolated,
diagnostics privacy-safe, and official REST data authoritative for billing.

Use public Octopus contracts and original implementations. The roadmap does not
require source reuse from db-piper/com.kraken.energy; any deliberate reuse must
be separately scoped for GPL compliance and attribution.

Add focused tests proportional to risk. Run lint, the full test suite, npm audit,
git diff --check, and Homey publish validation. Treat the two documented
cumulative import/export warnings as expected and investigate every additional
warning. Use a short-lived branch and protected PR, wait for CI and CodeQL, merge
only when green, remove the branch, and update the handover and roadmap.

Do not bump versions, publish a Homey build, retract a submission, post to the
community, or expose user diagnostics unless I explicitly ask.
```
