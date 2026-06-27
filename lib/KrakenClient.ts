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

const GRAPHQL_URL = 'https://api.octopus.energy/v1/graphql/';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { errorCode?: string } }>;
}

export interface SavingSession {
  id: string;
  startAt: string;
  endAt: string;
  rewardPerKwh: number;
}

export interface Dispatch {
  start: string;
  end: string;
}

export class KrakenClient {

  private readonly apiKey: string;

  private readonly url: string;

  private token: string | null = null;

  private tokenExpiry = 0;

  constructor(apiKey: string, url: string = GRAPHQL_URL) {
    if (!apiKey) throw new Error('An Octopus API key is required.');
    this.apiKey = apiKey;
    this.url = url;
  }

  private async post<T>(headers: Record<string, string>, query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>> {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        // eslint-disable-next-line homey-app/global-timers
        const timer = setTimeout(() => controller.abort(), 20_000);
        let res: Response;
        try {
          res = await fetch(this.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`Transient Kraken error ${res.status}`);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Kraken request failed (${res.status}): ${body.slice(0, 200)}`);
        }
        return await res.json() as GraphQLResponse<T>;
      } catch (err) {
        lastErr = err;
        const transient = err instanceof Error && /Transient Kraken error|fetch failed|network|abort/i.test(err.message);
        if (!transient || attempt === maxAttempts - 1) throw err;
        await new Promise((resolve) => {
          // eslint-disable-next-line homey-app/global-timers
          setTimeout(resolve, 2 ** attempt * 1000);
        });
      }
    }
    throw lastErr;
  }

  private async query<T>(query: string, variables: Record<string, unknown>, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = await this.getToken();
    const json = await this.post<T>(headers, query, variables);
    if (json.errors?.length) {
      const unauthenticated = json.errors.some(
        (e) => e.extensions?.errorCode === 'KT-CT-1124' || /authenticat/i.test(e.message),
      );
      if (auth && unauthenticated) {
        // Token likely expired — refresh once and retry.
        this.token = null;
        headers.Authorization = await this.getToken();
        const retryJson = await this.post<T>(headers, query, variables);
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
    const data = await this.query<{ account: { balance: number } }>(query, { accountNumber });
    const pence = Number(data?.account?.balance ?? 0);
    return pence / 100;
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
    const data = await this.query<Resp>(query, { accountNumber });
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
    );
    const telemetry = data?.smartMeterTelemetry;
    let list: Array<{ readAt?: string; demand: string | number }> = [];
    if (Array.isArray(telemetry)) {
      list = telemetry;
    } else if (telemetry) {
      list = [telemetry];
    }
    if (!list.length) return null;
    // Select the most recent sample by readAt rather than assuming array order.
    const latest = list.reduce((a, b) => (
      new Date(b.readAt ?? 0).getTime() >= new Date(a.readAt ?? 0).getTime() ? b : a
    ));
    const demand = Number(latest?.demand);
    return Number.isFinite(demand) ? demand : null;
  }

  /**
   * Octopus "Saving Sessions" events for an account. Returns a normalised list
   * of upcoming/recent events. Best-effort: returns [] if the schema/account
   * does not support saving sessions.
   */
  async getSavingSessions(accountNumber: string): Promise<SavingSession[]> {
    const query = `
      query SavingSessions($accountNumber: String!) {
        savingSessions(accountNumber: $accountNumber) {
          events {
            id
            startAt
            endAt
            rewardPerKwhInOctoPoints
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
        }>;
      };
    }
    const data = await this.query<Resp>(query, { accountNumber });
    const events = data?.savingSessions?.events ?? [];
    return events
      .filter((e) => e.id != null && e.startAt && e.endAt)
      .map((e) => ({
        id: String(e.id),
        startAt: String(e.startAt),
        endAt: String(e.endAt),
        rewardPerKwh: Number(e.rewardPerKwhInOctoPoints ?? 0),
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
    const data = await this.query<Resp>(query, { accountNumber });
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
    const data = await this.query<Resp>(query, { accountNumber });
    const list = data?.completedDispatches ?? [];
    return list
      .map((d) => ({ start: String(d.start ?? d.startDt ?? ''), end: String(d.end ?? d.endDt ?? '') }))
      .filter((d) => d.start && d.end);
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
    await this.query(mutation, { accountNumber });
  }

  /**
   * Octoplus loyalty points balance for the account. Best-effort: returns null
   * if the account is not enrolled in Octoplus or the field is unavailable.
   */
  async getOctoplusPoints(accountNumber: string): Promise<number | null> {
    const query = `
      query Octoplus($accountNumber: String!) {
        loyaltyPointLedgers(accountNumber: $accountNumber) {
          balanceCarriedForward
        }
      }`;
    interface Resp {
      loyaltyPointLedgers?: Array<{ balanceCarriedForward?: number | string }>;
    }
    const data = await this.query<Resp>(query, { accountNumber });
    const ledgers = data?.loyaltyPointLedgers ?? [];
    if (!ledgers.length) return null;
    const points = Number(ledgers[0]?.balanceCarriedForward);
    return Number.isFinite(points) ? points : null;
  }

  /**
   * Octopus "Free Electricity" sessions for the account. Best-effort: returns []
   * if unavailable. Shares the SavingSession shape (reward is not applicable).
   */
  async getFreeElectricitySessions(accountNumber: string): Promise<SavingSession[]> {
    const query = `
      query FreeElectricity($accountNumber: String!) {
        freeElectricitySessions(accountNumber: $accountNumber) {
          code
          startAt
          endAt
        }
      }`;
    interface Resp {
      freeElectricitySessions?: Array<{ code?: string; startAt?: string; endAt?: string }>;
    }
    const data = await this.query<Resp>(query, { accountNumber });
    const events = data?.freeElectricitySessions ?? [];
    return events
      .filter((e) => e.code && e.startAt && e.endAt)
      .map((e) => ({
        id: String(e.code),
        startAt: String(e.startAt),
        endAt: String(e.endAt),
        rewardPerKwh: 0,
      }));
  }
}
