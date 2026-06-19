'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType } from './OctopusClient';
import { KrakenClient } from './KrakenClient';
import {
  Rate, rateAt, valueOf,
} from './rates';

export interface MeterStore {
  apiKey: string;
  accountNumber: string;
  mpxn: string;
  serial: string;
  fuel: FuelType;
  isExport: boolean;
  productCode: string | null;
  tariffCode: string | null;
}

export interface MeterSettings {
  poll_interval: number;
  vat: 'inc' | 'exc';
  cheap_threshold: number;
  expensive_threshold: number;
}

/**
 * Shared base for the electricity and gas meter devices. Owns the API clients,
 * the refresh schedule, and the common price / standing-charge / balance logic.
 * Fuel-specific behaviour (e.g. consumption units, Flow cards) is layered on by
 * the concrete driver subclasses.
 */
export class OctopusMeterDevice extends Homey.Device {

  protected client!: OctopusClient;

  protected kraken!: KrakenClient;

  protected rates: Rate[] = [];

  protected standingRates: Rate[] = [];

  protected currentPrice: number | null = null;

  private refreshTimer: NodeJS.Timeout | null = null;

  private alignTimer: NodeJS.Timeout | null = null;

  async onInit(): Promise<void> {
    this.buildClients();
    await this.onInitExtra();
    await this.refresh().catch((err) => this.error('Initial refresh failed:', err));
    this.scheduleRefresh();
    this.log(`${this.store().fuel} meter initialised: ${this.getName()}`);
  }

  /** Hook for subclasses to add capabilities/listeners before the first refresh. */
  protected async onInitExtra(): Promise<void> {
    // no-op by default
  }

  protected store(): MeterStore {
    return {
      apiKey: this.getStoreValue('apiKey'),
      accountNumber: this.getStoreValue('accountNumber'),
      mpxn: this.getStoreValue('mpxn'),
      serial: this.getStoreValue('serial'),
      fuel: this.getStoreValue('fuel'),
      isExport: Boolean(this.getStoreValue('isExport')),
      productCode: this.getStoreValue('productCode'),
      tariffCode: this.getStoreValue('tariffCode'),
    };
  }

  protected settings(): MeterSettings {
    return this.getSettings() as MeterSettings;
  }

  protected vatInc(): boolean {
    return this.settings().vat !== 'exc';
  }

  protected buildClients(): void {
    const { apiKey } = this.store();
    this.client = new OctopusClient({ apiKey });
    this.kraken = new KrakenClient(apiKey);
  }

  // --- Data access for Flow cards / subclasses -----------------------------

  /** Cached forward-looking unit rates (sorted ascending elsewhere). */
  getRates(): Rate[] {
    return this.rates;
  }

  /** The current unit rate value (p/kWh), VAT per the device setting. */
  getCurrentPrice(): number | null {
    return this.currentPrice;
  }

  getCurrentRate(at: Date = new Date()): Rate | null {
    return rateAt(this.rates, at);
  }

  // --- Refresh -------------------------------------------------------------

  /** Refresh prices, standing charge and balance. Subclasses extend this. */
  protected async refresh(): Promise<void> {
    let ok = false;
    try {
      await this.refreshPrices();
      ok = true;
    } catch (err) {
      this.error('Price refresh failed:', err);
    }
    try {
      await this.refreshStandingCharge();
      ok = true;
    } catch (err) {
      this.error('Standing-charge refresh failed:', err);
    }
    try {
      await this.refreshBalance();
      ok = true;
    } catch (err) {
      this.error('Balance refresh failed:', err);
    }
    try {
      await this.refreshExtra();
      ok = true;
    } catch (err) {
      this.error('Extra refresh failed:', err);
    }
    if (ok) {
      if (!this.getAvailable()) await this.setAvailable().catch(this.error);
    } else {
      await this.setUnavailable('Could not reach Octopus Energy.').catch(this.error);
    }
  }

  /** Hook for subclasses to add fuel-specific refresh work (e.g. consumption). */
  protected async refreshExtra(): Promise<void> {
    // no-op by default
  }

  private periodWindow(): { period_from: string; period_to: string } {
    const now = new Date();
    const from = new Date(now.getTime() - 6 * 3600_000); // a little history for "current"
    const to = new Date(now.getTime() + 48 * 3600_000); // up to two days ahead
    return { period_from: from.toISOString(), period_to: to.toISOString() };
  }

  protected async refreshPrices(): Promise<void> {
    const s = this.store();
    if (!s.productCode || !s.tariffCode) return;
    const rates = await this.client.standardUnitRates(
      s.fuel,
      s.productCode,
      s.tariffCode,
      this.periodWindow(),
    );
    this.rates = rates;
    const current = rateAt(rates);
    if (current) {
      const value = Number(valueOf(current, this.vatInc()).toFixed(4));
      this.currentPrice = value;
      await this.setCapabilityValue('octopus_price', value).catch(this.error);
      await this.onPriceUpdated(value, current);
    }
  }

  /** Hook fired after the current price capability is set (Flow triggers etc.). */
  protected async onPriceUpdated(_value: number, _rate: Rate): Promise<void> {
    // no-op by default
  }

  protected async refreshStandingCharge(): Promise<void> {
    const s = this.store();
    if (!s.productCode || !s.tariffCode) return;
    const charges = await this.client.standingCharges(s.fuel, s.productCode, s.tariffCode);
    this.standingRates = charges;
    const current = rateAt(charges) ?? charges[0];
    if (current) {
      const value = Number(valueOf(current, this.vatInc()).toFixed(4));
      await this.setCapabilityValue('octopus_standing_charge', value).catch(this.error);
    }
  }

  protected async refreshBalance(): Promise<void> {
    const { accountNumber } = this.store();
    if (!accountNumber) return;
    const balance = await this.kraken.getBalance(accountNumber);
    await this.setCapabilityValue('octopus_balance', Number(balance.toFixed(2))).catch(this.error);
  }

  // --- Scheduling ----------------------------------------------------------

  private scheduleRefresh(): void {
    this.stopTimers();
    // Align the first tick to the next half-hour boundary (prices change then),
    // after which we fall back to the configured polling interval.
    const now = new Date();
    const msToHalfHour = (30 - (now.getMinutes() % 30)) * 60_000
      - now.getSeconds() * 1000 - now.getMilliseconds();
    this.alignTimer = this.homey.setTimeout(() => {
      this.refresh().catch((err) => this.error('Aligned refresh failed:', err));
      this.startInterval();
    }, Math.max(1000, msToHalfHour));
  }

  private startInterval(): void {
    const minutes = Math.max(5, Number(this.settings().poll_interval) || 30);
    this.refreshTimer = this.homey.setInterval(() => {
      this.refresh().catch((err) => this.error('Scheduled refresh failed:', err));
    }, minutes * 60_000);
  }

  private stopTimers(): void {
    if (this.refreshTimer) { this.homey.clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.alignTimer) { this.homey.clearTimeout(this.alignTimer); this.alignTimer = null; }
  }

  // --- Lifecycle -----------------------------------------------------------

  async onSettings({ changedKeys }: { changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes('poll_interval')) {
      this.homey.setTimeout(() => this.scheduleRefresh(), 100);
    }
    if (changedKeys.some((k) => ['vat', 'cheap_threshold', 'expensive_threshold'].includes(k))) {
      this.homey.setTimeout(() => this.refresh().catch((err) => this.error(err)), 200);
    }
  }

  async onDeleted(): Promise<void> {
    this.stopTimers();
  }

  async onUninit(): Promise<void> {
    this.stopTimers();
  }
}
