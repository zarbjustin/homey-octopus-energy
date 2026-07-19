'use strict';

import type { Rate, ConsumptionRecord } from './rates';
import { productCodeFromTariff } from './rates';

const BASE_URL = 'https://api.octopus.energy/v1';
const MAX_PAGINATION_PAGES = 50;

function parseRetryAfter(value: string | null): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }

  const retryAt = Date.parse(trimmed);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

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

interface ProductTariffSummary {
  code?: string;
}

type RegionalTariffs = Record<string, Record<string, ProductTariffSummary>>;

export interface ProductDetails {
  code: string;
  single_register_electricity_tariffs?: RegionalTariffs;
  dual_register_electricity_tariffs?: RegionalTariffs;
  single_register_gas_tariffs?: RegionalTariffs;
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
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'OctopusApiError';
  }
}

export interface OctopusClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Max attempts for transient failures (429 / 5xx). */
  maxRetries?: number;
  /** Per-request timeout in ms; a hung request would otherwise stall refreshes. */
  timeoutMs?: number;
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

  private readonly baseOrigin: string;

  private readonly maxRetries: number;

  private readonly timeoutMs: number;

  private readonly fetchImpl: typeof fetch;

  constructor(opts: OctopusClientOptions) {
    if (!opts.apiKey) throw new Error('An Octopus API key is required.');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, '');
    const parsedBase = new URL(this.baseUrl);
    if (parsedBase.protocol !== 'https:' && !opts.fetchImpl) {
      throw new Error('The Octopus API endpoint must use HTTPS.');
    }
    if (parsedBase.username || parsedBase.password) {
      throw new Error('The Octopus API endpoint must not contain credentials.');
    }
    this.baseOrigin = parsedBase.origin;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * fetch with a hard timeout. Without this, a stalled socket leaves the
   * awaiting refresh pending forever, which (combined with the single-flight
   * guard in the device) permanently freezes all future price updates.
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        // Authorization must never be forwarded to a redirect target.
        redirect: 'manual',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.apiKey}:`).toString('base64');
    return `Basic ${token}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const absolute = /^https?:\/\//i.test(path);
    const separator = path.startsWith('/') ? '' : '/';
    const url = new URL(absolute ? path : `${this.baseUrl}${separator}${path}`);
    if (url.origin !== this.baseOrigin) {
      throw new Error('Refusing to send Octopus credentials to an unexpected origin.');
    }
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
        const res = await this.fetchWithTimeout(url, {
          method: 'GET',
          headers: {
            Authorization: this.authHeader(),
            Accept: 'application/json',
          },
        });
        if (res.status >= 300 && res.status < 400) {
          throw new OctopusApiError(res.status, 'Octopus API redirects are not permitted.');
        }
        if (res.status === 401) {
          throw new OctopusApiError(401, 'Authentication failed — check your API key.');
        }
        if (res.status === 404) {
          throw new OctopusApiError(404, 'The requested Octopus resource was not found.');
        }
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = res.headers?.get?.('retry-after') ?? null;
          throw new OctopusApiError(
            res.status,
            `Temporary Octopus API error (${res.status}).`,
            parseRetryAfter(retryAfter),
          );
        }
        if (!res.ok) {
          throw new OctopusApiError(res.status, `Octopus API request failed (${res.status}).`);
        }
        return await res.json() as T;
      } catch (err) {
        lastErr = err;
        const status = err instanceof OctopusApiError ? err.status : 0;
        const networkFailure = err instanceof TypeError
          || (err instanceof Error && err.name === 'AbortError');
        const transient = status === 429 || status >= 500 || networkFailure;
        if (!transient || attempt === this.maxRetries - 1) {
          if (networkFailure) {
            throw new OctopusApiError(0, 'The Octopus API request could not be completed.');
          }
          throw err;
        }
        const retryAfterMs = err instanceof OctopusApiError ? err.retryAfterMs : undefined;
        const backoff = retryAfterMs ?? ((2 ** attempt * 1000) + Math.floor(Math.random() * 250));
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, backoff);
        });
      }
    }
    throw lastErr;
  }

  /** Follow `next` links and return all results across pages. */
  async getAll<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T[]> {
    const out: T[] = [];
    let page: Paginated<T> | null = await this.get<Paginated<T>>(path, params);
    const seenPages = new Set<string>();
    let pages = 0;
    while (page !== null) {
      if (typeof page !== 'object'
        || !Array.isArray(page.results)
        || !Number.isFinite(page.count)
        || (page.next !== null && typeof page.next !== 'string')) {
        throw new Error('Octopus API returned an invalid paginated response.');
      }
      pages++;
      if (pages > MAX_PAGINATION_PAGES) {
        throw new Error('Octopus API pagination exceeded the safety limit.');
      }
      out.push(...page.results);
      if (!page.next) {
        page = null;
        continue;
      }
      if (pages === MAX_PAGINATION_PAGES) {
        throw new Error('Octopus API pagination exceeded the safety limit.');
      }
      const next = this.buildUrl(page.next);
      if (seenPages.has(next)) {
        throw new Error('Octopus API pagination returned a repeated page.');
      }
      seenPages.add(next);
      page = await this.get<Paginated<T>>(next);
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

  async getProduct(productCode: string): Promise<ProductDetails> {
    return this.get<ProductDetails>(`/products/${encodeURIComponent(productCode)}/`);
  }

  /** Resolve an actual regional tariff code from the product response. */
  async tariffCodeForProduct(
    productCode: string,
    fuel: FuelType,
    region: string,
    registers: 1 | 2 = 1,
  ): Promise<string | null> {
    const product = await this.getProduct(productCode);
    let table: RegionalTariffs | undefined;
    if (fuel === 'gas') table = product.single_register_gas_tariffs;
    else if (registers === 2) table = product.dual_register_electricity_tariffs;
    else table = product.single_register_electricity_tariffs;
    const paymentMethods = table?.[`_${region.toUpperCase()}`];
    if (!paymentMethods) return null;
    for (const preferred of ['direct_debit_monthly', 'direct_debit_quarterly']) {
      const code = paymentMethods[preferred]?.code;
      if (code) return code;
    }
    return Object.values(paymentMethods).find((tariff) => tariff.code)?.code ?? null;
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

  /** Newest rate rows only, used when a narrow date filter omits a long-lived rate. */
  async latestStandardUnitRates(
    fuel: FuelType,
    productCode: string,
    tariffCode: string,
  ): Promise<Rate[]> {
    const seg = fuel === 'electricity' ? 'electricity-tariffs' : 'gas-tariffs';
    const page = await this.get<Paginated<Rate>>(
      `/products/${productCode}/${seg}/${tariffCode}/standard-unit-rates/`,
      { page_size: 200 },
    );
    return page.results ?? [];
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

  /** Newest Economy 7 register rows without following historical pagination. */
  async latestRegisterUnitRates(
    register: 'day' | 'night',
    productCode: string,
    tariffCode: string,
  ): Promise<Rate[]> {
    const page = await this.get<Paginated<Rate>>(
      `/products/${productCode}/electricity-tariffs/${tariffCode}/${register}-unit-rates/`,
      { page_size: 200 },
    );
    return page.results ?? [];
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
    const meterPoint = encodeURIComponent(mpxn);
    const meterSerial = encodeURIComponent(serial);
    const base = fuel === 'electricity'
      ? `/electricity-meter-points/${meterPoint}/meters/${meterSerial}/consumption/`
      : `/gas-meter-points/${meterPoint}/meters/${meterSerial}/consumption/`;
    return this.getAll<ConsumptionRecord>(base, {
      page_size: 25000,
      order_by: 'period',
      ...params,
    });
  }
}
