# Kraken GraphQL Contract Research

Last verified: 19 July 2026

## Sprint 41 outcome

Sprint 41 establishes the evidence, ownership and safety boundaries for future
Kraken work. It does not implement the shared poller, device-scoped dispatch
model, new Flows, billing summary, live-energy UI or estimated live gas planned
for Sprints 42-48.

Acceptance criteria:

- Record the current GraphQL shapes used or considered by the app.
- Define which source is authoritative for each user-visible value.
- Define failure and privacy behavior before expanding GraphQL use.
- Add synthetic, identifier-free fixtures and contract tests.
- Record the external-code provenance and reuse boundary.
- Keep ambiguous dispatch intent separate from effective or settled prices.

## Sources and verification

The contract was checked against:

- Octopus GraphQL guide:
  https://developer.octopus.energy/guides/graphql/
- Octopus query reference:
  https://developer.octopus.energy/graphql/reference/queries/
- Octopus object and union references:
  https://developer.octopus.energy/graphql/reference/objects/
  https://developer.octopus.energy/graphql/reference/unions/
- Octopus REST endpoint guide:
  https://developer.octopus.energy/rest/guides/endpoints
- Intelligent Octopus tariff terms:
  https://octopus.energy/policies/smart-tariffs-terms-and-condition/
- Live schema introspection at:
  https://api.octopus.energy/v1/graphql/

Schema introspection on 19 July 2026 confirmed:

- `smartMeterTelemetry(deviceId, start, end, grouping)` returns a list with
  `readAt`, `demand`, `consumption`, `export` and delta fields.
- `devices(accountNumber, ...)` returns implementations of
  `SmartFlexDeviceInterface`, including batteries, inverters, heat pumps,
  vehicles and charge points.
- `flexPlannedDispatches(deviceId)` is device-scoped.
- `completedDispatches(accountNumber)` returns start/end plus optional
  `delta` and metadata. Presence does not itself establish the billed rate.
- An electricity agreement tariff is a union that can include
  `StandardTariff`, `DayNightTariff`, `ThreeRateTariff`,
  `FourRateEvTariff`, `HalfHourlyTariff` and `PrepayTariff`.
- `DayNightTariff` exposes VAT-inclusive and pre-VAT day/night rates plus
  tariff identity.

The API is versionless and fields may be permission- or account-dependent.
Fixtures therefore define the shapes this app accepts, not a promise that every
Octopus account exposes every field.

## Data authority

| Information | Primary authority | GraphQL role | App behavior |
| --- | --- | --- | --- |
| Meter identity and agreements | Authenticated REST account endpoint | Discovery/enrichment only | REST remains authoritative for pairing and repair. |
| Historical import/export consumption | REST consumption endpoints | Telemetry is not a replacement | Billing and cumulative energy continue to use REST. |
| Published tariff rate history | REST product tariff endpoints | Narrow current-rate recovery only | Never replace valid REST rows with GraphQL. |
| IOG quoted day/night rate | REST when rows exist | Matching active `DayNightTariff` fallback | Exact tariff-code match; unsupported unions fail closed. |
| Home Mini demand | GraphQL telemetry | Operational live value | Latest timestamp wins; null/stale remains unavailable. |
| Planned dispatch | GraphQL | Intent, mutable | Not treated as settlement or proof of a cheap rate. |
| Completed dispatch | GraphQL | Completed control window | Not sufficient alone for historical billing. |
| Effective/settled price | REST rates and eventual billing evidence | Future enrichment | Deferred to Sprints 43-45. |
| Relative price | App-derived | None | Must declare its comparison window and tie rules. |

## Current accepted contracts

### Authentication

`obtainKrakenToken` exchanges the user's REST API key for a short-lived token.
The token remains memory-only, refreshes before its expected expiry, and is
retried once after an authentication error. It must never enter logs, settings,
fixtures or diagnostics.

### Home Mini

The app discovers the smart import meter's device ID through the authenticated
account hierarchy, then requests `smartMeterTelemetry`. Samples are selected by
the newest valid `readAt`, not array order. Demand is an operational live
reading in watts and may be negative during export. Missing, malformed or
non-finite demand yields `null`.

Sprint 42 owns cadence, shared account polling, freshness and backoff.

### Active day/night tariff

The IOG recovery query requests active electricity agreements and the
`DayNightTariff` fragment. A result is accepted only when:

