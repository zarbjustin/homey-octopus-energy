# Working input — independent security specialist findings (feeds `06-security-review.md`)

> Produced by the `security-review` specialist (whole-codebase, no diff), 21 Jul 2026. The orchestrator
> merges this with the architect's `06` draft during synthesis. Working file — may be pruned before final commit.

## Bottom line
No Critical/High/Medium findings. Defensively-engineered; credential-handling, injection, and CI claims hold.
Two Low / defense-in-depth items.

## Low / defense-in-depth
### L1 — Inconsistent URL-encoding of `productCode`/`tariffCode` in REST paths
`lib/OctopusClient.ts:401,414,428,440,454` interpolate `productCode`/`tariffCode` raw into the path in
`standardUnitRates`, `latestStandardUnitRates`, `registerUnitRates`, `latestRegisterUnitRates`, `standingCharges`,
whereas `getProduct`/`getAccount`/`consumption` use `encodeURIComponent` (`:305,332,473-474`).
Not exploitable: (1) pairing regex-constrains the tariff code `OctopusMeterDriver.ts:120` `/^[EG]-\d+R-[A-Z0-9-]+-[A-P]$/`;
(2) discovery codes come from Octopus responses; (3) `buildUrl` re-parses via `new URL()` and rejects cross-origin
(`:171-173`). **Fix (consistency):** wrap both in `encodeURIComponent` in those five methods.

### L2 — `DispatchPoller.redact` scrubs only the API key, not the account number
`lib/DispatchPoller.ts:200-202` redacts `creds.apiKey` only; peers also strip `accountNumber`/`mpxn`/`serial`
(`OctopusMeterDevice.ts:625-631`, `SavingSessionsPoller.ts:165`). Account number is passed to Kraken as a GraphQL
variable (not in URL), so low risk. **Fix (parity):** also mask `accountNumber`.

## Done well (for the balanced posture section)
- **Credentials:** API key never in URL/GraphQL body — REST HTTP Basic in `Authorization` header
  (`OctopusClient.ts:166`); Kraken key passed as a GraphQL **variable** (`KrakenClient.ts:295-305`). HTTPS enforced,
  embedded creds rejected (`:130-135`), same-origin enforced before sending auth (`:171-173`), `redirect:'manual'`
  so `Authorization` isn't forwarded (`:158`), 3xx treated as error (`:186`).
- **Token:** memory-only (`KrakenClient.ts:124`), refreshed ~10 min early (`:307`), single-flight (`:246-262`),
  re-obtained once on auth error (`:220-230`); never persisted.
- **Injection:** all GraphQL uses `$variable` parameterization with static query + separate `variables`
  (`KrakenClient.ts:283`). No template interpolation into query bodies.
- **Widgets:** all six escape user strings via identical `esc()` (`&<>"'`), numeric-only `innerHTML`; `settings/index.html`
  uses `textContent`/`createTextNode` only. Backends never expose key/account/token.
- **Identifier-free diagnostics confirmed:** `IogResolveDiagnostic` (`KrakenClient.ts:61-83`) integer counts +
  `__typename` histogram; `DispatchPoller.writeDiagnostics` aggregate counts; masked account (`maskAccount → A?***nn`).
- **Pairing validation:** account, MPAN/MPRN `/^\d{6,20}$/`, serial charset, tariff code regex-validated
  (`OctopusMeterDriver.ts:34-124`).
- **Supply chain / CI:** zero runtime deps; every GitHub Action pinned to a full commit SHA; `npm audit` hard gate in
  `ci.yml`, `homey-app-publish.yml`, `homey-app-version.yml`.
- **CI secrets:** `HOMEY_PAT` only in `workflow_dispatch`-gated publish; fork workflows `contents: read`, no secrets,
  no `pull_request_target`; `inputs.changelog` passed via quoted `env:`/`printf %s` (no shell injection).
- **Transport/crypto:** hardcoded HTTPS endpoints; `Math.random` only for retry jitter; no `eval`/`child_process`/
  dynamic `require`. Carbon API unauthenticated, receives no Octopus creds.
