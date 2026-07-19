# Import Current-Price Gap: Independent Review Handover

Last updated: 19 July 2026

## Purpose

This document preserves the evidence and current reasoning for an unresolved
import electricity price incident. It is intended for independent code review,
not as a predetermined implementation plan.

The raw user diagnostic is intentionally not committed. It contains Homey device
identifiers and meter-related details that are unnecessary for analysis. Do not
request or add API keys, account numbers, MPANs/MPRNs, meter serials, device UUIDs,
or unredacted upstream responses to this public repository.

## Public context

- Community report: https://community.homey.app/t/156860/11
- Maintainer follow-up with the diagnostic summary:
  https://community.homey.app/t/156860/12
- Affected submitted build: Homey App Store version `1.0.13`.
- Current source: `1.0.14` on `main`. Its rate lookup and fallback logic are
  materially unchanged for this incident.

## Sanitised observations

The user reports that the electricity meter still declares a connection problem.
The device view shows blank current/next price fields while unrelated values such
as carbon intensity still populate. The user also reports that Home Mini live
readings work when enabled.

The submitted diagnostic shows this UTC sequence:

| Time | Observation |
| --- | --- |
| 00:19 and 09:46 | App processes start and meter drivers initialise normally. |
| 07:50 through 10:17 | Import price refresh fails at roughly 30-minute intervals. |
| 09:46 | A startup refresh reproduces the same failure. |
| 10:18 | A newly added/replacement import device immediately reproduces it. |
| Same cycles | Octoplus points reports `Unauthorized.` |
| Throughout | No equivalent export meter failure appears in the supplied excerpt. |

The repeated price error is:

```text
Octopus returned no rate covering the current time.
```

The stack reaches `refreshPrices`, `refreshPricesWithTariffRecovery`, and
`runRefresh`. The points error reaches `KrakenClient.query`,
`getOctoplusPoints`, and `refreshPoints`.

The timing suggests replacement rather than two simultaneously active import
devices: the old device's final logged failure precedes the new device's
initialisation. The immediate reproduction makes stale device state, cached
credentials, and repair rollback less likely primary causes. It does not prove
that the account or tariff metadata is correct.

## Verified source behaviour

### Price lookup

`lib/OctopusMeterDevice.ts` currently:

1. Requests standard unit rates for a window from 30 hours in the past to 48
   hours in the future.
2. Uses `rateAt` to find a row whose validity contains the current time.
3. If none matches, requests one bounded page of newest rows and tries `rateAt`
   again.
4. Throws the observed error if neither response contains a current row.
5. Rediscovers the meter and retries only when the discovered tariff code changed.

`OctopusClient.activeTariff` prefers an agreement active at the current instant,
then falls back to the agreement with the latest `valid_from`. A date-active
agreement can therefore still lead to an endpoint whose rate rows are missing,
stale, or otherwise do not cover now.

### Health and availability

`refreshHealthDecision` considers a tariff-bearing device fully healthy only when
at least one core integration and the price refresh succeed. A price-only failure
sets `alarm_generic`, but the device remains available when another core refresh
succeeds. Octoplus points is reporting-only and cannot cause this alarm.

The current UI can therefore say "connection problem" even though REST account
data, carbon data, or Home Mini telemetry still works. That is current product
semantics, but it may be too broad a label for a price-specific degradation.

### Version history

In `v1.0.9`, `refreshPrices` silently skipped the capability update when no current
row existed. `v1.0.10` deliberately began throwing, so a stale or blank value was
no longer treated as healthy. A report that `1.0.9` "worked" does not prove that it
had a correct current price; it may have retained an old value or omitted the
failure.

`v1.0.13` added the bounded latest-rate fallback, active-tariff rediscovery, and
partial availability described above. The diagnostic demonstrates a second edge
case that those changes do not resolve.

### Octoplus points

