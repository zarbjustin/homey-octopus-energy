# Research Brief — Sprints 42–48 (Kraken live data, dispatch, IOG pricing, billing)

Last verified: 19 July 2026 · Companion to `docs/handover/sprints-42-48-spec.md`.

This brief records the external evidence behind the Sprints 42–48 specification so
future work can reference it without re-deriving it. **Primary** = Octopus official
docs/live schema. **Secondary** = community/third-party (directional; verify against
primary before relying on it). The Kraken GraphQL API is **versionless** — always
re-confirm field shapes via live introspection at build time.

---

## 1. Kraken API rate limits (the backbone constraint)

**Finding:** The Kraken GraphQL API is limited to roughly **100–125 requests per
hour per account**, and that budget is **shared across every application** touching
the account (Octopus's own app, Home Assistant, other integrations, and this app).
Safe live-telemetry polling is ~30–60 s; polling every 10 s will be throttled.

**Why it matters:** the app must treat the hourly budget as a single shared
resource across *all* Kraken calls (telemetry, dispatch, points, saving sessions,
balance, tariff recovery), leave headroom for Octopus's own app, and back off hard
on HTTP 429. This is the basis for **Foundation F0** in the spec.

**Current-code risk:** live power polls every **30 s per electricity device**
(`drivers/electricity/device.ts` `enableLivePower`, `30_000` ms) with no shared
budget — ~120 requests/hr/device before any other call. Sprint 42 fixes this.

Sources (secondary — no official published limit):
- openHAB community, real-time Home Mini data: https://community.openhab.org/t/oh4-octopus-energy-uk-real-time-electricity-consumption-data-with-home-mini/160187
- Home Assistant Octopus (BottlecapDave) — import/export vs Mini + limits: https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy/discussions/523
- Home Assistant Octopus docs (account/rate-limit guidance): https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/setup/account/
- Homey community Octopus integration thread (rate-limit discussion): https://community.homey.app/t/app-dev-pro-octopus-energy-integration/136685/213

---

## 2. Home Mini live telemetry (`smartMeterTelemetry`)

**Finding:** The Home Mini uploads to Octopus roughly **every 10 s**; a practical
API pull cadence is **30–60 s**. `smartMeterTelemetry(deviceId, start, end,
grouping)` returns a list with `readAt`, `demand`, `consumption`, `export`, and
delta fields. Demand is watts and may be negative during export. Select the newest
valid `readAt` (not array order); null/malformed → treat as unavailable.

**Design consequence:** Sprint 42 owns cadence, dedup, freshness timestamps,
subscription-based activation (poll only while a device/widget needs it), and
backoff. Live power should be opt-in (it spends the shared allowance).

Sources:
- Primary — live schema introspection: https://api.octopus.energy/v1/graphql/
- Primary — Octopus GraphQL guide: https://developer.octopus.energy/guides/graphql/
- Secondary — real-time consumption walkthrough: https://alquistconsulting.blogspot.com/2026/05/get-real-time-electricity-consumption.html

---

## 3. Intelligent Octopus Go dispatch model

**Finding (from Sprint 41 introspection, `docs/research/kraken-contracts.md`):**
- `flexPlannedDispatches(deviceId)` is **device-scoped** (per linked smart device).
- `completedDispatches(accountNumber)` is account-scoped with optional `delta` and
  metadata. Presence does **not** establish the billed rate.
- `devices(accountNumber, ...)` returns `SmartFlexDeviceInterface` implementations
  (batteries, inverters, heat pumps, vehicles, charge points).
- Dispatch metadata can distinguish **SMART** vs **BOOST**; a BOOST window must not
  be assumed to receive a SMART discount.

**Current-code gap:** the app uses account-scoped `plannedDispatches { start end }`
(`lib/KrakenClient.ts`) and models only active/ended — no device, type, delta, or
overlap awareness. Sprint 43 introduces the typed, device-aware truth model.

**Caution:** the generic web description of `deltaKwh`/`meta`/`source` field names
is **not authoritative** — confirm exact fields via introspection before coding.

Sources:
- Primary — GraphQL query reference: https://developer.octopus.energy/graphql/reference/queries/
- Primary — object reference: https://developer.octopus.energy/graphql/reference/objects/
- Primary — union reference: https://developer.octopus.energy/graphql/reference/unions/

---

## 4. IOG billing semantics (why "effective price now" is ambiguous)

**Finding:** On Intelligent Octopus Go, **all** household electricity during the
guaranteed off-peak window (typically **23:30–05:30**) is billed at the off-peak
rate. Outside that window, consumption is at the higher day/peak rate — **except**
that intelligent "bonus" smart-dispatch slots and BOOST are handled differently
(often EV-load specific), measured over a **midday-to-midday** allowance, with a
**6-hour smart-charging cap and Charge Cap** introduced March 2026. Off-peak rates
in 2026 are ~5.5–8 p/kWh (region/promo dependent); peak ~26–34 p/kWh.

**Design consequence:** a single "effective rate now" cannot be stated with
certainty in real time (it depends on window vs bonus vs BOOST, allowance
exhaustion, and EV-vs-household load). The spec therefore keeps the **household
base rate authoritative** and treats any effective rate as **opt-in, estimated,
and confidence-tagged** (Sprint 44, scoped down). Never present planned dispatch or
an estimated effective rate as settled.

Sources:
- Primary — smart tariff terms: https://octopus.energy/policies/smart-tariffs-terms-and-condition/
- Primary — IOG four-rate & Charge Cap explainer: https://octopus.energy/blog/intelligent-octopus-go-smarter-charging-for-a-greener-grid/
- Secondary — March 2026 changes (6-hour cap / Charge Cap): https://evtariffcomparison.co.uk/intelligent-octopus-go-changes/
- Secondary — 2026 rates overview: https://www.bestchargers.co.uk/ev-tariffs/intelligent-octopus-go/

---

## 5. Tariff union shapes

**Finding:** an electricity agreement tariff is a GraphQL **union** that can be
`StandardTariff`, `DayNightTariff`, `ThreeRateTariff`, `FourRateEvTariff`,
`HalfHourlyTariff`, or `PrepayTariff`. `DayNightTariff` and `FourRateEvTariff`
expose VAT-inclusive and pre-VAT rates; `FourRateEvTariff` adds separate EV-device
peak/off-peak rates. Unknown/new union members must **fail closed**.

Detailed accepted contracts and validation rules live in
`docs/research/kraken-contracts.md` (Sprint 41 output).

Source: Primary — union reference: https://developer.octopus.energy/graphql/reference/unions/

---

## 6. Data authority (REST vs GraphQL)

REST remains authoritative for meter identity, agreements, historical
consumption/billing, and published rate history. GraphQL is enrichment/live-only
(Home Mini demand, dispatch intent) and must never replace valid REST billing or
rate data. Full authority table: `docs/research/kraken-contracts.md`.

Sources:
- Primary — REST endpoint guide: https://developer.octopus.energy/rest/guides/endpoints
- Primary — REST base: https://api.octopus.energy/v1/

---

## 7. Prior art & licensing

`db-piper/com.kraken.energy` (GitHub, **GPL-3.0**) was reviewed as prior art at
commit `1042af3e0f3a40209a417ab9a0ba255e89da0c4c`. It surfaced concepts worth
independently validating (device-scoped dispatches, SMART vs BOOST, linked-device
status, tariff-vs-effective price, previous-slot settlement timing). **No source,
queries, fixtures, names, or algorithms were copied.** This project continues from
public Octopus contracts and original implementations. Any deliberate reuse would
require a separate GPL-3.0 compliance and attribution decision.

Repository: https://github.com/db-piper/com.kraken.energy

---

## 8. Verification checklist for implementers

Before building each sprint that touches GraphQL:
1. Re-introspect https://api.octopus.energy/v1/graphql/ and confirm exact field
   names/nullability (the API is versionless and permission/account dependent).
2. Add sanitised, identifier-free fixtures (`test/fixtures/kraken/`) for every new
   shape and its failure modes; never commit real account data.
3. Confirm the shared request budget (F0) accounts for the new calls.
4. Treat secondary sources above as directional only; cite primary in code comments.
