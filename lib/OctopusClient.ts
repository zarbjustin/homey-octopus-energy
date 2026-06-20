'use strict';

import type { Rate, ConsumptionRecord } from './rates';
import { productCodeFromTariff } from './rates';

const BASE_URL = 'https://api.octopus.energy/v1';

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Agreement {
  tariff_code: string;
  valid_from: string | null;
  valid_to: string | null;
}

export interface ElectricityMeterPoint {
  mpan: string;
  is_export?: boolean;
  meters: Array<{ serial_number: string }>;
  agreements: Agreement[];
}

export interface GasMeterPoint {
  mprn: string;
  meters: Array<{ serial_number: string }>;
  agreements: Agreement[];
}

export interface Property {
  electricity_meter_points?: ElectricityMeterPoint[];
  gas_meter_points?: GasMeterPoint[];
}

export interface Account {
  number: string;
  properties: Property[];
  balance?: number;
}

export type FuelType = 'electricity' | 'gas';

/** A single discovered meter, flattened from the account response. */
export interface DiscoveredMeter {
  fuel: FuelType;
  /** MPAN (electricity) or MPRN (gas). */
  mpxn: string;
  serial: string;
  isExport: boolean;
  tariffCode: string | null;
  productCode: string | null;
}

export class OctopusApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'OctopusApiError';
  }
}

export interface OctopusClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Max attempts for transient failures (429 / 5xx). */
  maxRetries?: number;
  /** Override the fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
}

/**
 * Thin, typed wrapper around the Octopus Energy REST API.
 * Auth is HTTP Basic with the API key as the username and a blank password.
 */
export class OctopusClient {

  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly maxRetries: number;

  private readonly fetchImpl: typeof fetch;

