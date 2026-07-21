# 07 — Performance review

Scope: runtime performance, API efficiency and resource management only. Priority scheme: **P0** release/data-loss blocker, **P1** major production impact, **P2** important optimisation, **P3** polish.

## Findings by area

### Refresh and poll cadences

| Area | Current behaviour | Evidence | Assessment |
|---|---|---|---|
| Device refresh | On init, every device refreshes immediately, then starts interval/aligned/daily timers. Dynamic tariffs add half-hour alignment and Agile 16:05 publication timer. | `lib/OctopusMeterDevice.ts:235`, `lib/OctopusMeterDevice.ts:1990`, `lib/OctopusMeterDevice.ts:2006`, `lib/OctopusMeterDevice.ts:2018`, `lib/OctopusMeterDevice.ts:2026`. | Good price freshness, but startup can be bursty when multiple meters initialise. |
| Account pollers | Saving Sessions and Dispatch pollers call `runPoll()` immediately and then set intervals. | `lib/AccountPoller.ts:24`, `lib/AccountPoller.ts:29`; app starts both at `app.ts:321` and `app.ts:325`. | **P1:** no startup jitter yet; S51c correctly targets this (`docs/handover/sprints-50-58-spec.md:91`). |
| Dispatch | Account-level, 5-minute poller with clock-recomputed active state. | `lib/DispatchPoller.ts:27`, `lib/DispatchPoller.ts:35`, `lib/DispatchPoller.ts:218`. | Correctness is strong; budget cost depends on device count in `getFlexPlanned`. |
| Saving Sessions / Power Ups | 15-minute account poller, sequential per account. | `lib/SavingSessionsPoller.ts:21`, `lib/SavingSessionsPoller.ts:24`. | Conservative cadence; duplicated soon triggers are a QA issue more than raw perf. |
| Live Home Mini demand | Shared per account, opt-in subscribers, allowed cadence 60/120/300s default 120s. | `lib/LiveDemandSource.ts:47`, `lib/LiveDemandSource.ts:55`, `lib/LiveDemandSource.ts:82`. | Major improvement over old 30s/device design; keep default conservative. |

### Shared Kraken budget efficiency

The F0 budget is implemented as a process-wide account bucket with sustained **~90 req/hr** and burst **6** (`lib/KrakenBudget.ts:14`, `lib/KrakenBudget.ts:37`). `KrakenClient.post` is the choke point and throws `BudgetError` rather than queueing non-core work when tokens are unavailable (`lib/KrakenClient.ts:153`, `lib/KrakenClient.ts:157`). This protects the account but still lets core requests drive negative token debt (`lib/KrakenBudget.ts:93`, `lib/KrakenBudget.ts:97`). S51’s reserved-core admission is therefore the right next optimisation (`ROADMAP.md:76`, `docs/handover/sprints-50-58-spec.md:88`).

### Redundant or duplicate API calls

| Duplicate / inefficiency | Evidence | Expected impact | Recommendation |
|---|---|---:|---|
| Monthly cost and billing summary fetch overlapping consumption/rates/standing on the same refresh cycle. | Monthly fetches consumption/rates/standing (`lib/OctopusMeterDevice.ts:2043`); billing summary fetches the same families (`lib/OctopusMeterDevice.ts:2084`). | Medium on REST calls, high on latency for slow accounts. | **P1:** introduce a short-lived REST coalescer keyed by method+path+window; cite S51e (`docs/handover/sprints-50-58-spec.md:93`). |
| Billing summary discovers export meters every 2h even though discovery is stable. | `exportBillingInput` calls `discoverMeters` then export consumption/rates (`lib/OctopusMeterDevice.ts:2128`, `lib/OctopusMeterDevice.ts:2131`). | Medium for accounts with import+export; low otherwise. | **P2:** reuse an account-level discovered-meter cache or share S51e cache. |
| Tariff comparison finds products and tariff codes inside loops, then fetches per-candidate rates. | Product lookup loop (`lib/OctopusMeterDevice.ts:1812`); per-candidate rates loop (`lib/OctopusMeterDevice.ts:1827`). | Medium; user-invoked but can be expensive. | **P2:** move to S55 cached catalogue and eligibility model (`ROADMAP.md:80`). |
| Carbon current+forecast are refetched every device refresh without an explicit TTL. | Regional/national current+forecast calls (`drivers/electricity/device.ts:101`, `drivers/electricity/device.ts:111`). | Medium if users set short poll intervals or multiple electricity meters. | **P2:** add an account/region cache with source freshness. |
| Account-level points are still refreshed per device instance with only device-local cooldown. | `lastPointsRefresh` is per device (`lib/OctopusMeterDevice.ts:215`); refresh code calls `kraken.getOctoplusPoints` (`lib/OctopusMeterDevice.ts:1718`). | Low/medium; one per hour per meter. | **P2:** implement S51f account-level points cache (`docs/handover/sprints-50-58-spec.md:94`). |

### Hot paths in `OctopusMeterDevice`

`runRefresh` does three core calls in parallel, then `refreshExtra`, then reporting tasks serially (`lib/OctopusMeterDevice.ts:543`, `lib/OctopusMeterDevice.ts:548`, `lib/OctopusMeterDevice.ts:550`). This ordering is safe but places many unrelated concerns under one refresh lock. Consumption accumulation also reads and writes store cursor/total during refresh (`lib/OctopusMeterDevice.ts:878`, `lib/OctopusMeterDevice.ts:886`). The single-flight guard prevents concurrent refreshes (`lib/OctopusMeterDevice.ts:520`), but an old watchdog-displaced refresh is not cancelled and can still complete later; the spec already calls this race out (`docs/handover/sprints-50-58-spec.md:239`).

