# 09 — Homey Platform Capability Review

**Review date:** 21 July 2026  
**Platform:** Homey Pro, Apps SDK v3, compatibility `>=12.4.0`

## Executive assessment

The app already uses Homey more deeply than a typical supplier integration:
three device drivers, a large Flow surface, six widgets, cumulative Energy
capabilities, Insights-enabled custom capabilities, repair flows, dynamic live
power capability management and Timeline notifications. The most valuable
underused platform opportunities are per-source freshness in Flow/Insights,
better widget interactivity/accessibility, global Flow tokens, and use of newer
Energy control capabilities only if the app gains an explicitly controlled EV or
battery device model.

Matter/Thread are not relevant to the current cloud-account product.

## Current platform baseline

- SDK v3, Node.js local runtime, Homey Pro only
  (`app.json:3-10`).
- Three sensor drivers with separate import, export and gas identities
  (`app.json:3120-3200`, `app.json:3365-3439`,
  `app.json:3480-3544`).
- Six widgets: Agile, carbon, export, price, summary and timeline
  (`app.json:3624-3760` and following widget definitions).
- Cumulative import and export Energy configuration
  (`app.json:3165-3168`, `app.json:3404-3406`).
- Custom capabilities are Insights-enabled where useful; e.g.
  `.homeycompose/capabilities/measure_octopus_price.json:17-18`,
  `.homeycompose/capabilities/measure_octopus_balance.json:17`,
  `.homeycompose/capabilities/octopus_dispatching.json:10-14`.
- Repair is already shipped on all three drivers
  (`app.json:3196-3200`, `app.json:3435-3439`,
  `app.json:3540-3544`) and implemented transactionally
  (`lib/OctopusMeterDriver.ts:145-179`,
  `lib/OctopusMeterDevice.ts:442-503`).
- Timeline notifications are used for dispatch/event/price conditions
  (`lib/AccountPoller.ts:91-108`,
  `lib/OctopusMeterDevice.ts:1544-1556`).

## Capability map

| Homey capability | Status | Current use | Assessment |
|---|---|---|---|
| SDK v3 async device/app APIs | **Shipped** | App, drivers, devices and managers | Appropriate |
| Standard/custom capabilities | **Shipped** | Price, cost, balance, carbon, dispatch, usage | Broad and valuable |
| Capability options | **Shipped, lightly used** | Titles for meter/alarm/export semantics | Could improve units/decimals/tag/Insights policy |
| Dynamic capabilities | **Shipped** | Add/remove `measure_power` for opt-in live demand (`drivers/electricity/device.ts:238-266`) | Good quota-aware design |
| Homey Energy | **Shipped** | Cumulative import/export meters | Correct; preserve monotonicity |
| Insights | **Shipped** | Capability histories | Under-curated; source freshness absent |
| Flow cards | **Shipped** | 33 triggers / 17 conditions / 13 actions per grounding pack | Mature but needs discoverability/governance |
| Advanced Flow | **Compatible/shipped indirectly** | Existing cards can be used in Advanced Flow | No separate SDK implementation required |
| Widgets | **Shipped** | Six local widgets | Strong base; expand drill-down/interactivity |
| Repair Flow | **Shipped** | Credential re-entry + identity validation | Improve account-wide propagation and UX |
| Timeline notifications | **Shipped** | Opt-in events | Needs quiet hours/dedupe consistency |
| Flow tokens (“Logic-like” variables) | **Partly shipped** | Card tokens/state | Global app tokens underused |
| Maintenance actions | **Not separately used** | Repair covers re-auth | Consider “refresh/test credentials/export diagnostics” actions if platform surface supports them |
| Matter/Thread | **Not used; low fit** | None | Do not add for supplier account app |

## Platform facts relevant to recommendations

