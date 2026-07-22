# S64 — BL-24a: Dispatch-control verification spike (read-first)

**Status:** read-only surface shipped; **no write mutation wired**. This spike verifies the
Intelligent Octopus Go (IOG) boost/bump-charge control contract against the live Kraken schema so
that BL-24b (S65) can implement a *consent-gated, reference-verified* write safely.

## 1. Verified Kraken contract (live schema introspection)

Source: `POST https://api.octopus.energy/v1/graphql/` introspection, 2026-07-22.

### Boost control — write mutation (for S65, NOT yet wired)

```graphql
mutation UpdateBoostCharge($deviceId: String!, $action: UpdateBoostChargeAction!) {
  updateBoostCharge(input: { deviceId: $deviceId, action: $action }) {
    id
    status { current isSuspended currentState }
  }
}
```

- **Input** `UpdateBoostChargeInput`: `deviceId: String!`, `action: UpdateBoostChargeAction!`
- **`UpdateBoostChargeAction`** enum: `BOOST` (start a bump charge) | `CANCEL` (stop it)
- **Returns** `SmartFlexDeviceInterface` (the device, incl. `status`) — so the write echoes the new
  state and needs no follow-up read.
- **Scope is the DEVICE, not the account.** `deviceId` is the smart-flex device id from
  `devices(accountNumber){ id … }` (already fetched by `getDevices`/`getCachedDevices`).

Related mutations seen (not needed for boost): `triggerTestCharge(AccountNumberInput)`,
`setDevicePreferences(SmartFlexDevicePreferencesInput)`, `updateIsChargingDurationCapped(...)`,
`startSmartFlexOnboarding(...)`, `deauthenticateFlexDevice(...)`.

### Boost state — read (SHIPPED this sprint, no new request)

`devices(accountNumber){ status { currentState } }` (already in `getDevices`).
`currentState` is the `SmartFlexDeviceState` enum:

```
AUTHENTICATION_PENDING/FAILED/COMPLETE, TEST_CHARGE_IN_PROGRESS/FAILED/NOT_AVAILABLE,
SETUP_COMPLETE, SMART_CONTROL_CAPABLE, SMART_CONTROL_IN_PROGRESS, BOOSTING,
SMART_CONTROL_OFF, SMART_CONTROL_NOT_AVAILABLE, LOST_CONNECTION, RETIRED
```

- **`BOOSTING`** = a bump charge is running now.
- `SMART_CONTROL_IN_PROGRESS` = a smart (planned) dispatch is running.
- `SMART_CONTROL_CAPABLE` / `SMART_CONTROL_OFF` = idle but boost-eligible.

Lifecycle (`SmartFlexDeviceLifecycleStatus`): `ONBOARDING, PENDING_LIVE, LIVE,
ONBOARDING_TEST_IN_PROGRESS, FAILED_ONBOARDING_TEST, RETIRED` — only `LIVE` devices can be boosted.

## 2. Bug found by the spike (pre-existing, shipped)

`KrakenClient.triggerBoostCharge()` calls a mutation that **does not exist**:

```graphql
triggerBoostCharge(input: { accountNumber: $accountNumber }) { krakenflexDeviceId }
```

- The real field is `updateBoostCharge`, **not** `triggerBoostCharge`.
- The real input is **device-scoped** (`deviceId` + `action`), **not** `{ accountNumber }`.

Impact: the live `bump_charge` Flow action (`drivers/electricity/driver.ts` → `bumpCharge()`) has
**never worked** — Kraken rejects the unknown field, the driver's `try/catch` swallows it and reports
"not available (experimental)". So no wrong write occurs (it fails closed), but the action is dead.
It is left untouched here (fails safe); **fixing it is the first task of S65** (below).

## 3. Shipped this sprint (read-only, safe)

- `DispatchView.boostingNow` — an active dispatch window whose `kind === 'BOOST'` (clock-verified,
  same source as `activeNow`).
- `DispatchPoller.isBoosting()` — any account boosting now; **fails closed on stale** dispatch data
  (a retained-across-failure window past its freshness does not report boosting).
- Flow **condition** `ev_boost_active` — "an EV boost is / is not active". Read-only, no Kraken call
  (reads the dispatch poller state), consistent with the existing `dispatch_active` condition.

## 4. S65 plan — BL-24b consent-gated write (do NOT ship without all of these)

1. **Fix the client:** replace `triggerBoostCharge` with the verified
   `updateBoostCharge(deviceId, action: 'BOOST'|'CANCEL')`; resolve `deviceId` from
   `getCachedDevices` (prefer an `EV`/`CHARGE_POINT` device that is `LIVE` and boost-capable).
2. **Consent gate:** an explicit opt-in setting (e.g. `enable_boost_control`) that **defaults OFF**;
   the `bump_charge` action (and a new `cancel_boost` action) refuse with a clear message until the
   user enables it. Never inferred.
3. **Reference-verify on a live IOG account** before enabling in the store (the mutation is
   versionless — R-005/R-006): confirm `BOOST` transitions `currentState` → `BOOSTING`, `CANCEL`
   returns to smart control, and errors are reported honestly (no silent success).
4. **Reversible + honest:** a boost is control intent, **never** a settled-price claim; surface the
   returned `status` and re-verify against the dispatch model.
5. **Budget:** the write is user-initiated (rare); do not add polling. Reuse the 30-min device cache
   for `deviceId` resolution.

## 5. Re-introspection ritual (BL-30)

Re-run the introspection above before shipping S65 and on any Kraken error regression, since the API
carries no version guarantee.
