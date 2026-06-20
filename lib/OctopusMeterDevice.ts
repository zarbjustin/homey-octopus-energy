'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType } from './OctopusClient';
import { KrakenClient } from './KrakenClient';
import {
  Rate, rateAt, valueOf, sumConsumption, cheapestRate, cheapestWindow,
  isCheapestSlotNow, priceLevel, PriceLevel, cheapestSlots, rateCovers, ratesInWindow,
  regionFromTariff, isTwoRegister,
} from './rates';
import { estimateAnnualCost } from './compare';

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

  private agileTimer: NodeJS.Timeout | null = null;

  async onInit(): Promise<void> {
    this.buildClients();
    await this.ensureRegisterCapabilities();
    await this.onInitExtra();
    await this.refresh().catch((err) => this.error('Initial refresh failed:', err));
    this.scheduleRefresh();
    this.log(`${this.store().fuel} meter initialised: ${this.getName()}`);
  }

  /** Add/remove day & night rate capabilities depending on the tariff type. */
  protected async ensureRegisterCapabilities(): Promise<void> {
    const two = this.isTwoRegisterTariff();
    for (const cap of ['octopus_price_day', 'octopus_price_night']) {
      if (two && !this.hasCapability(cap)) {
        await this.addCapability(cap).catch((err) => this.error(`Add ${cap} failed:`, err));
      } else if (!two && this.hasCapability(cap)) {
        await this.removeCapability(cap).catch((err) => this.error(`Remove ${cap} failed:`, err));
      }
    }
  }

  protected isTwoRegisterTariff(): boolean {
    return isTwoRegister(this.store().tariffCode ?? '');
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
    let firstErr: unknown = null;
    const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
        ok = true;
      } catch (err) {
        if (!firstErr) firstErr = err;
        this.error(`${label} failed:`, err);
      }
    };

    await run('Price refresh', () => this.refreshPrices());
    await run('Standing-charge refresh', () => this.refreshStandingCharge());
    await run('Balance refresh', () => this.refreshBalance());
    await run('Extra refresh', () => this.refreshExtra());
    // Non-critical reporting: failures here do not affect device health.
    try {
      await this.refreshPriceStats();
    } catch (err) {
      this.error('Price-stats refresh failed:', err);
    }
    try {
      await this.refreshMonthlyCost();
    } catch (err) {
      this.error('Monthly-cost refresh failed:', err);
    }

    await this.setHealth(ok, firstErr);
  }

  /** Reflect refresh success/failure on the connection alarm and availability. */
  private async setHealth(ok: boolean, err: unknown): Promise<void> {
    if (this.hasCapability('alarm_generic')) {
      await this.setCapabilityValue('alarm_generic', !ok).catch(this.error);
    }
    if (ok) {
      if (this.hasCapability('octopus_updated')) {
        await this.setCapabilityValue('octopus_updated', this.formatLocal(new Date())).catch(this.error);
      }
      if (!this.getAvailable()) await this.setAvailable().catch(this.error);
    } else {
      await this.setUnavailable(this.healthMessage(err)).catch(this.error);
    }
  }

  private healthMessage(err: unknown): string {
    const m = err instanceof Error ? err.message : String(err ?? '');
    if (/401|authenticat/i.test(m)) {
      return 'Authentication failed — repair the device to update your API key.';
    }
    return 'Could not reach Octopus Energy.';
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
    const costCap = this.costCapability();
    const hasCost = this.hasCapability(costCap);
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
      if (this.includeStandingChargeInCost()) {
        const sc = rateAt(this.standingRates) ?? this.standingRates[0];
        if (sc) pence += valueOf(sc, this.vatInc());
      }
      await this.setCapabilityValue(costCap, Number((pence / 100).toFixed(2))).catch(this.error);
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

  /** Capability that receives the daily cost/earnings figure. */
  protected costCapability(): string {
    return 'octopus_cost_today';
  }

  /** Whether a day's standing charge is added to the cost figure (false for export). */
  protected includeStandingChargeInCost(): boolean {
    return true;
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

    if (this.isTwoRegisterTariff()) {
      await this.refreshTwoRegisterPrices(s.productCode, s.tariffCode);
      return;
    }

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

  /** Economy 7 / two-register tariffs: fetch separate day and night unit rates. */
  protected async refreshTwoRegisterPrices(productCode: string, tariffCode: string): Promise<void> {
    const [day, night] = await Promise.all([
      this.client.registerUnitRates('day', productCode, tariffCode, this.periodWindow()),
      this.client.registerUnitRates('night', productCode, tariffCode, this.periodWindow()),
    ]);
    // Use the day rates for the headline price and cost approximation; the exact
    // day/night switch time is region-specific and not exposed by the API.
    this.rates = day;
    const dayRate = rateAt(day) ?? day[0];
    const nightRate = rateAt(night) ?? night[0];
    if (dayRate && this.hasCapability('octopus_price_day')) {
      await this.setCapabilityValue('octopus_price_day', Number(valueOf(dayRate, this.vatInc()).toFixed(2))).catch(this.error);
    }
    if (nightRate && this.hasCapability('octopus_price_night')) {
      await this.setCapabilityValue('octopus_price_night', Number(valueOf(nightRate, this.vatInc()).toFixed(2))).catch(this.error);
    }
    if (dayRate) {
      const value = Number(valueOf(dayRate, this.vatInc()).toFixed(4));
      this.currentPrice = value;
      await this.setCapabilityValue('octopus_price', value).catch(this.error);
      await this.onPriceUpdated(value, dayRate);
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

  /** Plan the cheapest (non-contiguous) `durationHours` before `byTime`, for the Flow action. */
  findCheapestHours(durationHours: number, byTime: string): { count: number; first_start: string; price: number } | null {
    const plan = this.getCheapestPlan(durationHours, byTime);
    if (!plan.length) return null;
    const avg = plan.reduce((acc, r) => acc + valueOf(r, this.vatInc()), 0) / plan.length;
    return {
      count: plan.length,
      first_start: this.formatLocal(new Date(plan[0].valid_from)),
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

  /** Whether an app-level notification toggle is enabled. */
  protected notifyEnabled(key: string, def = false): boolean {
    const v = this.homey.settings.get(key);
    return (v === undefined || v === null) ? def : Boolean(v);
  }

  /** Create a Homey timeline notification (best-effort). */
  protected async notify(excerpt: string): Promise<void> {
    try {
      await this.homey.notifications.createNotification({ excerpt });
    } catch (err) {
      this.error('Notification failed:', err);
    }
  }

  /** The next future instant whose local wall-clock time is `hh:mm`. */
  protected nextLocalTime(hhmm: string): Date {
    const tz = this.homey.clock.getTimezone();
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const nowMin = h * 60 + m;
    const [th, tm] = hhmm.split(':').map((v) => Number(v));
    const targetMin = (Number.isFinite(th) ? th : 7) * 60 + (Number.isFinite(tm) ? tm : 0);
    let diff = (((targetMin - nowMin) % 1440) + 1440) % 1440;
    if (diff === 0) diff = 1440;
    return new Date(now.getTime() + diff * 60_000);
  }

  /**
   * The cheapest `durationHours` of half-hours (non-contiguous) between now and
   * the next occurrence of `byTime` (hh:mm). Sorted ascending by time.
   */
  getCheapestPlan(durationHours: number, byTime: string): Rate[] {
    const slots = Math.max(1, Math.round(Number(durationHours) * 2));
    const to = this.nextLocalTime(byTime);
    return cheapestSlots(this.rates, slots, { from: new Date(), to, incVat: this.vatInc() });
  }

  /** Is `at` inside the cheapest plan for the given duration/deadline? */
  isInCheapestPlan(durationHours: number, byTime: string, at: Date = new Date()): boolean {
    return this.getCheapestPlan(durationHours, byTime).some((r) => rateCovers(r, at));
  }

  // --- Reporting -----------------------------------------------------------

  /**
   * Compare the current tariff against a few candidate Octopus products using
   * the last `days` of real consumption. Returns the cheapest option and the
   * estimated annual saving vs. the current tariff.
   */
  async compareTariffs(days: number): Promise<{
    best_product: string;
    current_annual: number;
    best_annual: number;
    annual_saving: number;
  } | null> {
    const s = this.store();
    if (!s.productCode || !s.tariffCode || !s.mpxn || !s.serial) return null;
    const region = regionFromTariff(s.tariffCode) ?? 'C';
    const d = Math.min(90, Math.max(7, Math.round(Number(days) || 30)));
    const now = new Date();
    const from = new Date(now.getTime() - d * 86_400_000);
    const window = { period_from: from.toISOString(), period_to: now.toISOString() };

    const records = await this.client.consumption(s.fuel, s.mpxn, s.serial, { ...window, order_by: 'period' });
    if (!records.length) return null;

    const prefix = s.fuel === 'electricity' ? 'E-1R' : 'G-1R';
    const candidates: Array<{ name: string; productCode: string; tariffCode: string }> = [
      { name: 'Current', productCode: s.productCode, tariffCode: s.tariffCode },
    ];
    if (s.fuel === 'electricity') {
      for (const [label, frag] of [['Agile', 'agile'], ['Go', 'go'], ['Flexible', 'flexible']]) {
        // eslint-disable-next-line no-await-in-loop
        const code = await this.client.findProductCode(frag);
        if (code && code !== s.productCode) {
          candidates.push({ name: label, productCode: code, tariffCode: `${prefix}-${code}-${region}` });
        }
      }
    }

    const results: Array<{ name: string; annual: number }> = [];
    for (const c of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const [rates, standing] = await Promise.all([
          this.client.standardUnitRates(s.fuel, c.productCode, c.tariffCode, window),
          this.client.standingCharges(s.fuel, c.productCode, c.tariffCode, window),
        ]);
        if (!rates.length) continue;
        const sc = rateAt(standing) ?? standing[0];
        const standingPence = sc ? valueOf(sc, this.vatInc()) : 0;
        results.push({ name: c.name, annual: estimateAnnualCost(records, rates, standingPence, this.vatInc()) });
      } catch (err) {
        this.error(`Tariff comparison failed for ${c.name}:`, err);
      }
    }
    if (!results.length) return null;

    const current = results.find((r) => r.name === 'Current');
    const best = results.reduce((a, b) => (b.annual < a.annual ? b : a));
    const currentAnnual = current ? current.annual : best.annual;
    return {
      best_product: best.name === 'Current' ? 'Current tariff (already cheapest)' : best.name,
      current_annual: Number(currentAnnual.toFixed(2)),
      best_annual: Number(best.annual.toFixed(2)),
      annual_saving: Number((currentAnnual - best.annual).toFixed(2)),
    };
  }

  /** Local midnight `daysFromNow` days away (approximate; ignores DST shifts). */
  protected localMidnight(daysFromNow: number): Date {
    const nextMidnight = this.nextLocalTime('00:00'); // next 00:00 (tomorrow)
    return new Date(nextMidnight.getTime() + (daysFromNow - 1) * 86_400_000);
  }

  /** Start of the current local month (approximate). */
  protected localMonthStart(): Date {
    const tz = this.homey.clock.getTimezone();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, day: '2-digit', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date());
    const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');
    // Midnight that began today, then step back to the 1st.
    const todayMidnight = this.localMidnight(0);
    return new Date(todayMidnight.getTime() - (day - 1) * 86_400_000);
  }

  /** Compute today's price min/max/avg and the next half-hour price. */
  protected async refreshPriceStats(): Promise<void> {
    if (!this.hasCapability('octopus_price_avg_today')) return;
    const todays = ratesInWindow(this.rates, this.localMidnight(0), this.localMidnight(1))
      .map((r) => valueOf(r, this.vatInc()));
    if (todays.length) {
      const min = Math.min(...todays);
      const max = Math.max(...todays);
      const avg = todays.reduce((a, b) => a + b, 0) / todays.length;
      await this.setCapabilityValue('octopus_price_min_today', Number(min.toFixed(2))).catch(this.error);
      await this.setCapabilityValue('octopus_price_max_today', Number(max.toFixed(2))).catch(this.error);
      await this.setCapabilityValue('octopus_price_avg_today', Number(avg.toFixed(2))).catch(this.error);
    }
    if (this.hasCapability('octopus_price_next')) {
      const next = rateAt(this.rates, new Date(Date.now() + 30 * 60_000));
      if (next) {
        await this.setCapabilityValue('octopus_price_next', Number(valueOf(next, this.vatInc()).toFixed(2))).catch(this.error);
      }
    }
  }

  /** Compute month-to-date and projected monthly cost (incl. standing charge). */
  protected async refreshMonthlyCost(): Promise<void> {
    if (!this.hasCapability('octopus_cost_month')) return;
    const s = this.store();
    if (!s.mpxn || !s.serial || !s.productCode || !s.tariffCode) return;

    const now = new Date();
    const monthStart = this.localMonthStart();
    const [records, rates] = await Promise.all([
      this.client.consumption(s.fuel, s.mpxn, s.serial, {
        period_from: monthStart.toISOString(),
        period_to: now.toISOString(),
        order_by: 'period',
      }),
      this.client.standardUnitRates(s.fuel, s.productCode, s.tariffCode, {
        period_from: monthStart.toISOString(),
        period_to: now.toISOString(),
      }),
    ]);
    if (!records.length) return;

    let pence = 0;
    for (const r of records) {
      const rate = rateAt(rates, new Date(r.interval_start));
      if (rate) pence += this.toEnergyUnit(r.consumption) * valueOf(rate, this.vatInc());
    }
    if (this.includeStandingChargeInCost()) {
      const sc = rateAt(this.standingRates) ?? this.standingRates[0];
      const days = Math.ceil((now.getTime() - monthStart.getTime()) / 86_400_000);
      if (sc) pence += valueOf(sc, this.vatInc()) * Math.max(1, days);
    }
    const cost = pence / 100;
    await this.setCapabilityValue('octopus_cost_month', Number(cost.toFixed(2))).catch(this.error);

    if (this.hasCapability('octopus_cost_projected')) {
      const elapsed = Math.max(0.5, (now.getTime() - monthStart.getTime()) / 86_400_000);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const projected = (cost / elapsed) * daysInMonth;
      await this.setCapabilityValue('octopus_cost_projected', Number(projected.toFixed(2))).catch(this.error);
    }
  }

  protected async refreshStandingCharge(): Promise<void> {
    if (!this.hasCapability('octopus_standing_charge')) return;
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
      const threshold = Number(this.homey.settings.get('low_balance_threshold') ?? 0);
      if (prev >= threshold && balance < threshold && this.notifyEnabled('notify_low_balance', false)) {
        await this.notify(`💷 Your Octopus balance is low: £${balance.toFixed(2)}`);
      }
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
    this.scheduleAgilePublication();
  }

  /** Refresh shortly after 16:05 daily, when Agile publishes next-day prices. */
  private scheduleAgilePublication(): void {
    const tick = () => {
      this.refresh().catch((err) => this.error('Agile-publication refresh failed:', err));
      this.agileTimer = this.homey.setTimeout(tick, this.nextLocalTime('16:05').getTime() - Date.now());
    };
    this.agileTimer = this.homey.setTimeout(tick, this.nextLocalTime('16:05').getTime() - Date.now());
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
    if (this.agileTimer) {
      this.homey.clearTimeout(this.agileTimer);
      this.agileTimer = null;
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
