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

export type AccountIogTariffType = 'DayNightTariff' | 'FourRateEvTariff';

/** Privacy-safe (identifier-free) summary of how the active IOG agreement was
 *  resolved, for diagnostics only. */
export interface IogResolveDiagnostic {
  activeAgreementCount: number;
  dayNightCount: number;
  fourRateCount: number;
  exactMatchFound: boolean;
  fallbackUsed: boolean;
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

  private octoplusSessions?: { accountNumber: string; request: Promise<SavingSession[]> };

  private readonly accountKey: string;

  constructor(apiKey: string, accountNumber?: string, url: string = GRAPHQL_URL, backendUrl?: string) {
    if (!apiKey) throw new Error('An Octopus API key is required.');
    this.apiKey = apiKey;
    this.url = url;
    this.backendUrl = backendUrl ?? (url === GRAPHQL_URL ? BACKEND_GRAPHQL_URL : url);
    // All GraphQL traffic for one account shares a single request budget. When
    // an account number is unknown (rare bootstrap paths) fall back to a stable
    // non-reversible key so a missing account still gets *a* bucket.
    this.accountKey = accountNumber || `key:${apiKey.slice(0, 6)}`;
  }

  private async post<T>(
    headers: Record<string, string>,
    query: string,
    variables: Record<string, unknown>,
    url = this.url,
    priority: KrakenPriority = 'best',
  ): Promise<GraphQLResponse<T>> {
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
        if (retryJson.errors?.length) throw new Error(retryJson.errors[0].message);
        return retryJson.data as T;
      }
      throw new Error(json.errors[0].message);
    }
    return json.data as T;
  }

  /** Obtain (and cache) a Kraken JWT from the REST API key. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
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
    // Kraken tokens last ~1 hour; refresh a little early to be safe.
    this.tokenExpiry = Date.now() + 50 * 60 * 1000;
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
            }
          }
        }
      }`;
    interface Agreement {
      validFrom?: string;
      validTo?: string | null;
      tariff?: {
        __typename?: string;
        tariffCode?: string;
        productCode?: string;
        displayName?: string;
        dayRate?: number | null;
        nightRate?: number | null;
        preVatDayRate?: number | null;
        preVatNightRate?: number | null;
        evDevicePeakRate?: number | null;
        evDeviceOffPeakRate?: number | null;
        preVatEvDevicePeakRate?: number | null;
        preVatEvDeviceOffPeakRate?: number | null;
        standingCharge?: number | null;
      } | null;
    }
    const data = await this.query<{ account?: { electricityAgreements?: Agreement[] } }>(
      query,
      { accountNumber },
      true,
      this.url,
      'core',
    );
    const agreements = data?.account?.electricityAgreements ?? [];
    const expectedTariff = expectedTariffCode.toUpperCase();
    const expectedProduct = expectedProductCode.toUpperCase();
    const now = Date.now();
    const finite = (value: unknown): number | null => {
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };

    // Build a fully-validated tariff from an agreement, or null if it is not a
    // usable IOG household agreement (missing codes / non-finite required rates).
    const build = (agreement: Agreement, resolvedVia: 'exact' | 'fallback'): AccountIogTariff | null => {
      const { tariff } = agreement;
      const tariffType = tariff?.__typename as AccountIogTariffType | undefined;
      if (!tariff || (tariffType !== 'DayNightTariff' && tariffType !== 'FourRateEvTariff')) return null;
      const dayRate = finite(tariff.dayRate);
      const nightRate = finite(tariff.nightRate);
      const preVatDayRate = finite(tariff.preVatDayRate);
      const preVatNightRate = finite(tariff.preVatNightRate);
      if (!tariff.tariffCode || !tariff.productCode
        || dayRate === null || nightRate === null
        || preVatDayRate === null || preVatNightRate === null) return null;
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
        tariffCode: tariff.tariffCode,
        productCode: tariff.productCode,
        validTo: agreement.validTo ?? null,
        displayName: tariff.displayName ?? '',
        dayRate,
        nightRate,
        preVatDayRate,
        preVatNightRate,
        evDevicePeakRate,
        evDeviceOffPeakRate,
        preVatEvDevicePeakRate,
        preVatEvDeviceOffPeakRate,
        standingCharge: finite(tariff.standingCharge),
      };
    };

    // Household IOG import agreement typenames only (this inherently excludes
    // export/outgoing agreements, which surface as other typenames); an explicit
    // OUTGOING/EXPORT name guard is defence-in-depth since electricityAgreements
    // spans both import and export meter points.
    const exportLike = (t: Agreement['tariff']): boolean => {
      return /OUTGOING|EXPORT/.test(`${t?.tariffCode ?? ''}${t?.productCode ?? ''}`.toUpperCase());
    };
    const isHousehold = (a: Agreement): boolean => (
      (a.tariff?.__typename === 'DayNightTariff' || a.tariff?.__typename === 'FourRateEvTariff')
      && !exportLike(a.tariff)
    );
    const isActive = (a: Agreement): boolean => {
      const from = Date.parse(a.validFrom ?? '');
      const to = a.validTo ? Date.parse(a.validTo) : null;
      return Number.isFinite(from) && (to === null || Number.isFinite(to))
        && from <= now && (to === null || now < to);
    };
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

    onResolve?.({
      activeAgreementCount: active.length,
      dayNightCount: active.filter((a) => a.tariff?.__typename === 'DayNightTariff').length,
      fourRateCount: active.filter((a) => a.tariff?.__typename === 'FourRateEvTariff').length,
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

  /** Fetch and cache the shared Power Down/Power Up event response. */
  private async getOctoplusSessions(accountNumber: string): Promise<SavingSession[]> {
    if (this.octoplusSessions?.accountNumber === accountNumber) return this.octoplusSessions.request;
    const request = this.fetchOctoplusSessions(accountNumber);
    this.octoplusSessions = { accountNumber, request };
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
    const data = await this.query<{ devices?: unknown }>(query, { accountNumber }, true, this.url, 'live');
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