`getOctoplusPoints` uses the current `loyaltyPointsBalance` GraphQL contract. Its
`Unauthorized.` response is independent of the price failure. Since Home Mini
telemetry works, account-wide Kraken authentication is not necessarily broken;
the points response may instead reflect enrolment, account eligibility, field
authorization, or token scope. This needs verification rather than assumption.

## External API observation, not user evidence

On 19 July 2026, a public Octopus API spot-check of a known regional
`VAR-22-11-01` tariff returned an open-ended current standard-unit-rate row. Its
product summary also exposed current-looking single-register fields.

This proves only that the public API can represent a current flat rate. The
affected user's tariff code and returned rate shape are unknown. Product-summary
fields must not be used blindly as a current price for Agile, Go, Flux,
Intelligent, Cosy, Tracker, export, or any other time-varying tariff. Headline or
representative values can be materially different from the current slot.

## Hypotheses to challenge

These are candidates, not conclusions. An independent review should rank them and
identify missing alternatives.

1. The active account agreement identifies a real tariff endpoint whose rate rows
   currently contain a validity gap.
2. The stored tariff selects the wrong payment-method or register variant, such as
   Direct Debit versus non-Direct Debit or single-register versus dual-register.
3. The selected agreement is date-active but its tariff data is stale or ended;
   rediscovery finds the same code, so recovery stops without trying another
   evidence-backed source.
4. Rows are malformed, omitted, duplicated, or interpreted incorrectly around a
   timestamp, offset, or validity boundary.
5. An exact product/tariff summary could provide a safe fallback for proven flat
   tariffs, but only after robustly excluding every dynamic or time-of-use tariff.
6. `alarm_generic` is too broad for price-only degradation and should distinguish
   connectivity/authentication from missing tariff data.
7. Repeated points authorization failures should enter an unsupported/cooldown
   state instead of logging on each hourly attempt.

## Privacy-safe diagnostics needed

A targeted diagnostic should expose shape and decisions, not identity:

- Fuel, import/export role, register count, and payment-method labels.
- Sanitised product family and tariff classification. If a regional suffix is not
  needed, omit it.
- Number of active agreements and whether their date ranges contain now.
- Rate row count; whether a current row was found; oldest/newest validity bounds;
  count of open-ended, invalid, or overlapping rows.
- Which lookup and fallback stages ran and why each was accepted or rejected.
- A coarse server/client clock comparison where available.
- Points outcome classified as success, unsupported/unauthorized, transient, or
  contract failure.

Never log credentials, full account/meter identifiers, serials, Homey UUIDs, raw
GraphQL variables, authorization headers, or complete upstream response bodies.

## Design constraints

- Preserve existing Homey capability and Flow card IDs.
- Preserve negative prices and half-hour validity for dynamic tariffs.
- Do not present a stale price as current or mark it healthy without explicit,
  bounded staleness semantics.
- Do not use a product summary as a dynamic tariff's current slot price.
- Preserve serial-aware transactional repair and account-scoped caches.
- Keep the intentional cumulative import/export Homey validation warnings.
- Add fixtures before changing fallback behaviour; include DST and exact validity
  boundary cases.

## Relevant source and history

- `lib/OctopusMeterDevice.ts`: refresh orchestration, health decision, price
  recovery, price lookup, points refresh, and dynamic-tariff classification.
- `lib/OctopusClient.ts`: meter discovery, active agreements, rate endpoints, and
  product metadata.
- `lib/rates.ts`: `rateAt` and tariff-to-product parsing.
- `lib/KrakenClient.ts`: token refresh, GraphQL errors, and points lookup.
- `test/health.test.js`, `test/octopus-client.test.js`, `test/rates.test.js`.
- Compare tags `v1.0.9`, `v1.0.10`, `v1.0.13`, and `v1.0.14`.

## Required review output

An independent review should provide findings with source references, ranked
root-cause hypotheses with confidence and falsification tests, the minimum safe
diagnostic additions, a fallback/health state machine, a test matrix, rollout
risks, and any disagreement with this handover. It should separate verified facts
from inference and should not implement a fix until evidence distinguishes the
leading causes.
