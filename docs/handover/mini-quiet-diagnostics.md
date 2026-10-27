# Mini quiet-path diagnostics — 27 October 2026

## Scope and evidence

Fetched main/release baseline `809bbe2` / v1.0.41; targeted diagnostic candidate
only, no new version, installation, Homey setting/Flow change, provider refresh,
release or channel action. Original cloud-backed checkout files were left alone;
implementation/validation uses a fresh checkout. Private support messages,
identifiers, raw logs, screenshots and telemetry values are excluded from Git.

A follow-up manual report is listed under Build 41. Its approximately five-minute
log contains startup and a separate missing smart-charge-device error, but no
logged Mini throttling failure or proof of fresh Mini readings. That does not
identify the affected account's quiet-path cause. The v1.0.41 transport fix is
delivered, but sustained Mini recovery is **not field-confirmed**.

## Investigation findings

The source can quietly skip a poll during shared cooldown/local budget gating,
back off Mini discovery for 30 minutes after no device is found, receive empty
telemetry, or retain an old sample that is not applied as live power. An enabled
meter can also lack a registered source subscriber or fail its capability write.
The old report did not distinguish these stages.

Two independently reproduced trust bugs are corrected: `Number(null)`/blank or
boolean demand could become zero watts; a missing sample timestamp could be
replaced with receipt time and appear current. Explicit numeric zero remains
valid. Invalid/missing/future sample time is now unavailable, retaining the last
known value/time rather than fabricating a new live sample. This is not proof
that either bug caused the private field report.

## Diagnostic contract

- `getMiniDiagnostics()` on the app reads cached source metadata plus aggregate
  request-budget counters. No account IDs, Mini IDs, meter names, power values,
  credentials or raw error strings. Five account entries maximum, with an explicit
  truncation flag; numeric positions are ephemeral and are not account identity.
- Per-account flags: discovery state, registered subscriber count, loop presence,
  in-flight/since, reason, reading freshness and whitelisted last error kind.
- Times: poll invocation, discovery attempt, demand attempt, decoded response,
  last fresh sample receipt, original measurement, next scheduled tick, discovery
  backoff and shared cooldown. Times are not proof of physical response.
- Counters: polls/coalescing, cooldown/discovery/budget skips, method attempts,
  empty/invalid/stale/current samples, provider and synchronous listener errors.
  Attempts include locally rejected calls; these are **not exact wire counts**.
  Aggregate budget counters describe this app process, not other integrations.
- Electricity delivery metadata separately reports enabled/subscribed/capability
  flags, latest callback receipt, completed capability write and write-failure
  count. Receiving a callback can mean unknown/stale, not a usable sample. A
  completed Homey write is software evidence, not physical acceptance.
- Existing `/support/snapshot` remains authenticated GET-only and independently
  allowlists all new metadata. Settings creates/previews/downloads only on user
  action. No automatic upload or persisted diagnostic setting is introduced.
- `Mini diagnostics (identifier-free)` log payloads are emitted after the first
  completed poll, then at most once per five minutes on existing poll activity.
  A long in-flight operation is observable on overlapping existing ticks without
  issuing another request or adding a timer. No active subscription means no
  poll-driven log: inspect the support snapshot's enabled/subscribed flags.

## Reading the next report

| Evidence | Interpretation |
|---|---|
| Enabled, not subscribed | Registration/lifecycle stage; not proof of provider outage |
| Discovery not found with nextDiscoveryAt | Existing 30-minute discovery backoff, not a stopped loop |
| budgetSkips/local denials increase | This app's shared allowance denied the method attempt |
| cooldownSkips with cooldownUntil | Provider throttle gate active; other consumers can open it |
| Decoded response advances, emptyReadings increases | No demand sample in the response |
| invalidReadings or staleReadings increases | Value/time cannot be applied as current live power |
| Current sample count advances, writeFailures increases | Device delivery failed after valid telemetry |
| Poll count advances, inFlightSince ages, coalesced increases | Existing request has not completed; no overlapping request is started |

Capture a diagnostic after the symptom, and preferably create/review a support
snapshot in app Settings. Do not ask for API keys, raw settings, re-pairing,
repeated restarting or repeated forced refreshes. A future release and reporter
retest are separate gates; no affected-account recovery is claimed here.

## Validation

770 tests pass (16 new targeted regressions). Full/production audits report zero
vulnerabilities; lint, normal Homey build and publish validation pass with only
the two expected cumulative-direction warnings. Existing manifest/contracts are
unchanged. GitHub CI and delivery of this new candidate remain separate checks.