- Widgets are standard app web pages with scoped APIs and settings; they require
  Homey `>=12.3.0` and do not work on Homey Cloud
  ([Homey widgets](https://apps.developer.homey.app/the-basics/widgets)).
- Homey Energy derives interval energy from changes in cumulative `meter_power`;
  unexpected decreases can cause invalid interpretations
  ([Homey Energy](https://apps.developer.homey.app/the-basics/devices/energy)).
- `target_power` and optional `target_power_mode` are available from Homey
  `v12.13.0` for managed EV/battery/production control
  ([Homey Energy](https://apps.developer.homey.app/the-basics/devices/energy)).
- Capability options can control title, Insights generation, Flow Tags, units,
  decimals, ranges and enum values
  ([Homey capabilities](https://apps.developer.homey.app/the-basics/devices/capabilities)).
- Repair is the supported user-initiated route when explicit re-authentication is
  required
  ([Homey pairing and repair](https://apps.developer.homey.app/the-basics/devices/pairing)).
- Flow tokens can create reusable tags in the Flow editor
  ([ManagerFlow](https://apps-sdk-v3.developer.homey.app/ManagerFlow.html)).
- Matter apps primarily add pairing/icons for Matter hardware; Homey controls the
  device protocol itself
  ([Homey Matter](https://apps.developer.homey.app/wireless/matter)).

## Opportunity assessment

### 1. Per-source freshness capabilities/tokens

- **Status:** Not yet used consistently; planned S53.
- **Description:** expose price, consumption, balance, carbon, live, dispatch and
  billing freshness independently, rather than one device-wide updated timestamp.
- **User benefit:** prevents stale balance or carbon data appearing “current”
  because price refresh succeeded.
- **Feasibility:** High after S52 service extraction; `Reading<T>` already exists
  (`lib/freshness.ts:17-27`).
- **Complexity:** **M**
- **Dependencies:** S52, F1 conventions.
- **Risk:** more visible stale states may look like a regression.
- **Recommendation:** prefer Flow tokens/conditions and widget badges before adding
  seven permanent capabilities. Add capabilities only where native Insights/Flow
  history creates clear value.

### 2. Insights curation

- **Status:** Shipped but under-curated.
- **Description:** audit which capabilities should generate Insights and tags;
  suppress noisy/derived values where history is misleading; add settlement-through
  context in S54 views.
- **User benefit:** clearer charts and fewer duplicate/noisy series.
- **Feasibility:** High through capability options.
- **Complexity:** **S**
- **Dependencies:** S53 terminology/provenance audit.
- **Risk:** changing `preventInsights` affects existing user charts/tags.
- **Recommendation:** preserve existing IDs and do not remove history without an
  explicit migration note.

### 3. Advanced Flow “recipes,” not new primitives

- **Status:** Platform available; existing cards usable.
- **Description:** publish documented Advanced Flow templates/recipes for EV
  charging, battery import/export, plunge prices, stale-data fallback and budget
  alerts.
- **User benefit:** makes the large card catalogue usable without adding runtime
  complexity.
- **Feasibility:** High; Advanced Flow consumes existing trigger/condition/action
  cards. Homey Flow card definitions already support hints, formatted titles,
  arguments, tokens and state
  ([Homey Flow](https://apps.developer.homey.app/the-basics/flow)).
- **Complexity:** **S/M**
- **Dependencies:** S53 naming, S54 budget, S56 events, S57 plan tokens.
- **Risk:** recipes become stale as card semantics evolve.
- **Recommendation:** version recipe docs and link every recipe to provenance
  expectations.

⚠ **Cross-discipline note:** product may ask for many new Flow cards. Architecture
prefers composition recipes and a smaller set of orthogonal cards; the current
surface is already large.

### 4. Richer interactive widgets

- **Status:** Shipped; opportunity to deepen.
- **Description:** use scoped widget APIs/settings for day switching, source
  freshness, tariff comparison drill-down, event join status, compact/expanded
  layouts and accessible textual summaries.
- **User benefit:** fewer trips to device settings and better dashboard utility.
- **Feasibility:** High; widget APIs, settings, runtime height and app events are
  first-class
  ([Homey widgets](https://apps.developer.homey.app/the-basics/widgets)).
- **Complexity:** **M/L**
- **Dependencies:** S53, S54, S56, S58.
- **Risk:** webview XSS/accessibility/performance; avoid raw upstream text.

### 5. Energy API refinement

- **Status:** Shipped for cumulative import/export.
- **Description:** validate cumulative monotonicity, imported/exported direction,
  restart cursor recovery and dynamic live `measure_power`.
- **User benefit:** trustworthy Homey Energy dashboards.
- **Feasibility:** High; current manifests use the correct cumulative direction
  (`app.json:3165-3168`, `app.json:3404-3406`).
- **Complexity:** **M**
- **Dependencies:** S52 consumption extraction, S54 insights.
- **Risk:** cursor/reset bugs corrupt Homey Energy history.
- **Recommendation:** do not add fake opposite-direction zero capabilities; retain
  the two accepted validator warnings described in `HANDOVER.md`.

### 6. `target_power` / `target_power_mode`

- **Status:** Available platform feature; not used.
- **Description:** model Homey-controlled target power for an EV charger/battery
  only if the app becomes a real controllable-device integration.
- **User benefit:** native energy-management coordination.
- **Feasibility:** Low for current supplier-account devices. The app has tariff
  advice and limited boost mutation, not a safe actuator with measured feedback.
- **Complexity:** **XL**
- **Dependencies:** compatibility increase to `>=12.13.0`, explicit hardware/device
  model, consent, control reconciliation and rollback.
- **Risk:** unsafe or misleading control; conflicting Kraken/device scheduling.
- **Recommendation:** **defer**. Do not attach target-power capabilities to a meter
  account proxy.

### 7. Repair Flow 2.0

- **Status:** Shipped.
- **Description:** retain credential re-entry and identity verification, then add
  account-wide sibling propagation, clearer success/error feedback, and optional
  “test credentials” before commit.
- **User benefit:** API-key rotation without deleting devices or breaking history.
- **Feasibility:** High; Homey explicitly supports `repair` and `onRepair`
  ([Homey pairing and repair](https://apps.developer.homey.app/the-basics/devices/pairing)).
- **Complexity:** **M**
- **Dependencies:** S51g, S52 typed app/account service.
- **Risk:** propagating to the wrong account or meter; preserve transactional
  rollback and original meter identity.

### 8. Maintenance/self-service actions

- **Status:** Not separately used.
- **Description:** if supported cleanly by the current Homey UI/API, offer
  “Refresh now,” “Test Octopus connection,” “Clear non-secret cache,” and “Create
  privacy-safe diagnostic.”
- **User benefit:** self-service support and fewer destructive re-pairs.
- **Feasibility:** Medium. “Refresh now” already exists as a Flow action
  (`lib/OctopusMeterDevice.ts:1408-1411`); exposing duplicate surfaces may add
  confusion.
- **Complexity:** **S/M**
- **Dependencies:** S52 health service, security review.
- **Risk:** repeated refresh can consume quota; diagnostics must remain
  identifier-free.
- **Recommendation:** prioritise Repair UX and settings diagnostics over adding a
  new platform surface unless user research shows demand.

### 9. Global Flow tokens / Logic-variable-like state

- **Status:** Partly used through card tokens; app-global tokens underused.
- **Description:** publish a small set of app tokens such as current import price,
  price provenance, dispatch active, next cheap window and data-health state.
- **User benefit:** easier Advanced Flow comparisons and cross-device automation.
- **Feasibility:** Medium via Flow tokens.
- **Complexity:** **M**
- **Dependencies:** account/device selection semantics, S53.
- **Risk:** ambiguity on multi-account/multi-meter Homeys; avoid one misleading
  global value.
- **Recommendation:** account- or device-scoped card tokens are safer. Add global
  tokens only if a user explicitly selects a primary meter.

### 10. Timeline notifications

- **Status:** Shipped.
- **Description:** consolidate event, plunge, dispatch, balance and future budget
  notifications under quiet hours, lead time, dedupe and provenance wording.
- **User benefit:** timely action without notification fatigue.
- **Feasibility:** High; notifications already use
  `homey.notifications.createNotification`
  (`lib/AccountPoller.ts:97-108`,
  `lib/OctopusMeterDevice.ts:1549-1556`).
- **Complexity:** **M**
- **Dependencies:** S53, S54, S56.
- **Risk:** spam, duplicate poller edges, planned presented as final.

### 11. Capability options and dynamic capability policy

- **Status:** Partly shipped.
- **Description:** standardise units, decimals, titles, tags/Insights and dynamic
  add/remove rules. Preserve IDs.
- **User benefit:** consistent device cards, charts and Flow tags.
- **Feasibility:** High.
- **Complexity:** **S/M**
- **Dependencies:** S52/S53.
- **Risk:** dynamically adding/removing a capability can affect existing Flows and
  Insights. Keep `measure_power` opt-in but avoid dynamic churn elsewhere.

### 12. Matter / Thread

- **Status:** Not used.
- **Description:** hardware protocol integration.
- **User benefit:** none for an Octopus account proxy.
- **Feasibility:** Low relevance.
- **Complexity:** **XL**
- **Dependencies:** new hardware product scope.
- **Risk:** product dilution and maintenance burden.
- **Recommendation:** **do not pursue**. Revisit only if the app adds a specific
  Octopus-branded Matter device; Matter devices generally do not need custom app
  control code
  ([Homey Matter](https://apps.developer.homey.app/wireless/matter)).

## Recommended sequence

1. S51 Repair account-wide propagation.
2. S52 typed service boundaries.
3. S53 per-source freshness, Insights/capability-option audit and accessible
   widgets.
4. S54 settled insights plus budget Flow/notification.
5. S56 event widget and quiet-hours notification governance.
6. S57 plan-token round trip and read-only preferences.
7. S58 recommendation widgets.

This agrees with S50-S58. It diverges from the grounding hypothesis that Repair
Flow is absent: the code and manifest show that Repair is already shipped; the
opportunity is to harden and improve it, not introduce it.
