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

  private async query<T>(query: string, variables: Record<string, unknown>, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = await this.getToken();
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json() as GraphQLResponse<T>;
    if (json.errors?.length) {
      const unauthenticated = json.errors.some(
        (e) => e.extensions?.errorCode === 'KT-CT-1124' || /authenticat/i.test(e.message),
      );
      if (auth && unauthenticated) {
        // Token likely expired — refresh once and retry.
        this.token = null;
        headers.Authorization = await this.getToken();
        const retry = await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, variables }),
        });
        const retryJson = await retry.json() as GraphQLResponse<T>;
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
    const data = await this.query<{ smartMeterTelemetry: Array<{ demand: string | number }> | { demand: string | number } | null }>(
      query,
      { deviceId },
    );
    const telemetry = data?.smartMeterTelemetry;
    let list: Array<{ demand: string | number }> = [];
    if (Array.isArray(telemetry)) {
      list = telemetry;
    } else if (telemetry) {
      list = [telemetry];
    }
    if (!list.length) return null;
    const demand = Number(list[list.length - 1]?.demand);
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
}
