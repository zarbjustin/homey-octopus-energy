'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType } from './OctopusClient';
import { KrakenClient } from './KrakenClient';
import {
  Rate, rateAt, valueOf, sumConsumption, cheapestRate, cheapestWindow,
  isCheapestSlotNow, priceLevel, PriceLevel,
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

  protected currentBalance: number | null = null;

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
    await this.refreshConsumption();
  }

  /**
   * Fetch recent half-hourly consumption and derive:
   *  - usage over the last 24h of available data (octopus_usage_today),
   *  - the cost of that usage incl. one day's standing charge (octopus_cost_today),
   *  - a monotonic cumulative total for Homey Energy (meter_power).
   * Octopus consumption typically lags real time by up to ~24 hours.
   */
  protected async refreshConsumption(): Promise<void> {
    const s = this.store();
    if (!s.mpxn || !s.serial) return;
    const hasUsage = this.hasCapability('octopus_usage_today');
    const hasCost = this.hasCapability('octopus_cost_today');
    const meterCap = this.energyMeterCapability();
    const hasMeter = Boolean(meterCap) && this.hasCapability(meterCap as string);
    if (!hasUsage && !hasCost && !hasMeter) return;

    const now = new Date();
    const lastEndIso: string | null = this.getStoreValue('lastConsumptionEnd');
    const historyFrom = new Date(now.getTime() - 30 * 3600_000);
    const fetchFrom = lastEndIso
      ? new Date(Math.min(new Date(lastEndIso).getTime(), historyFrom.getTime()))
      : new Date(now.getTime() - 7 * 86400_000);

    const records = await this.client.consumption(s.fuel, s.mpxn, s.serial, {
      period_from: fetchFrom.toISOString(),
      period_to: now.toISOString(),
      order_by: 'period',
    });
    if (!records.length) return;

    const sorted = [...records].sort(
      (a, b) => new Date(a.interval_start).getTime() - new Date(b.interval_start).getTime(),
    );
    const last48 = sorted.slice(-48);

    if (hasUsage) {
      const usage = Number(this.toEnergyUnit(sumConsumption(last48)).toFixed(2));
      await this.setCapabilityValue('octopus_usage_today', usage).catch(this.error);
    }

    if (hasCost) {
      let pence = 0;
      for (const r of last48) {
        const rate = rateAt(this.rates, new Date(r.interval_start));
        if (rate) pence += this.toEnergyUnit(r.consumption) * valueOf(rate, this.vatInc());
      }
      const sc = rateAt(this.standingRates) ?? this.standingRates[0];
      if (sc) pence += valueOf(sc, this.vatInc());
      await this.setCapabilityValue('octopus_cost_today', Number((pence / 100).toFixed(2))).catch(this.error);
    }

    if (hasMeter) {
      const lastEnd = lastEndIso ? new Date(lastEndIso).getTime() : 0;
      const fresh = sorted.filter((r) => new Date(r.interval_end).getTime() > lastEnd);
      const add = this.toMeterUnit(sumConsumption(fresh));
      const cumulative = Number(((Number(this.getStoreValue('cumulativeMeter')) || 0) + add).toFixed(3));
      await this.setStoreValue('cumulativeMeter', cumulative);
      await this.setStoreValue('lastConsumptionEnd', sorted[sorted.length - 1].interval_end);
      await this.setCapabilityValue(meterCap as string, cumulative).catch(this.error);
    }
  }

  /**
   * The capability that holds the cumulative meter reading for Homey Energy.
   * Electricity uses meter_power (kWh); gas overrides this with meter_gas (m³).
   */
  protected energyMeterCapability(): string | null {
    return 'meter_power';
  }

  /**
   * Convert a raw consumption value into kWh. Electricity is already kWh;
   * gas may be reported in m³ and is converted by the gas subclass.
   */
  protected toEnergyUnit(value: number): number {
    return value;
  }

  /**
   * Convert a raw consumption value into the cumulative meter's unit
   * (kWh for electricity, m³ for gas).
   */
  protected toMeterUnit(value: number): number {
    return value;
  }

  private periodWindow(): { period_from: string; period_to: string } {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 3600_000); // cover the last 24h for cost calc
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
  protected async onPriceUpdated(value: number, _rate: Rate): Promise<void> {
    if (this.hasCapability('octopus_price_level')) {
      const level = priceLevel(value, this.thresholds());
      await this.setCapabilityValue('octopus_price_level', level).catch(this.error);
    }
  }

  /** Cheap/expensive thresholds (p/kWh) from settings, with sensible defaults. */
  protected thresholds(): { cheap: number; expensive: number } {
    const cheap = Number(this.getSetting('cheap_threshold'));
    const expensive = Number(this.getSetting('expensive_threshold'));
    return {
      cheap: Number.isFinite(cheap) ? cheap : 15,
      expensive: Number.isFinite(expensive) ? expensive : 30,
    };
  }

  // --- Dynamic-pricing intelligence ---------------------------------------

  /** The current price level (plunge/cheap/normal/expensive), or null. */
  getPriceLevel(at: Date = new Date()): PriceLevel | null {
    const rate = rateAt(this.rates, at);
    if (!rate) return null;
    return priceLevel(valueOf(rate, this.vatInc()), this.thresholds());
  }

  /** The cheapest upcoming rate within an optional forward window (hours). */
  getCheapestUpcoming(withinHours?: number): Rate | null {
    const now = new Date();
    const to = withinHours ? new Date(now.getTime() + withinHours * 3600_000) : undefined;
    const forward = this.rates.filter((r) => {
      const end = r.valid_to ? new Date(r.valid_to).getTime() : Infinity;
      return end > now.getTime();
    });
    return cheapestRate(forward, { from: now, to, incVat: this.vatInc() });
  }

  /** The cheapest contiguous block of `slots` half-hours in the forward window. */
  getCheapestWindow(slots: number, withinHours?: number): Rate[] | null {
    const now = new Date();
    const to = withinHours ? new Date(now.getTime() + withinHours * 3600_000) : undefined;
    return cheapestWindow(this.rates, slots, { from: now, to, incVat: this.vatInc() });
  }

  /** Is the current half-hour the cheapest in the (optional) forward window? */
  isCheapestNow(withinHours?: number, at: Date = new Date()): boolean {
    return isCheapestSlotNow(this.rates, at, { withinHours, incVat: this.vatInc() });
  }

  /** Public entry point for the "refresh now" Flow action. */
  async refreshNow(): Promise<void> {
    await this.refresh();
  }

  /** Is `at` within the cheapest contiguous `durationHours` block of the next `withinHours`? */
  isWithinCheapestPeriod(durationHours: number, withinHours: number, at: Date = new Date()): boolean {
    const slots = Math.max(1, Math.round(durationHours * 2));
    const win = this.getCheapestWindow(slots, withinHours);
    if (!win || !win.length) return false;
    const start = new Date(win[0].valid_from).getTime();
    const lastTo = win[win.length - 1].valid_to;
    const end = lastTo ? new Date(lastTo).getTime() : Infinity;
    const t = at.getTime();
    return t >= start && t < end;
  }

  /** Find the cheapest `durationHours` block within `withinHours`, for the Flow action. */
  findCheapestSlot(withinHours: number, durationHours: number): { start_time: string; price: number } | null {
    const slots = Math.max(1, Math.round(durationHours * 2));
    const win = this.getCheapestWindow(slots, withinHours);
    if (!win || !win.length) return null;
    const avg = win.reduce((acc, r) => acc + valueOf(r, this.vatInc()), 0) / win.length;
    return {
      start_time: this.formatLocal(new Date(win[0].valid_from)),
      price: Number(avg.toFixed(2)),
    };
  }

  /** Format an instant as a short local time string using Homey's timezone. */
  protected formatLocal(d: Date): string {
    const tz = this.homey.clock.getTimezone();
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(d);
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
    const balance = Number((await this.kraken.getBalance(accountNumber)).toFixed(2));
    await this.setCapabilityValue('octopus_balance', balance).catch(this.error);
    const prev = this.currentBalance;
    this.currentBalance = balance;
    if (prev !== null && balance !== prev) {
      const state = { deviceId: this.getData().id, balance };
      this.fireAppTrigger('balance_changed', { balance }, state);
      this.fireAppTrigger('balance_below', { balance }, state);
    }
  }

  /** The last known account balance (£), or null if not yet fetched. */
  getBalance(): number | null {
    return this.currentBalance;
  }

  /** Fire an app-level Flow trigger (device matching handled by app.ts). */
  protected fireAppTrigger(id: string, tokens: Record<string, unknown>, state: Record<string, unknown>): void {
    try {
      this.homey.flow.getTriggerCard(id)
        .trigger(tokens, state)
        .catch((err) => this.error(`Trigger ${id} failed:`, err));
    } catch (err) {
      // Card not defined — ignore.
    }
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
    if (this.refreshTimer) {
      this.homey.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.alignTimer) {
      this.homey.clearTimeout(this.alignTimer);
      this.alignTimer = null;
    }
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
