'use strict';

/**
 * Minimal Octopus "Kraken" GraphQL client.
 *
 * The REST API does not expose the account balance, so we use GraphQL for that:
 *  1. Exchange the REST API key for a short-lived Kraken JWT (obtainKrakenToken).
 *  2. Query the account balance (returned in pence).
 *
 * The token is cached and transparently refreshed when it expires or a request
 * is rejected as unauthenticated.
 */

import {
  KrakenPriority, BudgetError, isBudgetError, getBucket,
} from './KrakenBudget';
import { SmartFlexDevice, classifyKind } from './dispatch/types';
import { normaliseDevices } from './dispatch/deviceModel';
import { PlannedInput, CompletedInput } from './dispatch/reconcile';
import { jwtExpiryMs } from './jwt';

const GRAPHQL_URL = 'https://api.octopus.energy/v1/graphql/';

const BACKEND_GRAPHQL_URL = 'https://api.backend.octopus.energy/v1/graphql/';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { errorCode?: string } }>;
}

export interface SavingSession {
  id: string;
  startAt: string;
  endAt: string;
  rewardPerKwh: number;
  joined?: boolean;
  eventType?: 'TURN_DOWN' | 'TURN_UP';
}

export interface Dispatch {
  start: string;
  end: string;
}

export type AccountIogTariffType =
  | 'StandardTariff'
  | 'DayNightTariff'
  | 'ThreeRateTariff'
  | 'FourRateEvTariff'
  | 'HalfHourlyTariff';

/** Privacy-safe (identifier-free) summary of how the active IOG agreement was
 *  resolved, for diagnostics only.
 *
 *  The `raw*` fields are the DECISIVE census taken from the UNFILTERED agreement
 *  collection (before any client-side typename/date filter), so they distinguish
 *  the three very different causes that the post-filter `activeAgreementCount`
 *  alone collapses into `0`:
 *    - `rawAgreementCount: 0`                  → the account exposes no
 *      electricity agreement at all (genuinely upstream/account-side).
 *    - `rawAgreementCount > 0` with a non-zero  → an agreement exists under that
 *      `typenameHistogram` entry                   typename; if it is a type we
 *      handle yet still unresolved, that is a client bug, not an upstream gap.
 *    - `serverActiveCount: 0` but `rawActiveCount > 0` → a Kraken `active: true`
 *      quirk hides an otherwise-current agreement.
 *    - `rawActiveCount: 0` with `invalidDateCount > 0` → a validFrom/validTo
 *      parsing/window problem, not an absent agreement. */
export interface IogResolveDiagnostic {
  /** Total agreements in the UNFILTERED collection (no `active: true` arg). */
  rawAgreementCount: number;
  /** Agreements returned by the `active: true` server filter. */
  serverActiveCount: number;
  /** Count of unfiltered agreements by tariff `__typename` (identifier-free). */
  typenameHistogram: Record<string, number>;
  /** Unfiltered agreements passing the date-active window (any typename). */
  rawActiveCount: number;
  /** Unfiltered agreements whose validFrom (or non-null validTo) is unparseable. */
  invalidDateCount: number;
  /** Household import agreements that are date-active (post-filter). */
  activeAgreementCount: number;
  dayNightCount: number;
  fourRateCount: number;
  standardCount: number;
  threeRateCount: number;
  halfHourlyCount: number;
  /** Rows in the resolved agreement's own `unitRates` (HalfHourlyTariff), and
   *  whether one covers the current instant. `-1` when the resolved tariff is
   *  not half-hourly / has no rows. Decisive for "IOG published as half-hourly
   *  in GraphQL but empty in REST": rowCount>0 + coversNow=true means the
   *  account IS exposing a current rate and the app should price from it. */
  halfHourlyRowCount: number;
  halfHourlyCoversNow: boolean;
  exactMatchFound: boolean;
  fallbackUsed: boolean;
}

/** A single half-hourly unit-rate row from an account agreement (HalfHourlyTariff),
 *  the authoritative price series for an IOG account whose REST rows are empty.
 *  `validFrom` is always a parseable ISO instant (rows without one are dropped at
 *  resolution, so pricing and the diagnostic census agree and never fail open). */
export interface AccountIogUnitRate {
  validFrom: string;
  validTo: string | null;
  valueIncVat: number;
  valuePreVat: number;
}

export interface AccountIogTariff {
  tariffType: AccountIogTariffType;
  /** Whether the stored code matched exactly, or a valid active IOG agreement
   *  was used as a fallback (the stored code was stale). */
  resolvedVia: 'exact' | 'fallback';
  tariffCode: string;
  productCode: string;
  /** Agreement end instant (ISO), or null for an open-ended agreement. */
  validTo: string | null;
  displayName: string;
  /** Whether `dayRate`/`nightRate` are an authoritative two-band household
   *  schedule (DayNight/FourRateEv). For single-rate/half-hourly types this is
   *  `false`: the tariff is resolved to ADOPT the live code so the authoritative
   *  REST half-hourly rows recover — the rates here must NOT be used to
   *  synthesize a schedule (they are a flat/best-effort placeholder). */
  scheduleTrusted: boolean;
  /** The agreement's own authoritative half-hourly rows (HalfHourlyTariff only),
   *  or null. When present, these ARE the price series (like Agile REST rows) and
   *  should be used directly — no synthesis, no deferral to an empty REST feed. */
  unitRates: AccountIogUnitRate[] | null;
  dayRate: number;
  nightRate: number;
  preVatDayRate: number;
  preVatNightRate: number;
  evDevicePeakRate: number | null;
  evDeviceOffPeakRate: number | null;
  preVatEvDevicePeakRate: number | null;
  preVatEvDeviceOffPeakRate: number | null;
  standingCharge: number | null;
}

