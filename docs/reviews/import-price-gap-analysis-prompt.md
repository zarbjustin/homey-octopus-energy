# Independent Analysis Prompt: Import Current-Price Gap

Use the following prompt with each reviewing model. Give every model a clean
checkout of the repository at the same commit, then compare their conclusions
rather than asking later models to endorse an earlier answer.

## Prompt

You are an independent senior TypeScript, API-integration, and Homey SDK reviewer.
Analyze an unresolved import electricity price incident in this repository. Do not
edit code or documentation unless explicitly asked in a later task.

Start by reading:

- `HANDOVER.md`
- `docs/reviews/import-price-gap-handover.md`
- `lib/OctopusMeterDevice.ts`
- `lib/OctopusClient.ts`
- `lib/rates.ts`
- `lib/KrakenClient.ts`
- `test/health.test.js`
- `test/octopus-client.test.js`
- `test/rates.test.js`

Inspect the relevant history rather than trusting the handover's version claims:

```sh
git diff v1.0.9..v1.0.10 -- lib/OctopusMeterDevice.ts
git diff v1.0.10..v1.0.13 -- lib/OctopusMeterDevice.ts lib/OctopusClient.ts lib/KrakenClient.ts
git diff v1.0.13..v1.0.14 -- lib/OctopusMeterDevice.ts lib/OctopusClient.ts lib/KrakenClient.ts
```

Treat every hypothesis in the handover as untrusted. Verify claims from source,
identify counterexamples, and introduce alternative hypotheses where warranted.
Clearly separate facts, inferences, and unknowns.

Do not request, inspect, reproduce, or commit API keys, account numbers,
MPANs/MPRNs, meter serials, Homey device UUIDs, authorization headers, or raw user
diagnostics. Design any additional telemetry to be useful in a public diagnostic
while remaining privacy-safe.

Pay particular attention to:

1. How account agreements, tariff codes, product codes, payment methods, register
   variants, pagination, and validity intervals could produce no current row.
2. Whether `rateAt`, the requested time window, current-time boundaries, time
   zones, DST, invalid dates, overlapping rows, or open-ended rows are mishandled.
3. Why tariff rediscovery can return the same code without resolving the rate gap.
4. Whether any alternate Octopus source is authoritative enough for a flat-tariff
   fallback, and how to prove that a tariff is not dynamic or time-of-use before
   using it. Never recommend a headline/summary rate as the current Agile, Go,
   Flux, Intelligent, Cosy, Tracker, or export slot without evidence.
5. Whether a bounded last-known price is ever acceptable and how the UI, Flows,
   health, timestamp, and stale state must behave. Do not call stale data healthy.
6. Whether `alarm_generic` should represent price-only degradation when carbon,
   balance, consumption, or Home Mini telemetry still works.
7. Whether the independent Octoplus `Unauthorized.` response indicates token
   failure, eligibility, enrolment, field authorization, or a changed contract,
   and what cooldown or capability behavior is appropriate.
8. Regression risk to negative prices, Economy 7, import/export, current-slot Flow
   decisions, serial-aware repair, and account-scoped caching.

Return this structure:

1. **Executive conclusion**: concise assessment and whether evidence supports an
   immediate fix or first requires instrumentation.
2. **Findings**: ordered by severity, each with file/line references, evidence,
   impact, confidence (`high`, `medium`, or `low`), and a falsification test.
3. **Ranked root causes**: probability or relative likelihood, supporting and
   contradicting evidence, and the cheapest privacy-safe discriminator.
4. **Diagnostic gaps**: exact fields/events to add and exact sensitive fields to
   exclude.
5. **Recommended state machine**: primary lookup, fallback eligibility, stale-data
   behavior, tariff rediscovery, health/alarm behavior, and retry/backoff.
6. **Points assessment**: separate diagnosis and recommendation for Octoplus.
7. **Test matrix**: concrete unit/integration fixtures, including validity edges,
   DST, flat and dynamic tariffs, payment/register variants, empty and malformed
   responses, replacement devices, and partial integration success.
8. **Minimal implementation sequence**: small reviewable patches with rollout and
   rollback considerations. Describe the plan; do not write the patch yet.
9. **Disagreements and unknowns**: challenge the handover and list questions that
   cannot be answered from repository evidence.

Avoid generic advice. Prefer source-grounded analysis and explicit invariants. If
you use live public documentation or API observations, cite the source and label
time-sensitive conclusions. Running tests is welcome, but a passing suite is not
evidence that the unrepresented production response shape is handled.