**Recommendation:** during S52, separate pure data fetch, state derivation, and Homey writes. That enables caching/coalescing at service level and makes old-generation writes easier to reject. Expected impact: lower regression risk and easier latency profiling; effort **L**.

### Memory and allocation

The code bounds account maps to 20 entries (`app.ts:54`, `app.ts:63`) and diagnostics to 30 device entries (`lib/OctopusMeterDevice.ts:643`), which is appropriate for Homey. Live demand account state is deleted when the last subscriber leaves (`lib/LiveDemandSource.ts:104`). Remaining memory risk is more about settings growth and identifier retention than heap pressure: Saving Sessions state and diagnostics use raw account-number keys (`lib/SavingSessionsPoller.ts:70`, `lib/SavingSessionsPoller.ts:156`) and retain up to 50 IDs per account (`lib/SavingSessionsPoller.ts:132`).

### Timer / interval management

Device timers are cleared on delete/uninit (`lib/OctopusMeterDevice.ts:2034`, `lib/OctopusMeterDevice.ts:2053`). Live demand clears timers on last unsubscribe and app shutdown (`lib/LiveDemandSource.ts:104`, `lib/LiveDemandSource.ts:131`). Electricity device unsubscribes from live demand on settings disable/delete/uninit (`drivers/electricity/device.ts:259`, `drivers/electricity/device.ts:275`, `drivers/electricity/device.ts:281`). This is strong. The remaining timer issue is startup stampede, not leaks.

### Caching effectiveness

Strong: balance 10-min cache (`app.ts:127`), dispatch planned 60s (`app.ts:145`), completed 4min (`app.ts:162`, `app.ts:234`), devices 30min (`app.ts:181`), IOG tariff 6h/null backoff (`app.ts:257`, `app.ts:307`). Weak: no unified REST cache for overlapping consumption/rates; no carbon cache; no account-level points cache.

### Startup cost

At app init, two account pollers start immediately and live demand source is constructed (`app.ts:321`, `app.ts:325`, `app.ts:327`). Each device also performs an initial refresh before scheduling (`lib/OctopusMeterDevice.ts:235`). On a multi-meter account, startup can simultaneously request price/standing/balance, consumption, dispatch, saving sessions, and GraphQL token. Token single-flight helps (`lib/KrakenClient.ts:230`), but S51c startup jitter remains pending (`docs/handover/sprints-50-58-spec.md:91`).

## Prioritised optimisation backlog

| Priority | Recommendation | Expected impact | Effort | Evidence |
|---|---|---|---|---|
| P1 | Add startup jitter to account pollers and optionally device first refresh after a failed init. | Avoids boot-time API bursts and budget debt; smoother Homey restarts. | M | Immediate `runPoll` at `lib/AccountPoller.ts:24`; device initial refresh at `lib/OctopusMeterDevice.ts:235`; S51c planned at `docs/handover/sprints-50-58-spec.md:91`. |
| P1 | Finish reserved-core budget admission and system ≤90/hr test. | Prevents core bursts from starving live/best while preserving auth/dispatch. | M | Core debt design at `lib/KrakenBudget.ts:93`; S51b/h at `docs/handover/sprints-50-58-spec.md:88`, `docs/handover/sprints-50-58-spec.md:96`. |
| P1 | Short-TTL REST coalescing for consumption/rates/standing/discovery. | Fewer REST calls and lower refresh latency, especially import+export accounts. | M/L | Duplicate monthly/billing calls at `lib/OctopusMeterDevice.ts:2043` and `lib/OctopusMeterDevice.ts:2084`; planned S51e at `docs/handover/sprints-50-58-spec.md:93`. |
| P2 | Account/region cache for carbon current+forecast. | Lower external calls on short poll intervals; clearer freshness. | M | Carbon fetches at `drivers/electricity/device.ts:101` and `drivers/electricity/device.ts:111`; S53 per-source freshness at `ROADMAP.md:78`. |
| P2 | Move tariff comparison to a cached product catalogue with eligibility/confidence. | Faster user-invoked comparison and less misleading output. | L | Current loops at `lib/OctopusMeterDevice.ts:1812`; S55 target at `ROADMAP.md:80`. |
| P2 | Decompose refresh services and reject stale-generation writes. | Less lock contention, easier profiling, fewer race regressions. | L/XL | Refresh lock at `lib/OctopusMeterDevice.ts:520`; old-refresh race noted at `docs/handover/sprints-50-58-spec.md:239`. |
| P3 | Add identifier-free per-feature budget counters. | Better diagnostics when users report throttling; little direct latency benefit. | S/M | Current snapshot only accounts/gated/minTokens (`lib/KrakenBudget.ts:132`); S51d at `docs/handover/sprints-50-58-spec.md:92`. |

⚠ Cross-discipline note: Product may ask for sub-60s live power because Home Mini samples often update faster. Engineering should resist: the code deliberately limits live cadence to 60/120/300s (`lib/LiveDemandSource.ts:47`) and the roadmap protects a shared ~90/hr budget (`ROADMAP.md:53`). Faster polling would improve perceived reactivity but reduce reliability for every Octopus integration on the same account.