export class KrakenClient {

  private readonly apiKey: string;

  private readonly url: string;

  private readonly backendUrl: string;

  private token: string | null = null;

  private tokenExpiry = 0;

  private tokenInflight: Promise<string> | null = null;

  private octoplusSessions?: { accountNumber: string; request: Promise<SavingSession[]>; ts: number };

  private readonly accountKey: string;

  /** The exact origins this client is allowed to send authenticated GraphQL
   *  requests to — pinned to the configured endpoints so a stray/injected URL
   *  can never receive the bearer token (defense-in-depth). */
  private readonly allowedOrigins: Set<string>;

  constructor(apiKey: string, accountNumber?: string, url: string = GRAPHQL_URL, backendUrl?: string) {
    if (!apiKey) throw new Error('An Octopus API key is required.');
    this.apiKey = apiKey;
    this.url = url;
    this.backendUrl = backendUrl ?? (url === GRAPHQL_URL ? BACKEND_GRAPHQL_URL : url);
    this.allowedOrigins = new Set(
      [this.url, this.backendUrl]
        .map((u) => {
          try {
            return new URL(u).origin;
          } catch {
            return '';
          }
        })
        .filter((o) => o !== ''),
    );
    // All GraphQL traffic for one account shares a single request budget. When
    // an account number is unknown (rare bootstrap paths) fall back to a stable
    // non-reversible key so a missing account still gets *a* bucket.
    this.accountKey = accountNumber || `key:${apiKey.slice(0, 6)}`;
  }