1. the union type is `DayNightTariff`;
2. its full tariff code exactly matches REST discovery, case-insensitively;
3. product/tariff identity is present; and
4. both VAT-inclusive and pre-VAT day/night rates are finite.

The fallback is restricted to electricity import products in the `IOG` family
or Intelligent Go products that are not Intelligent Flux. It produces the
published 23:30-05:30 base window. It does not fabricate historical billing
rates or infer dispatch discounts.

### Dispatch

The existing account-scoped planned/completed methods normalize only start/end.
That is sufficient for legacy start/end notifications but insufficient for an
effective-price model. In particular:

- dispatch windows may change after polling;
- multiple linked devices can overlap;
- device-scoped results can distinguish SMART and BOOST;
- a BOOST window must not be assumed to receive a SMART discount;
- a completed control window is not necessarily a settled bill line;
- DST and Octopus's operational dispatch-day boundary need explicit tests.

Sprint 43 must introduce a typed, device-aware model before Sprint 44 exposes
effective-price automation.

### Relative price

Terms such as cheap, quartile, cheaper-than-next and discount-versus-tariff are
derived semantics, not upstream fields. Each future capability must specify:

- comparison population and time window;
- inclusive/exclusive boundaries;
- handling of negative prices and equal values;
- missing-slot behavior;
- whether the value is tariff, effective or settled price.

Sprint 47 owns broader price-band and planner semantics. Sprint 44 may introduce
only the effective-price comparisons supported by Sprint 43's truth model.

## Failure semantics

| Failure | Classification | Required outcome |
| --- | --- | --- |
| HTTP 429/5xx, timeout or network failure | Transient | Bounded retry/backoff; retain freshness state. |
| Token expiry/authentication error | Authentication | Refresh once; surface persistent auth failure. |
| Unknown/disabled GraphQL field | Unsupported contract | Fail closed; no guessed value. |
| Null optional integration | Unsupported/account-ineligible | Preserve core meter health; bounded retry. |
| Tariff union or code mismatch | Evidence mismatch | Reject the fallback and retain price advisory. |
| Malformed timestamp/rate | Contract failure | Drop the row/value and record redacted diagnostics. |
| Planned dispatch changed or vanished | Mutable intent | Reconcile state; do not preserve as settlement. |
| REST and GraphQL disagree | Authority conflict | Prefer REST for rates/history and diagnose safely. |

## Privacy-safe fixtures

Files under `test/fixtures/kraken/` are synthetic contract samples. They contain
no copied user response and deliberately use identifiers prefixed with
`synthetic-` or tariff codes containing `SYNTHETIC`.

Never commit:

- API keys, JWTs or authorization headers;
- account numbers or property IDs;
- MPANs/MPRNs or meter serials;
- real Kraken/Home Mini/smart-device IDs;
- Homey device UUIDs;
- raw diagnostics or complete upstream bodies.

Tests may assert query structure, normalization and failure behavior. They must
not rely on a developer's live account.

## External-code provenance

David Piper's public `db-piper/com.kraken.energy` repository was reviewed at
commit `1042af3e0f3a40209a417ab9a0ba255e89da0c4c`. GitHub identifies its repository
license as GPL-3.0.

The review identified concepts worth independently validating: device-scoped
dispatches, SMART versus BOOST, linked-device status, tariff versus effective
price, and previous-slot settlement timing. No source code, query text, fixtures,
names or algorithms from that repository were copied or adapted in this sprint.
The app's implementation and fixtures are based on Octopus's public documentation,
live schema introspection and this project's pre-existing architecture.

Explicit personal permission and preferred attribution terms from David are not
recorded in this repository. Until they are:

- future work may use public Octopus contracts and original implementations;
- his repository may be cited as prior art and reviewed for interoperability;
- no code or project-specific fixture may be copied or adapted;
- any later reuse requires a dated record of scope, licence and attribution.

This unresolved permission does not block completion of the original research
contract, but it remains a gate for work directly derived from his implementation.

## Sprint boundaries

Sprint 41 is complete when its contract tests and project validation pass. It
does not prove that the IOG fallback works on the affected account. That requires
a separately authorized Test build and community confirmation before release.

Next:

- Sprint 42: shared Home Mini poller and freshness.
- Sprint 43: device-aware dispatch truth model.
- Sprint 44: effective-price Flows.
- Sprint 45: billing-period authority and confidence.
