# 05 — API Review

**Review date:** 21 July 2026  
**APIs:** Octopus public REST and Kraken GraphQL

## Executive assessment

The app uses the right authority split: REST for meter identity, published tariffs,
consumption and billing; GraphQL for account/enrichment, live demand, dispatches and
Octoplus. Transport hardening is above average. The largest API risks are the
versionless/permission-dependent GraphQL schema, incomplete operational visibility
into point quotas, duplicated REST reads, and the temptation to use dispatch intent
as billing evidence.

## Octopus REST

### Endpoints used

| Purpose | Client method | Endpoint/evidence |
|---|---|---|
| Product catalogue | `listProducts` | `/products/` (`lib/OctopusClient.ts:277-286`) |
| Product detail / regional code | `getProduct`, `tariffCodeForProduct` | `/products/{code}/` (`lib/OctopusClient.ts:304-327`) |
| Account, properties, agreements, meters | `getAccount`, `discoverMeters` | `/accounts/{account}/` (`lib/OctopusClient.ts:329-370`) |
| Standard electricity/gas rates | `standardUnitRates` | `/products/{product}/{fuel}-tariffs/{tariff}/standard-unit-rates/` (`lib/OctopusClient.ts:393-404`) |
| Latest fallback rate rows | `latestStandardUnitRates` | same endpoint, bounded first page (`lib/OctopusClient.ts:406-418`) |
| Economy 7 day/night | `registerUnitRates` | `day-unit-rates` / `night-unit-rates` (`lib/OctopusClient.ts:420-443`) |
| Standing charge history | `standingCharges` | `/standing-charges/` (`lib/OctopusClient.ts:446-457`) |
| Import/export electricity consumption | `consumption` | `/electricity-meter-points/{mpan}/meters/{serial}/consumption/` (`lib/OctopusClient.ts:461-482`) |
| Gas consumption | `consumption` | `/gas-meter-points/{mprn}/meters/{serial}/consumption/` (`lib/OctopusClient.ts:461-482`) |

