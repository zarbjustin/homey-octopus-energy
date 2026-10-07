# Agent Instructions

These instructions apply to every file in this repository.

## Instruction Precedence

Project-specific rules in this file and `docs/` override generic imported instructions under
`.github/instructions/` when they conflict. In particular:

- The project requires Node.js 22 even if a generic workflow example uses an older version.
- Release workflows may require full Git history even if a generic workflow suggests shallow checkout.
- Existing immutable action SHA pins must be preserved until a deliberate maintenance update.

## Start Here

Read these files before planning or changing code:

1. [`docs/ai-handover.md`](docs/ai-handover.md) — authoritative current state and takeover steps.
2. [`docs/roadmap-next.md`](docs/roadmap-next.md) — remaining operational work and optional future phases.
3. [`docs/engineering-learnings.md`](docs/engineering-learnings.md) — durable design decisions and gotchas.
4. [`HANDOVER.md`](HANDOVER.md) — detailed release history. Treat older “next” and “open” entries as historical.

## Current Baseline

- App version: `1.0.38`.
- Homey App Store build: `38` Test (verified 5 October 2026); `36` remains Live.
- GitHub release: `v1.0.38`; local Pro installation/readback verified.
- Original formal engineering backlog: complete through `BL-31`; new S73–S76
  reliability S73–S75 is delivered for testing; S76 monitoring ended early on
  5 October, not as a verified 48-hour pass. Field gates remain open.
  Read `docs/handover/sprints-73-76-execution.md` for actual evidence and field gaps.
- Last validated integration baseline: 672 passing tests; field gates remain open.
- 7 October S78 charging-guidance source candidate: 678 tests; hint-only manifest
  changes and Standard Flow recipes. No new Test build or install; broader S78
  and real-UI/requester checks remain open. Read `docs/handover/s78-charging-guidance.md`.
- S81–S83 charging software and app-wide reliability fixes delivered in v1.0.38
  Test: 14 additive cards, 80 existing Flow contracts preserved. BBA-10 reporting
  coverage blocker closed. Read the charging execution record; prior local-only
  notes are historical. No certification/Live or physical acceptance clearance.
- Runtime: Node.js 22, TypeScript, Homey Software Development Kit (SDK) v3.

## Non-Negotiable Product Rules

- Preserve existing capability IDs, Flow card IDs, settings keys, and device identities.
- Official Octopus REST data is authoritative for billing and settled consumption.
- GraphQL and Carbon API data must fail closed. Never fabricate zero or “neutral” values.
- Label planned, forecast, relative, and calculated values as estimates. Never present them as bills or settlement.
- Do not add a new Kraken polling cadence without a measured account-budget analysis.
- Keep household prices separate from Electric Vehicle (EV)-specific prices.
- Keep import and export cumulative capabilities direction-specific. Do not add fake zero-value capabilities to silence Homey warnings.
- Never log or commit API keys, account numbers, meter identifiers, tokens, or unredacted diagnostics.

## Implementation Rules

- Prefer pure modules under `lib/` for calculations. Keep Homey device classes as adapters.
- Reuse existing planners, time-zone helpers, freshness models, redaction helpers, and account caches.
- Price windows must use adjacent half-hour rows and complete horizons.
- New charge plans must not count an in-progress slot as a full future slot.
- Trigger edges must follow rate-slot boundaries, including equal-price plateaus.
- Carbon-aware triggers must evaluate after the matching carbon refresh completes.
- Widgets must read cached device state. Widget interactions must not create outbound polling.
- Escape all dynamic widget content and keep controls keyboard and screen-reader accessible.
- Update Homey Compose source files first. Run `npx homey app build` to regenerate `app.json`.

## Validation Commands

Run the smallest relevant tests while developing. Before a sprint or phase is complete, run:

```bash
npx homey app build
npm test
npm run lint
npm audit --omit=dev
npx homey app validate --level publish
```

Expected publish warnings:

- Electricity has no cumulative exported capability.
- Export has no cumulative imported capability.

Any additional warning is a regression.

## Sprint and Phase Completion Workflow

At the end of every completed sprint or phase:

1. Run all release validation commands.
2. Install on the configured local Homey Pro:

   ```bash
   npx homey app install
   ```

   Do not use `--clean` by default. It returned Homey’s generic `Missing File` error for v1.0.35, while the normal packed install succeeded.
3. Smoke-test affected devices, widgets, and representative Flows.
4. Update `HANDOVER.md`, `docs/ai-handover.md`, `docs/roadmap-next.md`, and relevant learnings.
5. Commit with the required Copilot trailers and push `main`.
6. Dispatch `.github/workflows/homey-app-publish.yml`.
7. Confirm the workflow created the expected Homey build.
8. Confirm the GitHub tag and release exist.
9. Record the run ID, build ID, commits, test count, and manual Test/Live promotion step.

Homey Developer Tools promotion from Draft to Test/Live is manual.

If a release uses a pull request, verify the GitHub tag and release explicitly. A historical
`gh` command-line merge did not emit the expected `push` event for the release workflow.

## Documentation Rules

- Keep [`docs/ai-handover.md`](docs/ai-handover.md) short and current.
- Put historical detail in `HANDOVER.md`; do not use old historical “next” markers as current instructions.
- Update [`docs/roadmap-next.md`](docs/roadmap-next.md) when priorities change.
- Add reusable root causes, constraints, and workflow gotchas to [`docs/engineering-learnings.md`](docs/engineering-learnings.md).
- Use descriptive headings, short sentences, tables for structured facts, and language tags on code blocks.