  /** Reject any request URL whose origin is not a configured Kraken endpoint,
   *  BEFORE the bearer token is attached or the budget is spent. */
  private assertAllowedOrigin(url: string): void {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new Error('Refusing to send a Kraken request to a malformed URL.');
    }
    if (!this.allowedOrigins.has(origin)) {
      throw new Error(`Refusing to send a Kraken request to an unexpected origin: ${origin}`);
    }
  }

  private async post<T>(
    headers: Record<string, string>,
    query: string,
    variables: Record<string, unknown>,
    url = this.url,
    priority: KrakenPriority = 'best',
  ): Promise<GraphQLResponse<T>> {
    this.assertAllowedOrigin(url);
    const bucket = getBucket(this.accountKey);
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Admit under the shared per-account budget. Non-core requests are skipped
      // (rather than queued) when no token is available or a 429 gate is open, so
      // callers retain their last-known value instead of hammering the account.
      if (!bucket.acquire(priority)) {
        throw new BudgetError();
      }
      try {
        const controller = new AbortController();
        const timer = globalThis.setTimeout(() => controller.abort(), 20_000);
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (res.status === 429) {
          // Rate limited: open the account backoff gate and stop — do NOT retry
          // inline (that only deepens the throttling).
          bucket.penalise();
          throw new Error('Kraken rate limited (429)');
        }
        if (res.status >= 500) {
          throw new Error(`Transient Kraken error ${res.status}`);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Kraken request failed (${res.status}): ${body.slice(0, 200)}`);
        }
        const json = await res.json() as GraphQLResponse<T>;
        bucket.reward();
        return json;
      } catch (err) {
        lastErr = err;
        if (isBudgetError(err)) throw err;
        if (err instanceof Error && /rate limited \(429\)/.test(err.message)) throw err;
        const transient = err instanceof Error && /Transient Kraken error|fetch failed|network|abort/i.test(err.message);
        if (!transient || attempt === maxAttempts - 1) throw err;
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, 2 ** attempt * 1000);
        });
      }
    }
    throw lastErr;
  }

  private async query<T>(
    query: string,
    variables: Record<string, unknown>,
    auth = true,
    url = this.url,
    priority: KrakenPriority = 'best',
    allowPartial?: (data: unknown) => boolean,
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = await this.getToken();
    const json = await this.post<T>(headers, query, variables, url, priority);
    if (json.errors?.length) {
      const unauthenticated = json.errors.some(
        (e) => e.extensions?.errorCode === 'KT-CT-1124' || /authenticat/i.test(e.message),
      );
      if (auth && unauthenticated) {
        // Token likely expired — refresh once and retry.
        this.token = null;
        headers.Authorization = await this.getToken();
        const retryJson = await this.post<T>(headers, query, variables, url, priority);
        if (retryJson.errors?.length && !(allowPartial?.(retryJson.data) ?? false)) {
          throw new Error(retryJson.errors[0].message);
        }
        return retryJson.data as T;
      }
      // By default any GraphQL error is fatal (a caller relying on a nested field
      // must not silently receive a null/£0 — e.g. account balance). A caller may
      // OPT IN to partial success via `allowPartial` when a specific nullable
      // nested resolver is known to fail independently (e.g. a device's
      // provider-backed `status { currentState }`, "Device status could not be
      // fetched"), returning the still-usable rest of the payload. When the
      // requested field itself nulls out (e.g. "Unable to fetch planned
      // dispatches") the validator rejects it, so we throw and the caller retains
      // prior state / falls back.
      if (!(allowPartial?.(json.data) ?? false)) {
        throw new Error(json.errors[0].message);
      }
    }
    return json.data as T;
  }

  /** Obtain (and cache) a Kraken JWT from the REST API key. Concurrent callers
   *  (e.g. every device + poller on one account refreshing at startup) share a
   *  SINGLE in-flight token request rather than each spending a `core` Kraken call
   *  — the app caches one client per account, so this de-duplicates the whole
   *  account's startup token traffic. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    if (this.tokenInflight) return this.tokenInflight;
    this.tokenInflight = this.fetchToken().finally(() => {
      this.tokenInflight = null;
    });
    return this.tokenInflight;
  }

  private async fetchToken(): Promise<string> {
    const mutation = `
      mutation ObtainKrakenToken($apiKey: String!) {
        obtainKrakenToken(input: { APIKey: $apiKey }) {
          token
        }
      }`;
    const data = await this.query<{ obtainKrakenToken: { token: string } }>(
      mutation,
      { apiKey: this.apiKey },
      false,
      this.url,
      'core',
    );
    const token = data?.obtainKrakenToken?.token;
    if (!token) throw new Error('Could not obtain a Kraken token — check your API key.');
    this.token = token;
    // Prefer the token's own `exp` claim so we refresh exactly when Kraken says
    // it expires. Use a proportional skew (capped at 5 min) so even a
    // short-lived token stays briefly cacheable — this both absorbs clock drift
    // and prevents refresh thrashing that would burn the shared `core` budget.
    // Fall back to the ~1h heuristic when the claim is unreadable or not ahead.
    const MAX_SKEW_MS = 5 * 60 * 1000;
    const claim = jwtExpiryMs(token);
    if (claim !== null && claim > Date.now()) {
      const skew = Math.min(MAX_SKEW_MS, (claim - Date.now()) / 2);
      this.tokenExpiry = claim - skew;
    } else {
      this.tokenExpiry = Date.now() + 50 * 60 * 1000;
    }
    return token;
  }

  /** Account balance in pounds (the API returns pence). */
  async getBalance(accountNumber: string): Promise<number> {
    const query = `
      query AccountBalance($accountNumber: String!) {
        account(accountNumber: $accountNumber) {
          balance
        }
      }`;
    const data = await this.query<{ account: { balance: number } }>(query, { accountNumber }, true, this.url, 'live');
    const pence = Number(data?.account?.balance ?? 0);
    return pence / 100;
  }

  /** Active account-authoritative IOG rates, including the newer four-rate model. */
  async getActiveIogTariff(
    accountNumber: string,
    expectedTariffCode: string,
    expectedProductCode: string,
    onResolve?: (diagnostic: IogResolveDiagnostic) => void,
  ): Promise<AccountIogTariff | null> {
    const query = `
      query ActiveIogTariff($accountNumber: String!) {
        account(accountNumber: $accountNumber) {
          electricityAgreements(active: true) {
            validFrom
            validTo
            tariff {
              __typename
              ... on StandardTariff {
                tariffCode
                productCode
                displayName
                unitRate
                preVatUnitRate
                standingCharge
              }
              ... on DayNightTariff {
                tariffCode
                productCode
                displayName
                dayRate
                nightRate
                preVatDayRate
                preVatNightRate
                standingCharge
              }
              ... on ThreeRateTariff {
                tariffCode
                productCode
                displayName
                dayRate
                nightRate
                offPeakRate
                preVatDayRate
                preVatNightRate
                preVatOffPeakRate
                standingCharge
              }
              ... on FourRateEvTariff {
                tariffCode
                productCode
                displayName
                dayRate
                nightRate
                evDevicePeakRate
                evDeviceOffPeakRate
                preVatDayRate
                preVatNightRate
                preVatEvDevicePeakRate
                preVatEvDeviceOffPeakRate
                standingCharge
              }
              ... on HalfHourlyTariff {
                tariffCode
                productCode
                displayName
                standingCharge
                unitRates {
                  validFrom
                  validTo
                  value
                  preVatValue
                }
              }
            }
          }
          all: electricityAgreements {
            validFrom
            validTo
            tariff {
              __typename
            }
          }
        }
      }`;
    interface UnitRateRow {
      validFrom?: string | null;
      validTo?: string | null;
      value?: number | null;
      preVatValue?: number | null;
    }
    interface Agreement {
      validFrom?: string;
      validTo?: string | null;
      tariff?: {
        __typename?: string;
        tariffCode?: string;
        productCode?: string;
        displayName?: string;
        unitRate?: number | null;
        preVatUnitRate?: number | null;
        dayRate?: number | null;
        nightRate?: number | null;
        offPeakRate?: number | null;
        preVatDayRate?: number | null;
        preVatNightRate?: number | null;
        preVatOffPeakRate?: number | null;
        evDevicePeakRate?: number | null;
        evDeviceOffPeakRate?: number | null;
        preVatEvDevicePeakRate?: number | null;
        preVatEvDeviceOffPeakRate?: number | null;
        unitRates?: UnitRateRow[] | null;
        standingCharge?: number | null;
      } | null;
    }
    interface RawAgreement { validFrom?: string; validTo?: string | null; tariff?: { __typename?: string } | null }
    const data = await this.query<{
      account?: { electricityAgreements?: Agreement[]; all?: RawAgreement[] }
    }>(
      query,
      { accountNumber },
      true,
      this.url,
      'core',
    );
    const agreements = data?.account?.electricityAgreements ?? [];
    // The unfiltered collection is the DECISIVE raw census: it distinguishes a
    // Kraken `active: true` quirk (server hides an otherwise-current agreement)
    // from an account that genuinely exposes no agreement at all. Fall back to
    // the active set if the unfiltered field is absent.
    const rawAgreements: RawAgreement[] = data?.account?.all ?? agreements;
    const expectedTariff = expectedTariffCode.toUpperCase();
    const expectedProduct = expectedProductCode.toUpperCase();
    const now = Date.now();
    const finite = (value: unknown): number | null => {
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };

    // The five household electricity IMPORT tariff typenames Kraken can return
    // (the `TariffType` interface also has Gas/Prepay members and export meter
    // points surface separately — both are excluded below).
    const householdTypes = new Set<AccountIogTariffType>([
      'StandardTariff', 'DayNightTariff', 'ThreeRateTariff', 'FourRateEvTariff', 'HalfHourlyTariff',
    ]);

    // The household day/night schedule for a tariff, with a `trusted` flag.
    //
    //   TRUSTED (an authoritative two-band household schedule that may be
    //   synthesised into rates):
    //     - DayNight / FourRateEv: explicit household day and night rates.
    //
    //   UNTRUSTED (resolved only to ADOPT the live tariff/product code so the
    //   authoritative REST half-hourly rows recover — the returned rates are a
    //   flat/best-effort placeholder and MUST NOT be synthesised into a
    //   schedule; downstream is gated on `scheduleTrusted`):
    //     - StandardTariff: a single-register tariff exposes one `unitRate`; the
    //       IOG cheap window is delivered via dispatch, not a second agreement
    //       rate. Its live REST rows carry the real two-band schedule.
    //     - ThreeRate / HalfHourly: reducing three/many bands to a fixed two-band
    //       schedule by field-name or price-ordering is not a safe assumption, so
    //       we defer to REST rather than guess the guaranteed-window rate.
    //
    //   Returns null only when even the placeholder cannot be formed AND the type
    //   is trusted; untrusted types return a placeholder so their code is still
    //   adopted.
    const scheduleOf = (tariff: NonNullable<Agreement['tariff']>, type: AccountIogTariffType):
      { dayRate: number; nightRate: number; preVatDayRate: number; preVatNightRate: number; trusted: boolean } | null => {
      if (type === 'DayNightTariff' || type === 'FourRateEvTariff') {
        const dayRate = finite(tariff.dayRate);
        const nightRate = finite(tariff.nightRate);
        const preVatDayRate = finite(tariff.preVatDayRate);
        const preVatNightRate = finite(tariff.preVatNightRate);
        if (dayRate === null || nightRate === null || preVatDayRate === null || preVatNightRate === null) return null;
        return {
          dayRate, nightRate, preVatDayRate, preVatNightRate, trusted: true,
        };
      }
      // Untrusted types — best-effort placeholder for the base rate, never used
      // to synthesise a schedule (adoption + REST is the authoritative recovery).
      let base = finite(tariff.unitRate);
      let preVatBase = finite(tariff.preVatUnitRate);
      if (base === null) base = finite(tariff.dayRate);
      if (preVatBase === null) preVatBase = finite(tariff.preVatDayRate);
      if (base === null || preVatBase === null) {
        const rows = Array.isArray(tariff.unitRates) ? tariff.unitRates : [];
        const pair = rows
          .map((r) => ({ inc: finite(r.value), pre: finite(r.preVatValue) }))
          .find((p) => p.inc !== null && p.pre !== null);
        if (pair && pair.inc !== null && pair.pre !== null) {
          base = pair.inc; preVatBase = pair.pre;
        }
      }
      if (base === null || preVatBase === null) {
        base = 0; preVatBase = 0;
      }
      return {
        dayRate: base, nightRate: base, preVatDayRate: preVatBase, preVatNightRate: preVatBase, trusted: false,
      };
    };

    // Build a fully-validated tariff from an agreement, or null if it is not a
    // usable household import agreement (missing codes, or a trusted type with
    // non-finite required rates).
    const build = (agreement: Agreement, resolvedVia: 'exact' | 'fallback'): AccountIogTariff | null => {
      const { tariff } = agreement;
      const tariffType = tariff?.__typename as AccountIogTariffType | undefined;
      if (!tariff || !tariffType || !householdTypes.has(tariffType)) return null;
      if (!tariff.tariffCode || !tariff.productCode) return null;
      const schedule = scheduleOf(tariff, tariffType);
      if (!schedule) return null;
      // Retain the agreement's own half-hourly rows (HalfHourlyTariff) as the
      // authoritative price series. IOG is frequently published as a
      // HalfHourlyTariff whose REST unit-rate feed is empty — these rows are the
      // only current price, so we must not discard them.
      const unitRates: AccountIogUnitRate[] | null = tariffType === 'HalfHourlyTariff'
        ? (Array.isArray(tariff.unitRates) ? tariff.unitRates : [])
          .map((r) => ({
            validFrom: r.validFrom ?? '',
            validTo: r.validTo ?? null,
            valueIncVat: finite(r.value),
            valuePreVat: finite(r.preVatValue),
          }))
          // Drop rows we cannot price safely: a row must have finite inc/exc-VAT
          // values AND a parseable validFrom. A missing/invalid start must never
          // be back-dated into "covers now" (that would fail OPEN); dropping keeps
          // pricing and the census (which also requires a finite validFrom) in lockstep.
          .filter((r): r is AccountIogUnitRate => r.valueIncVat !== null && r.valuePreVat !== null
            && Number.isFinite(Date.parse(r.validFrom)))
        : null;
      const evDevicePeakRate = finite(tariff.evDevicePeakRate);
      const evDeviceOffPeakRate = finite(tariff.evDeviceOffPeakRate);
      const preVatEvDevicePeakRate = finite(tariff.preVatEvDevicePeakRate);
      const preVatEvDeviceOffPeakRate = finite(tariff.preVatEvDeviceOffPeakRate);
      if (tariffType === 'FourRateEvTariff' && (evDevicePeakRate === null
        || evDeviceOffPeakRate === null || preVatEvDevicePeakRate === null
        || preVatEvDeviceOffPeakRate === null)) return null;
      return {
        tariffType,
        resolvedVia,
        scheduleTrusted: schedule.trusted,
        unitRates,
        tariffCode: tariff.tariffCode,
        productCode: tariff.productCode,
        validTo: agreement.validTo ?? null,
        displayName: tariff.displayName ?? '',
        dayRate: schedule.dayRate,
        nightRate: schedule.nightRate,
        preVatDayRate: schedule.preVatDayRate,
        preVatNightRate: schedule.preVatNightRate,
        evDevicePeakRate,
        evDeviceOffPeakRate,
        preVatEvDevicePeakRate,
        preVatEvDeviceOffPeakRate,
        standingCharge: finite(tariff.standingCharge),
      };
    };

    // Household electricity IMPORT agreement typenames only; an explicit
    // OUTGOING/EXPORT name guard is defence-in-depth since electricityAgreements
    // spans both import and export meter points.
    const exportLike = (t: Agreement['tariff']): boolean => {
      return /OUTGOING|EXPORT/.test(`${t?.tariffCode ?? ''}${t?.productCode ?? ''}`.toUpperCase());
    };
    const isHousehold = (a: Agreement): boolean => (
      householdTypes.has(a.tariff?.__typename as AccountIogTariffType) && !exportLike(a.tariff)
    );
    // Shared date-window evaluation for both the typed and raw agreement shapes.
    // Returns 'active' | 'inactive' | 'invalid'. An explicit null/undefined
    // validTo is open-ended; any present-but-unparseable validFrom/validTo (e.g.
    // "") is 'invalid' and fails closed rather than being treated as open-ended.
    const dateStatus = (validFrom?: string, validTo?: string | null): 'active' | 'inactive' | 'invalid' => {
      const from = Date.parse(validFrom ?? '');
      if (!Number.isFinite(from)) return 'invalid';
      const openEnded = validTo === null || validTo === undefined;
      const to = openEnded ? null : Date.parse(validTo as string);
      if (to !== null && !Number.isFinite(to)) return 'invalid';
      return from <= now && (to === null || now < to) ? 'active' : 'inactive';
    };
    const isActive = (a: Agreement): boolean => dateStatus(a.validFrom, a.validTo) === 'active';
    // Most recent first, preferring open-ended agreements (matches the REST
    // "active tariff" heuristic).
    const byRecent = (a: Agreement, b: Agreement): number => {
      const ao = a.validTo === null || a.validTo === undefined ? 1 : 0;
      const bo = b.validTo === null || b.validTo === undefined ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return new Date(b.validFrom ?? 0).getTime() - new Date(a.validFrom ?? 0).getTime();
    };

    // Is this an IOG-family tariff/product code (the same predicate the device
    // uses to decide an IOG meter)? The fallback must never pick a co-existing
    // non-IOG import agreement (e.g. an Economy-7 DayNight meter on the account).
    const iogFamily = (code: string): boolean => (
      /(^|-)IOG(-|$)/.test(code) || (/(^|-)INTELLI-/.test(code) && !/INTELLI-FLUX-/.test(code))
    );
    const isIogTariff = (t: Agreement['tariff']): boolean => (
      iogFamily(`${t?.productCode ?? ''}`.toUpperCase()) || iogFamily(`${t?.tariffCode ?? ''}`.toUpperCase())
    );

    const household = agreements.filter(isHousehold);
    const active = household.filter(isActive).sort(byRecent);

    // Decisive raw census (identifier-free) over the UNFILTERED collection — it
    // distinguishes "no agreement at all" from "agreement of a typename we don't
    // resolve" from "an active:true quirk" from "a date-window/parse problem".
    const typenameHistogram: Record<string, number> = {};
    let invalidDateCount = 0;
    let rawActiveCount = 0;
    for (const a of rawAgreements) {
      const name = a.tariff?.__typename ?? 'Unknown';
      typenameHistogram[name] = (typenameHistogram[name] ?? 0) + 1;
      const status = dateStatus(a.validFrom, a.validTo);
      if (status === 'invalid') invalidDateCount += 1;
      else if (status === 'active') rawActiveCount += 1;
    }

    let result: AccountIogTariff | null = null;
    const exactMatches = active.filter((a) => a.tariff?.tariffCode?.toUpperCase() === expectedTariff
      && a.tariff?.productCode?.toUpperCase() === expectedProduct);
    if (exactMatches.length) {
      // An exact stored-code agreement exists → trust it and NEVER substitute
      // another (a malformed exact match must fail closed, not be masked by a
      // different meter's rates).
      for (const a of exactMatches) {
        result = build(a, 'exact');
        if (result) break;
      }
    } else {
      // No exact match (the stored code is stale — the reason REST is empty).
      // Fall back ONLY to a SINGLE, unambiguous, active IOG-family household
      // agreement. Multiple distinct IOG tariffs (a rare multi-import-meter
      // account) fail closed rather than risk adopting another meter's price.
      const candidates = active
        .filter((a) => isIogTariff(a.tariff))
        .map((a) => build(a, 'fallback'))
        .filter((t): t is AccountIogTariff => t !== null);
      const distinct = new Set(candidates.map((t) => `${t.tariffCode.toUpperCase()}|${t.productCode.toUpperCase()}`));
      if (distinct.size === 1) [result] = candidates; // most recent (active is sorted)
    }

    const countType = (name: AccountIogTariffType): number => (
      active.filter((a) => a.tariff?.__typename === name).length
    );
    // Decisive HalfHourly signal: does the resolved agreement carry its own rows,
    // and does one cover now? Distinguishes "IOG half-hourly in GraphQL, empty in
    // REST — priceable" from "no rate exposed anywhere — genuinely upstream".
    const resolvedRows = result?.unitRates ?? null;
    const halfHourlyRowCount = resolvedRows ? resolvedRows.length : -1;
    const halfHourlyCoversNow = resolvedRows
      ? resolvedRows.some((r) => {
        const from = Date.parse(r.validFrom);
        const to = r.validTo ? Date.parse(r.validTo) : Infinity;
        return from <= now && now < to;
      })
      : false;
    onResolve?.({
      rawAgreementCount: rawAgreements.length,
      serverActiveCount: agreements.length,
      typenameHistogram,
      rawActiveCount,
      invalidDateCount,
      activeAgreementCount: active.length,
      dayNightCount: countType('DayNightTariff'),
      fourRateCount: countType('FourRateEvTariff'),
      standardCount: countType('StandardTariff'),
      threeRateCount: countType('ThreeRateTariff'),
      halfHourlyCount: countType('HalfHourlyTariff'),
      halfHourlyRowCount,
      halfHourlyCoversNow,
      exactMatchFound: result?.resolvedVia === 'exact',
      fallbackUsed: result?.resolvedVia === 'fallback',
    });
    return result;
  }

  /**
   * Find the Kraken device id of the smart import electricity meter (an Octopus
   * Home Mini), used for real-time telemetry. Returns null if none is present.
   */
  async getElectricityDeviceId(accountNumber: string): Promise<string | null> {
    const query = `
      query SmartDevices($accountNumber: String!) {
        account(accountNumber: $accountNumber) {
          properties {
            electricityMeterPoints {
              meters {
                smartImportElectricityMeter {
                  deviceId
                }
              }
            }
          }
        }
      }`;
    interface Resp {
      account: {
        properties: Array<{
          electricityMeterPoints: Array<{
            meters: Array<{ smartImportElectricityMeter?: { deviceId?: string } }>;
          }>;
        }>;
      };
    }
    const data = await this.query<Resp>(query, { accountNumber }, true, this.url, 'live');
    for (const property of data?.account?.properties ?? []) {
      for (const mp of property.electricityMeterPoints ?? []) {
        for (const meter of mp.meters ?? []) {
          const id = meter.smartImportElectricityMeter?.deviceId;
          if (id) return id;
        }
      }
    }
    return null;
  }

  /** Latest instantaneous electricity demand in watts from a Home Mini, or null. */
  async getDemand(deviceId: string): Promise<number | null> {
    return (await this.getDemandReading(deviceId)).demand;
  }

  /**
   * Latest Home Mini demand together with the sample's `readAt` timestamp, so
   * callers can reason about freshness. Demand is watts (negative during export)
   * or null when unavailable.
   */
  async getDemandReading(deviceId: string): Promise<{ demand: number | null; readAt: string | null }> {
    const query = `
      query Telemetry($deviceId: String!) {
        smartMeterTelemetry(deviceId: $deviceId) {
          readAt
          demand
        }
      }`;
    const data = await this.query<{ smartMeterTelemetry: Array<{ readAt?: string; demand: string | number }> | { readAt?: string; demand: string | number } | null }>(
      query,
      { deviceId },
      true,
      this.url,
      'live',
    );
    const telemetry = data?.smartMeterTelemetry;
    let list: Array<{ readAt?: string; demand: string | number }> = [];
    if (Array.isArray(telemetry)) {
      list = telemetry;
    } else if (telemetry) {
      list = [telemetry];
    }
    if (!list.length) return { demand: null, readAt: null };
    // Select the most recent sample by readAt rather than assuming array order.
    const latest = list.reduce((a, b) => (
      new Date(b.readAt ?? 0).getTime() >= new Date(a.readAt ?? 0).getTime() ? b : a
    ));
    const demand = Number(latest?.demand);
    return {
      demand: Number.isFinite(demand) ? demand : null,
      readAt: latest?.readAt ?? null,
    };
  }

  /**
   * Octopus "Saving Sessions" events for an account. Returns a normalised list
   * of upcoming/recent events. Best-effort: returns [] if the schema/account
   * does not support saving sessions.
   */
  async getSavingSessions(accountNumber: string): Promise<SavingSession[]> {
    const sessions = await this.getOctoplusSessions(accountNumber);
    return sessions.filter((session) => session.eventType !== 'TURN_UP');
  }

  /** Fetch and cache the shared Power Down/Power Up event response. Cached for a
   *  short TTL (< the 15-min poll cadence) so the two getters share ONE network
   *  call per cycle, while newly-announced Saving Sessions / Power-ups still
   *  appear on the next poll. A rejected fetch is never cached. */
  private async getOctoplusSessions(accountNumber: string): Promise<SavingSession[]> {
    const cached = this.octoplusSessions;
    if (cached && cached.accountNumber === accountNumber && Date.now() - cached.ts < 10 * 60_000) {
      return cached.request;
    }
    const request = this.fetchOctoplusSessions(accountNumber);
    this.octoplusSessions = { accountNumber, request, ts: Date.now() };
    request.catch(() => {
      if (this.octoplusSessions?.request === request) this.octoplusSessions = undefined;
    });
    return request;
  }

  private async fetchOctoplusSessions(accountNumber: string): Promise<SavingSession[]> {
    const query = `
      query SavingSessions($accountNumber: String!) {
        savingSessions {
          events(includeDev: false) {
            id
            startAt
            endAt
            rewardPerKwhInOctoPoints
            eventType
            targetRegion {
              regionId
            }
          }
          account(accountNumber: $accountNumber) {
            signedUpMeterPoint {
              regionId
            }
            joinedEvents {
              eventId
              startAt
              endAt
              eventType
            }
          }
        }
      }`;
    interface Resp {
      savingSessions?: {
        events?: Array<{
          id?: string | number;
          startAt?: string;
          endAt?: string;
          rewardPerKwhInOctoPoints?: number | string;
          eventType?: 'TURN_DOWN' | 'TURN_UP';
          targetRegion?: Array<{ regionId?: string | number }>;
        }>;
        account?: {
          signedUpMeterPoint?: { regionId?: string | number } | null;
          joinedEvents?: Array<{
            eventId?: string | number;
            startAt?: string;
            endAt?: string;
            eventType?: 'TURN_DOWN' | 'TURN_UP';
          }>;
        };
      };
    }
    const data = await this.query<Resp>(query, { accountNumber }, true, this.backendUrl, 'best');
    const events = data?.savingSessions?.events ?? [];
    const account = data?.savingSessions?.account;
    const accountRegion = account?.signedUpMeterPoint?.regionId;
    const joined = new Set((account?.joinedEvents ?? []).map((e) => String(e.eventId)));
    return events
      .filter((e) => e.id != null && e.startAt && e.endAt)
      .filter((e) => {
        const regions = (e.targetRegion ?? []).map((region) => String(region.regionId));
        return !regions.length || (accountRegion != null && regions.includes(String(accountRegion)));
      })
      .map((e) => ({
        id: String(e.id),
        startAt: String(e.startAt),
        endAt: String(e.endAt),
        rewardPerKwh: Number(e.rewardPerKwhInOctoPoints ?? 0),
        joined: joined.has(String(e.id)),
        eventType: e.eventType,
      }));
  }

  /**
   * Planned smart-charge dispatches (Intelligent Octopus Go). Best-effort:
   * returns [] if the account is not on a smart-charge tariff.
   */
  async getPlannedDispatches(accountNumber: string): Promise<Dispatch[]> {
    const query = `
      query Dispatches($accountNumber: String!) {
        plannedDispatches(accountNumber: $accountNumber) {
          start
          end
        }
      }`;
    interface Resp {
      plannedDispatches?: Array<{ start?: string; end?: string; startDt?: string; endDt?: string }>;
    }
    const data = await this.query<Resp>(query, { accountNumber }, true, this.url, 'live');
    const list = data?.plannedDispatches ?? [];
    return list
      .map((d) => ({ start: String(d.start ?? d.startDt ?? ''), end: String(d.end ?? d.endDt ?? '') }))
      .filter((d) => d.start && d.end);
  }

  /** Completed smart-charge dispatches (Intelligent Octopus Go). Best-effort. */
  async getCompletedDispatches(accountNumber: string): Promise<Dispatch[]> {
    const query = `
      query Completed($accountNumber: String!) {
        completedDispatches(accountNumber: $accountNumber) {
          start
          end
        }
      }`;
    interface Resp {
      completedDispatches?: Array<{ start?: string; end?: string; startDt?: string; endDt?: string }>;
    }
    const data = await this.query<Resp>(query, { accountNumber }, true, this.url, 'best');
    const list = data?.completedDispatches ?? [];
    return list
      .map((d) => ({ start: String(d.start ?? d.startDt ?? ''), end: String(d.end ?? d.endDt ?? '') }))
      .filter((d) => d.start && d.end);
  }

  // --- Sprint 43: device-aware dispatch truth model -----------------------

  /** Linked smart-flex devices for an account (EVs, chargers, batteries, ...). */
  async getDevices(accountNumber: string): Promise<SmartFlexDevice[]> {
    const query = `
      query Devices($accountNumber: String!) {
        devices(accountNumber: $accountNumber) {
          __typename
          id
          deviceType
          status { currentState }
        }
      }`;
    // `status { currentState }` is a provider-backed nullable field that can fail
    // on its own ("Device status could not be fetched") while the device list is
    // still returned. Opt in to partial success so that error does not sink the
    // whole dispatch poll; the device is kept (status → null) and classified by
    // category. Any other shape (devices null/absent) still throws.
    const data = await this.query<{ devices?: unknown }>(
      query, { accountNumber }, true, this.url, 'live',
      (d) => Array.isArray((d as { devices?: unknown } | null)?.devices),
    );
    return normaliseDevices(data);
  }

  /** Device-scoped planned dispatches with SMART/BOOST type (fails closed). */
  async getFlexPlannedDispatches(deviceId: string): Promise<PlannedInput[]> {
    const query = `
      query FlexPlanned($deviceId: String!) {
        flexPlannedDispatches(deviceId: $deviceId) {
          start
          end
          type
        }
      }`;
    interface Row { start?: string; end?: string; type?: string }
    const data = await this.query<{ flexPlannedDispatches?: Row[] }>(query, { deviceId }, true, this.url, 'live');
    const list = data?.flexPlannedDispatches ?? [];
    return list
      .filter((r) => r.start && r.end)
      .map((r) => ({
        deviceId,
        start: String(r.start),
        end: String(r.end),
        kind: classifyKind(r.type),
      }));
  }

  /**
   * Completed dispatch windows with the optional kWh `delta`. The delta is a
   * control-window measurement, NOT proof of the billed rate.
   */
  async getCompletedDispatchWindows(accountNumber: string): Promise<CompletedInput[]> {
    const query = `
      query CompletedDelta($accountNumber: String!) {
        completedDispatches(accountNumber: $accountNumber) {
          start
          end
          delta
        }
      }`;
    interface Row { start?: string; end?: string; delta?: string | number }
    const data = await this.query<{ completedDispatches?: Row[] }>(query, { accountNumber }, true, this.url, 'best');
    const list = data?.completedDispatches ?? [];
    return list
      .filter((r) => r.start && r.end)
      .map((r) => {
        const delta = Number(r.delta);
        return {
          start: String(r.start),
          end: String(r.end),
          delta: Number.isFinite(delta) ? delta : null,
        };
      });
  }

  /**
   * Trigger an immediate EV bump (boost) charge for Intelligent Octopus Go.
   * Best-effort / experimental: the mutation is unofficial and may not be
   * available — throws a clear error if unsupported.
   */
  async triggerBoostCharge(accountNumber: string): Promise<void> {
    const mutation = `
      mutation BoostCharge($accountNumber: String!) {
        triggerBoostCharge(input: { accountNumber: $accountNumber }) {
          krakenflexDeviceId
        }
      }`;
    await this.query(mutation, { accountNumber }, true, this.url, 'core');
  }

  /**
   * Octoplus loyalty points balance for the account. Best-effort: returns null
   * if the account is not enrolled in Octoplus or the field is unavailable.
   */
  async getOctoplusPoints(accountNumber: string): Promise<number | null> {
    const query = `
      query Octoplus($accountNumber: String!) {
        loyaltyPointsBalance(input: { accountNumber: $accountNumber }) {
          loyaltyPoints
        }
      }`;
    interface Resp {
      loyaltyPointsBalance?: { loyaltyPoints?: number | string };
    }
    let data: Resp;
    try {
      data = await this.query<Resp>(query, { accountNumber }, true, this.url, 'best');
    } catch (err) {
      // Loyalty points are only exposed to accounts enrolled in Octoplus with
      // the right field authorisation. Kraken answers unenrolled/ineligible
      // accounts with a field-level "Unauthorized." (which is not a token
      // problem — other authenticated queries keep working). Honour this
      // method's documented best-effort contract and report the field as
      // unavailable (null) rather than surfacing it as a recurring error.
      if (KrakenClient.isUnsupportedFieldError(err)) return null;
      throw err;
    }
    const raw = data?.loyaltyPointsBalance?.loyaltyPoints;
    if (raw === undefined || raw === null) return null;
    const points = Number(raw);
    return Number.isFinite(points) ? points : null;
  }

  /**
   * Whether a GraphQL error is a permanent field-level authorisation/enrolment
   * rejection (as opposed to a transient network/5xx error or an expired token,
   * both of which should be retried rather than swallowed).
   */
  static isUnsupportedFieldError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (/Transient Kraken error|fetch failed|network|abort|timeout/i.test(message)) return false;
    return /unauthori[sz]ed|forbidden|permission|not\s+enrol|enrol(?:led|ment)|eligib|no\s+access/i.test(message);
  }

  /** Octopus Power Up sessions (formerly Free Electricity) for the account. */
  async getFreeElectricitySessions(accountNumber: string): Promise<SavingSession[]> {
    const sessions = await this.getOctoplusSessions(accountNumber);
    return sessions.filter((session) => session.eventType === 'TURN_UP');
  }
}
