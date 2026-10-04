# Dispatch eligibility evidence contract (S75)

Eligibility is separate from freshness. A planned window is intent, not physical
charging, settlement or a household discount. No new control writes are added.

| Evidence | Eligibility / acquisition outcome |
|---|---|
| Linked EV/charge point or participating device; every candidate read valid | Eligible; empty is authoritative no-plan |
| No linked devices; valid non-empty legacy account feed | Eligible legacy support; preserve this fallback |
| Previously verified legacy support; valid empty legacy feed | Eligible, authoritative no-plan |
| No devices; first legacy feed empty | Unknown, no enrollment proof; retain plan, bounded 30-minute recheck |
| Only known non-dispatch categories, explicitly nonparticipating status | Ineligible for this app's EV dispatch model; 30-minute discovery recheck |
| Unknown category or null/unavailable control status without a candidate | Unknown, not permanent unsupported; 30-minute discovery recheck |
| Missing device / generic GraphQL field error | Degraded, never classified by broad error-message regex |
| Known auth error KT-CT-1124 or HTTP 401/403 | Degraded authentication; credential repair invalidates scoped cache, not budget |
| HTTP 429 / budget skip | Degraded throttled; existing account gate remains authoritative |
| Network/5xx | Degraded transient; retained plan is stale, no false transitions |
| Missing/null list, malformed dates/rows, any candidate rejection | Degraded schema/partial failure; never successful empty |
| Nullable status resolver failure with intact validated devices | Keep device; eligible candidates can still be queried |

No provider not-enrolled/unsupported GraphQL error code has been verified in the
reviewed evidence. Do not invent one or reuse Octoplus's broad unsupported-field
heuristic for dispatches. Such responses remain degraded until a documented typed
signal is available. Only explicit device-category evidence currently establishes
ineligibility; tariff names, empty arrays and English error text do not.

Negative eligibility cache is account-scoped and capped at 30 minutes. A normal
fresh discovery/verified credential repair invalidates it without resetting the
Kraken budget. Widget reads cannot initiate discovery. Additive sanitised reason
codes/time fields belong in views; aggregate counts belong in settings. Raw device
IDs, account IDs and provider payloads do not belong in diagnostics.