  constructor(opts: OctopusClientOptions) {
    if (!opts.apiKey) throw new Error('An Octopus API key is required.');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.apiKey}:`).toString('base64');
    return `Basic ${token}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  /** Perform a single GET request with auth, retry and typed error handling. */
  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: this.authHeader(),
            Accept: 'application/json',
          },
        });
        if (res.status === 401) {
          throw new OctopusApiError(401, 'Authentication failed — check your API key.');
        }
        if (res.status === 404) {
          throw new OctopusApiError(404, `Not found: ${url}`);
        }
        if (res.status === 429 || res.status >= 500) {
          // Transient — back off and retry.
          throw new OctopusApiError(res.status, `Transient error ${res.status}`);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new OctopusApiError(res.status, `Request failed (${res.status}): ${body}`);
        }
        return await res.json() as T;
      } catch (err) {
        lastErr = err;
        const status = err instanceof OctopusApiError ? err.status : 0;
        const transient = status === 429 || status >= 500 || status === 0;
        if (!transient || attempt === this.maxRetries - 1) throw err;
        const backoff = 2 ** attempt * 1000;
        await new Promise((resolve) => {
          // eslint-disable-next-line homey-app/global-timers
          setTimeout(resolve, backoff);
        });
      }
    }
    throw lastErr;
  }

  /** Follow `next` links and return all results across pages. */
  async getAll<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T[]> {
    const out: T[] = [];
    let page: Paginated<T> | null = await this.get<Paginated<T>>(path, params);
    let guard = 0;
    while (page && guard < 50) {
      out.push(...page.results);
      page = page.next ? await this.get<Paginated<T>>(page.next) : null;
      guard++;
    }
    return out;
  }

  // --- Products ------------------------------------------------------------

  async listProducts(params: Record<string, string | number | undefined> = {}): Promise<Array<{
    code: string;
    display_name: string;
    direction: string;
    brand: string;
    is_variable: boolean;
    is_green: boolean;
    available_to: string | null;
  }>> {
    return this.getAll('/products/', { brand: 'OCTOPUS_ENERGY', ...params });
  }

  /**
   * Find the most relevant active product code whose display name contains the
   * given fragment (case-insensitive), preferring import + still-available ones.
   */
  async findProductCode(nameFragment: string): Promise<string | null> {
    const products = await this.listProducts();
    const frag = nameFragment.toLowerCase();
    const matches = products
      .filter((p) => (p.display_name || '').toLowerCase().includes(frag))
      .filter((p) => p.direction !== 'EXPORT')
      .filter((p) => p.available_to === null || new Date(p.available_to).getTime() > Date.now());
    if (!matches.length) return null;
    return matches[0].code;
  }

  // --- Account -------------------------------------------------------------

  async getAccount(accountNumber: string): Promise<Account> {
    return this.get<Account>(`/accounts/${encodeURIComponent(accountNumber)}/`);
  }

  /**
   * Flatten the meters on an account into a simple list, picking each meter
   * point's currently-active agreement (valid_to null, else most recent).
   */
  async discoverMeters(accountNumber: string): Promise<DiscoveredMeter[]> {
    const account = await this.getAccount(accountNumber);
    const meters: DiscoveredMeter[] = [];
    for (const property of account.properties ?? []) {
      for (const mp of property.electricity_meter_points ?? []) {
        const tariffCode = OctopusClient.activeTariff(mp.agreements);
        for (const meter of mp.meters ?? []) {
          meters.push({
            fuel: 'electricity',
            mpxn: mp.mpan,
            serial: meter.serial_number,
            isExport: Boolean(mp.is_export),
            tariffCode,
            productCode: tariffCode ? productCodeFromTariff(tariffCode) : null,
          });
        }
      }
      for (const mp of property.gas_meter_points ?? []) {
        const tariffCode = OctopusClient.activeTariff(mp.agreements);
        for (const meter of mp.meters ?? []) {
          meters.push({
            fuel: 'gas',
            mpxn: mp.mprn,
            serial: meter.serial_number,
            isExport: false,
            tariffCode,
            productCode: tariffCode ? productCodeFromTariff(tariffCode) : null,
          });
        }
      }
    }
    return meters;
  }

  /** Choose the active agreement's tariff code (null valid_to wins, else latest). */
  static activeTariff(agreements: Agreement[] = []): string | null {
    if (!agreements.length) return null;
    const now = Date.now();
    const sorted = [...agreements].sort(
      (a, b) => new Date(b.valid_from ?? 0).getTime() - new Date(a.valid_from ?? 0).getTime(),
    );
    // Prefer an agreement that is active right now (started, not yet ended).
    const current = sorted.find((a) => {
      const from = a.valid_from ? new Date(a.valid_from).getTime() : -Infinity;
      const to = a.valid_to ? new Date(a.valid_to).getTime() : Infinity;
      return from <= now && to > now;
    });
    if (current) return current.tariff_code ?? null;
    // Otherwise fall back to the most recent agreement (latest valid_from).
    return sorted[0]?.tariff_code ?? null;
  }

  // --- Tariff prices -------------------------------------------------------

  async standardUnitRates(
    fuel: FuelType,
    productCode: string,
    tariffCode: string,
    params: { period_from?: string; period_to?: string; page_size?: number } = {},
  ): Promise<Rate[]> {
    const seg = fuel === 'electricity' ? 'electricity-tariffs' : 'gas-tariffs';
    return this.getAll<Rate>(
      `/products/${productCode}/${seg}/${tariffCode}/standard-unit-rates/`,
      { page_size: 1500, ...params },
    );
  }

  /** Day or night unit rates for a two-register (Economy 7) electricity tariff. */
  async registerUnitRates(
    register: 'day' | 'night',
    productCode: string,
    tariffCode: string,
    params: { period_from?: string; period_to?: string; page_size?: number } = {},
  ): Promise<Rate[]> {
    return this.getAll<Rate>(
      `/products/${productCode}/electricity-tariffs/${tariffCode}/${register}-unit-rates/`,
      { page_size: 1500, ...params },
    );
  }

  async standingCharges(
    fuel: FuelType,
    productCode: string,
    tariffCode: string,
    params: { period_from?: string; period_to?: string } = {},
  ): Promise<Rate[]> {
    const seg = fuel === 'electricity' ? 'electricity-tariffs' : 'gas-tariffs';
    return this.getAll<Rate>(
      `/products/${productCode}/${seg}/${tariffCode}/standing-charges/`,
      { page_size: 100, ...params },
    );
  }

  // --- Consumption ---------------------------------------------------------

  async consumption(
    fuel: FuelType,
    mpxn: string,
    serial: string,
    params: {
      period_from?: string;
      period_to?: string;
      page_size?: number;
      order_by?: string;
      group_by?: string;
    } = {},
  ): Promise<ConsumptionRecord[]> {
    const base = fuel === 'electricity'
      ? `/electricity-meter-points/${mpxn}/meters/${serial}/consumption/`
      : `/gas-meter-points/${mpxn}/meters/${serial}/consumption/`;
    return this.getAll<ConsumptionRecord>(base, {
      page_size: 25000,
      order_by: 'period',
      ...params,
    });
  }
}