The official endpoint guide confirms that price feeds should include explicit
ISO-8601 UTC bounds, paginate after 100 rows, cannot use `group_by`, and differ
from consumption overlap semantics
([REST endpoints](https://docs.octopus.energy/rest/guides/endpoints/)).

### Authentication and transport

The client uses HTTP Basic with API key as username and blank password
(`lib/OctopusClient.ts:107-110`, `lib/OctopusClient.ts:162-165`). This matches the
long-standing domestic customer API contract used by this app. Current generic
Octopus REST documentation now points authenticated consumers toward a Kraken token,
so this should be treated as a compatibility contract that requires periodic live
verification rather than assumed permanence
([REST basics](https://docs.octopus.energy/rest/guides/api-basics/)).

Security controls are strong:

- HTTPS is mandatory for production endpoints
  (`lib/OctopusClient.ts:125-136`);
- embedded URL credentials are rejected (`lib/OctopusClient.ts:133-135`);
- redirects are manual and rejected so Authorization is not forwarded
  (`lib/OctopusClient.ts:147-156`, `lib/OctopusClient.ts:197-199`);
- absolute pagination URLs must remain on the configured origin
  (`lib/OctopusClient.ts:167-181`, `lib/OctopusClient.ts:265-270`);
- upstream bodies are not included in user/log errors
  (`lib/OctopusClient.ts:200-228`).

Recommendation: add a contract test against a documented authenticated endpoint in
release qualification, but never send a real API key in CI.

### Rate limits and quota strategy

Octopus does not publish a simple REST request/hour quota in the reviewed docs.
The client correctly reacts to 429, honours bounded `Retry-After`, retries 5xx and
network failures, and adds jitter (`lib/OctopusClient.ts:184-235`). REST traffic is
not governed by F0, which is reasonable because F0 protects the scarcer Kraken
surface. Nevertheless, S51e's short-TTL coalescing should be completed to reduce
monthly/billing/carbon/catalogue duplication.

### Pagination

`getAll` validates response shape, follows `next`, rejects repeated URLs and caps
at 50 pages (`lib/OctopusClient.ts:240-272`). This is robust. The one concern is
very large consumption `page_size: 25000` (`lib/OctopusClient.ts:478-481`):
upstream may cap or reject it, and a large page increases memory and response time.
Prefer time-bounded queries plus documented aggregation for insights.

The consumption method already exposes `group_by`
(`lib/OctopusClient.ts:465-471`), enabling S54 day/week/month aggregation. The
official guide explicitly says `group_by` applies to consumption but not price
feeds ([REST endpoints](https://docs.octopus.energy/rest/guides/endpoints/)).

### Deprecation and field handling

- There is no repository evidence that a currently used REST endpoint is formally
  deprecated.
- Product/tariff schedules are data-driven. This is preferable to hard-coding Go,
  Cosy, Flux or E7 windows (`docs/research/kraken-contracts.md`,
  “Tariff framework coverage”).
- The app should subscribe to the official announcements feed and add a quarterly
  contract review
  ([API announcements](https://docs.octopus.energy/announcements/)).
- `activeTariff` correctly excludes future agreements when selecting “current”
  (`lib/OctopusClient.ts:373-389`).

### Available REST metadata not fully exploited

1. **Product attributes:** direction, green/tracker/prepay/business/restricted,
   availability and brand are available in catalogue results; the app currently
   types only a subset (`lib/OctopusClient.ts:277-286`). S55 should use eligibility
   and restriction metadata before comparing tariffs.
2. **Grouped consumption:** day/week/month aggregation and settlement-through
   presentation are natural S54 inputs.
3. **Payment method/rate provenance:** rate rows can distinguish payment method;
   comparison should avoid silently choosing a non-applicable row.
4. **Import/export pairing:** product direction plus discovered export agreements
   can support S55/S58 paired recommendations.

## Kraken GraphQL

### Endpoints and operations used

The primary endpoint is `https://api.octopus.energy/v1/graphql/`; Octoplus event
queries use `https://api.backend.octopus.energy/v1/graphql/`
(`lib/KrakenClient.ts:21-23`).

| Purpose | Operation | Evidence |
|---|---|---|
| Token | `obtainKrakenToken` | `lib/KrakenClient.ts:238-269` |
| Account balance | `account.balance` | `lib/KrakenClient.ts:270-282` |
| Active electricity agreements / IOG tariff census | `account.electricityAgreements` | `lib/KrakenClient.ts:283-622` |
| Home Mini device discovery | account/property/device hierarchy | `lib/KrakenClient.ts:623-659` |
| Live demand | `smartMeterTelemetry` | `lib/KrakenClient.ts:660-707` |
| Saving Sessions / Power Ups | backend `events`, joined events | `lib/KrakenClient.ts:708-802` |
| Legacy planned dispatches | `plannedDispatches(accountNumber)` | `lib/KrakenClient.ts:803-821` |
| Completed dispatches | `completedDispatches(accountNumber)` | `lib/KrakenClient.ts:822-842`, `lib/KrakenClient.ts:884-912` |
| Smart-flex devices | `devices(accountNumber)` | `lib/KrakenClient.ts:843-857` |
| Device plans | `flexPlannedDispatches(deviceId)` | `lib/KrakenClient.ts:858-883` |
| Boost control | `triggerBoostCharge` mutation | `lib/KrakenClient.ts:913-923` |
| Octoplus points | `loyaltyPointsBalance` | `lib/KrakenClient.ts:924-967` |

The official API states that GraphQL is HTTPS-only, exposes permissions,
complexity and rate limits in its IDE, and returns application errors in a
GraphQL `errors` array even when HTTP is 200
([GraphQL basics](https://docs.octopus.energy/graphql/guides/basics/)).

### Authentication and token handling

`obtainKrakenToken` exchanges the stored API key, then caches the token in memory
with an expiry and single-flight promise (`lib/KrakenClient.ts:118-132`,
`lib/KrakenClient.ts:238-269`). Protected requests send the token in
`Authorization`; on authentication errors the client clears it, obtains one new
token and retries once (`lib/KrakenClient.ts:212-229`).

This is appropriate:

- no GraphQL token is persisted;
- rejected token fetches are not memoised;
- the API key remains the only durable credential;
- auth retry is bounded.

Recommendation: parse JWT expiry if the token is a JWT, instead of relying only on
the fixed local lifetime, while retaining a safety skew. Never decode for claims
that influence authorization.

### Rate limits and quota strategy

Official current GraphQL constraints are:

- complexity limit 200 per request;
- default account-user allowance 50,000 points/hour;
- request-specific static or dynamic field limits;
- 10,000 nodes/request;
- `rateLimitInfo` exposes current limits/balance
  ([GraphQL usage constraints](https://docs.octopus.energy/graphql/guides/basics/)).

The repo's F0 budget enforces a more conservative empirical target of about 90
requests/hour/account (`lib/KrakenBudget.ts:17-18`,
`lib/KrakenBudget.ts:46-48`). Every request is admitted in
`KrakenClient.post`; non-core work soft-skips, core may borrow bounded tokens, and
429 opens an exponential gate (`lib/KrakenClient.ts:145-180`,
`lib/KrakenBudget.ts:89-127`).

Assessment: **operationally sound but request-count-only**. It cannot distinguish a
cheap query from a high-complexity one and does not inspect upstream remaining
points. Keep it as a safety governor, then add:

1. static “cost class” metadata per operation;
2. identifier-free admitted/denied counters by feature;
3. low-cadence `rateLimitInfo` observation if available to domestic tokens;
4. explicit handling of `KT-CT-1199` and point-exhaustion errors in GraphQL
   `errors[].extensions`, not only HTTP 429;
5. the S51 one-hour multi-device simulation.

⚠ **Cross-discipline note:** a code-quality reviewer may argue that the official
50,000-point allowance makes the 90-call bucket obsolete. Architecture disagrees:
field-specific dynamic limits and real-world shared-account throttling justify the
conservative guard until telemetry proves a safer adaptive policy.

### GraphQL pagination

Current used operations mostly return bounded lists rather than Relay connections.
For future connection fields, official rules require pagination and `first < 100`;
use `pageInfo` cursors
([GraphQL basics](https://docs.octopus.energy/graphql/guides/basics/)).
No new query should request broad account graphs without explicit bounds.

### Seven-member `TariffType` handling

Post-v1.0.20, the contract record identifies `TariffType` as an interface with:

1. `StandardTariff`
2. `DayNightTariff`
3. `ThreeRateTariff`
4. `FourRateEvTariff`
5. `HalfHourlyTariff`
6. `PrepayTariff`
7. `GasTariffType`

(`docs/research/kraken-contracts.md`, “Active IOG tariff”; official interface
reference: [GraphQL interfaces](https://docs.octopus.energy/graphql/reference/interfaces/)).

The app resolves all five household electricity members for live code adoption,
but trusts a synthetic two-band schedule only from `DayNightTariff` and
`FourRateEvTariff`. Standard, three-rate and half-hourly shapes update the live
code and defer to authoritative REST; prepay and gas are not treated as household
IOG import. This is the correct fail-closed policy
(`lib/KrakenClient.ts:283-622`, `docs/research/kraken-contracts.md`).

The open field-verification gate remains external: v1.0.20 must be confirmed by
the affected account before the incident is declared resolved (`HANDOVER.md`,
“IOG follow-up”; do not alter that gate).

### Deprecated/new fields and schema drift

- GraphQL fields expose deprecation markers and reasons in the live schema; the
  versionless schema must be re-introspected before each new feature
  ([GraphQL deprecations](https://docs.octopus.energy/graphql/guides/basics/)).
- The app already had contract drift in loyalty points and tariff interface
  members. Synthetic fixtures and fail-closed parsing are mandatory.
- `plannedDispatches(accountNumber)` is retained for compatibility but the typed
  truth model should use `devices` plus `flexPlannedDispatches(deviceId)` and
  account-scoped completed windows. Any new code should avoid expanding the
  legacy account-plan path.
- Disabled or permission-dependent fields should become “unsupported/ineligible,”
  not a device-wide outage.

### Additional GraphQL metadata/opportunities

| Opportunity | Value | Gate |
|---|---|---|
| Smart-flex device status/category | Better EV/battery/heat-pump context | Already queried; never expose raw device ID |
| Target SoC / ready-by preferences | Read-only IOG preference display | S57 live introspection + synthetic fixtures |
| Dispatch type, delta, source/meta | Honest SMART/BOOST automation | Preserve intent/settlement boundary |
| Dispatch control | Boost exists today | Explicit user action; no silent automation |
| Saving/Power Up joined/finalised status | Better event UX | Schema/permission verification |
| `rateLimitInfo` | Adaptive quota diagnostics | Must not consume material budget |
| Greenness/green accomplishments | Account engagement context | Product value review; avoid duplicating carbon API |

The “target rates” and “greenness” maturity gap identified in `_grounding.md`
should not be implemented merely because fields exist. Product semantics and
authority must be documented first.

## Error handling review

### Strong

- REST status-specific errors, redacted messages, timeout and bounded retry
  (`lib/OctopusClient.ts:184-238`).
- GraphQL token retry once, transient retry, no inline 429 retry
  (`lib/KrakenClient.ts:145-233`).
- Unknown/malformed dispatch and tariff data fail closed
  (`lib/dispatch/deviceModel.ts:35-53`,
  `lib/dispatch/reconcile.ts:79-118`).
- Budget skips preserve freshness and are not logged as failures.

### Improve

- Classify GraphQL errors by `extensions.errorCode/errorType`; messages alone are
  brittle.
- Apply bounded response-size/node expectations before normalisation.
- Add operation names, attempt count, priority and error class to diagnostics, but
  no variables or identifiers.
- Consolidate unsupported-field backoff policy across points, sessions, IOG and
  future preference fields.

## Recommendations and roadmap reconciliation

| Recommendation | Existing plan | Decision |
|---|---|---|
| Complete budget fairness, jitter and counters | S51b-d/h | Agree; P0 |
| Coalesce REST reads/catalogue | S51e, S55a | Agree |
| Decompose clients/device orchestration | S52 | Agree; add typed operation error model |
| Per-source freshness | S53 | Agree |
| REST grouped settled insights | S54 | Agree |
| Eligibility-aware tariff estimate | S55 | Agree; include product restrictions/payment method |
| Saving/Power Up automation | S56 | Agree; writes only if documented |
| Read-only IOG preferences | S57 | Agree; re-introspect first |
| Greenness/carbon optimisation | S58 | Agree; recommendation-only |

Do not add live gas, auto-switching, inferred dispatch settlement or hard-coded
tariff timetables. Those existing rejections remain architecturally correct.
