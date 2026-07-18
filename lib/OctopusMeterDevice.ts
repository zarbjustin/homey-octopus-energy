'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType } from './OctopusClient';
import { KrakenClient } from './KrakenClient';
import {
  Rate, rateAt, valueOf, sumConsumption, cheapestRate, cheapestWindow,
  isCheapestSlotNow, priceLevel, PriceLevel, cheapestSlots, rateCovers, ratesInWindow,
  regionFromTariff, isTwoRegister, expensiveWindow, ConsumptionRecord,
} from './rates';
import { daysSpanned, estimateAnnualCost } from './compare';

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

export interface RefreshHealthDecision {
  alarm: boolean;
  fullyHealthy: boolean;
  markAvailable: boolean;
  markUnavailable: boolean;
  message: string | null;
  authenticationFailure: boolean;
}

/** Convert refresh results into stable Homey availability behaviour. */
export function refreshHealthDecision(
  anySucceeded: boolean,
  priceSucceeded: boolean,
  hasTariff: boolean,
  consecutiveTotalFailures: number,
  err: unknown,
): RefreshHealthDecision {
  const fullyHealthy = anySucceeded && (priceSucceeded || !hasTariff);
  if (fullyHealthy) {
    return {
      alarm: false,
      fullyHealthy: true,
      markAvailable: true,
      markUnavailable: false,
      message: null,
      authenticationFailure: false,
    };
  }

  const raw = err instanceof Error ? err.message : String(err ?? '');
  const authenticationFailure = /401|authenticat|api key/i.test(raw);
  let message = 'Octopus Energy is temporarily unavailable.';
  if (authenticationFailure) {
    message = 'Authentication failed - repair the device to update your API key.';
  } else if (/no (?:current )?.*rate|no rate covering|404|not found/i.test(raw)) {
    message = 'Current tariff price is temporarily unavailable.';
  }

  return {
    alarm: true,
    fullyHealthy: false,
    markAvailable: anySucceeded && !authenticationFailure,
    markUnavailable: authenticationFailure || (!anySucceeded && consecutiveTotalFailures >= 3),
    message,
    authenticationFailure,
  };
}

/** A single half-hourly Agile slot, shaped for the prices widget. */
export interface AgileSlot {
  start: string;
  end: string | null;
  label: string;
  price: number;
  level: PriceLevel;
  current: boolean;
  cheapest: boolean;
}

/** Today/tomorrow Agile data for the prices widget. */
export interface AgileDayData {
  unit: string;
  vat: boolean;
  currentPrice: number | null;
  currentLevel: PriceLevel | null;
  currentStart: string | null;
  today: AgileSlot[];
  tomorrow: AgileSlot[];
  tomorrowAvailable: boolean;
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

  protected nightRates: Rate[] = [];

  protected standingRates: Rate[] = [];

  protected currentPrice: number | null = null;

  protected currentBalance: number | null = null;

  private previousUsage: number | null = null;

  private previousCostToday: number | null = null;

  private previousStanding: number | null = null;

  private refreshTimer: NodeJS.Timeout | null = null;

  private refreshing = false;

  private refreshPromise: Promise<void> | null = null;

  /** Epoch ms when the current refresh began, for the stuck-lock watchdog. */
  private refreshStartedAt = 0;

  private lastTariffCheck = 0;

  private lastStandingRefresh = 0;

  private lastMonthlyRefresh = 0;

  private lastPointsRefresh = 0;

  private notified401 = false;

  private consecutiveTotalFailures = 0;

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

  /** Upcoming half-hourly prices (VAT per setting) for the next `hours`. */
  getUpcomingPrices(hours = 12): Array<{ start: string; price: number }> {
    const now = Date.now();
    const to = new Date(now + hours * 3600_000);
    const from = new Date(now - 30 * 60_000);
    return ratesInWindow(this.rates, from, to).map((r) => ({
      start: r.valid_from,
      price: Number(valueOf(r, this.vatInc()).toFixed(2)),
    }));
  }

  /** The current unit rate value (p/kWh), VAT per the device setting. */
  getCurrentPrice(): number | null {
    return this.currentPrice;
  }

  /**
   * Structured half-hourly Agile data for today and tomorrow, used by the Agile
   * prices widget. Slots are timezone-aware and flagged for the current slot and
   * the cheapest `cheapestCount` slots of each day ("best times to use power").
   * Tomorrow is empty until Agile prices publish (typically ~16:00 UK time).
   */
  getAgileDayData(cheapestCount = 6): AgileDayData {
    const inc = this.vatInc();
    const th = this.thresholds();
    const current = rateAt(this.rates, new Date());
    const currentStart = current ? current.valid_from : null;

    const build = (from: Date, to: Date): AgileSlot[] => {
      const slots = ratesInWindow(this.rates, from, to);
      const cheap = new Set(
        cheapestSlots(slots, cheapestCount, { incVat: inc }).map((r) => r.valid_from),
      );
      return slots.map((r) => {
        const price = Number(valueOf(r, inc).toFixed(2));
        return {
          start: r.valid_from,
          end: r.valid_to,
          label: this.hourMinuteLabel(new Date(r.valid_from)),
          price,
          level: priceLevel(price, th),
          current: currentStart === r.valid_from,
          cheapest: cheap.has(r.valid_from),
        };
      });
    };

    const today = build(this.localMidnight(0), this.localMidnight(1));
    const tomorrow = build(this.localMidnight(1), this.localMidnight(2));
    return {
      unit: 'p/kWh',
      vat: inc,
      currentPrice: this.currentPrice,
      currentLevel: current ? priceLevel(Number(valueOf(current, inc).toFixed(2)), th) : null,
      currentStart,
      today,
      tomorrow,
      // A published Agile day has 48 half-hours; treat a near-full day as available.
      tomorrowAvailable: tomorrow.length >= 24,
    };
  }

  /**
   * Return Agile widget data, refreshing first when cached rates no longer cover
   * the current day/current half-hour. This prevents stale overnight caches from
   * rendering an empty widget until the next scheduled poll.
   */
  async getFreshAgileDayData(cheapestCount = 6): Promise<AgileDayData> {
    let data = this.getAgileDayData(cheapestCount);
    if (data.today.length > 0 && data.currentStart) return data;

    await this.refresh();
    data = this.getAgileDayData(cheapestCount);
    if (data.today.length === 0 || !data.currentStart) {
      throw new Error('No current price data yet.');
    }
    return data;
  }

  /** Local HH:MM label for an instant, in the Homey timezone. */
  private hourMinuteLabel(d: Date): string {
    const tz = this.homey.clock.getTimezone();
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(d);
  }

  /**
   * Re-build the API clients from the (just-updated) stored credentials and
   * refresh. Called after a repair so a new API key takes effect immediately
   * without restarting the app.
   */
  async applyCredentials(nextStore?: MeterStore): Promise<void> {
    // Avoid allowing an older refresh to overwrite values fetched with the new
    // account credentials after Repair completes.
    if (this.refreshPromise) {
      await this.refreshPromise.catch((err) => this.error('Refresh before repair failed:', err));
    }
    if (nextStore) {
      for (const [key, value] of Object.entries(nextStore)) {
        // eslint-disable-next-line no-await-in-loop
        await this.setStoreValue(key, value);
      }
    }

    this.rates = [];
    this.nightRates = [];
    this.standingRates = [];
    this.currentPrice = null;
    this.currentBalance = null;
    this.previousUsage = null;
    this.previousCostToday = null;
    this.previousStanding = null;
    this.lastTariffCheck = 0;
    this.lastStandingRefresh = 0;
    this.lastMonthlyRefresh = 0;
    this.lastPointsRefresh = 0;
    this.notified401 = false;
    this.consecutiveTotalFailures = 0;

    this.buildClients();
    await this.onCredentialsApplied();
    await this.ensureRegisterCapabilities().catch((err) => this.error(err));
    await this.refresh().catch((err) => this.error('Refresh after repair failed:', err));
  }

  /** Hook for subclasses to clear credential-scoped state after Repair. */
  protected async onCredentialsApplied(): Promise<void> {
    // no-op by default
  }

  getCurrentRate(at: Date = new Date()): Rate | null {
    return rateAt(this.rates, at);
  }

  /** Start planning at the beginning of the active slot so "now" remains eligible. */
  protected planningWindowStart(at: Date = new Date()): Date {
    const current = rateAt(this.rates, at);
    return current ? new Date(current.valid_from) : at;
  }

  // --- Refresh -------------------------------------------------------------

  /** Refresh prices, standing charge and balance. Subclasses extend this. */
  protected async refresh(): Promise<void> {
    if (this.refreshPromise) {
      // Watchdog: if a previous refresh somehow never released the lock (e.g. a
      // hung await that escaped the per-request timeouts), don't freeze forever.
      if (Date.now() - this.refreshStartedAt < 90_000) {
        return this.refreshPromise;
      }
      this.error('Refresh lock stuck > 90s — forcing reset.');
      this.refreshPromise = null;
      this.refreshing = false;
    }
    this.refreshing = true;
    this.refreshStartedAt = Date.now();
    const promise = this.runRefresh()
      .finally(() => {
        // A watchdog replacement may now own the lock; an older refresh must
        // not clear the newer generation when it eventually settles.
        if (this.refreshPromise === promise) {
          this.refreshing = false;
          this.refreshPromise = null;
        }
      });
    this.refreshPromise = promise;
    return promise;
  }

  private async runRefresh(): Promise<void> {
    let ok = false;
    let priceOk = false;
    let firstErr: unknown = null;
    const run = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        ok = true;
        return true;
      } catch (err) {
        if (!firstErr) firstErr = err;
        this.error(`${label} failed:`, err);
        return false;
      }
    };

    [priceOk] = await Promise.all([
      run('Price refresh', () => this.refreshPricesWithTariffRecovery()),
      run('Standing-charge refresh', () => this.refreshStandingCharge()),
      run('Balance refresh', () => this.refreshBalance()),
    ]);
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
    try {
      await this.refreshPoints();
    } catch (err) {
      this.error('Points refresh failed:', err);
    }
    try {
      await this.checkTariffChange();
    } catch (err) {
      this.error('Tariff-change check failed:', err);
    }

    await this.setHealth(ok, priceOk, firstErr);
  }

  /** Periodically re-check the account's active tariff and alert on a change. */
  protected async checkTariffChange(force = false): Promise<boolean> {
    const s = this.store();
    if (!s.accountNumber || !s.mpxn) return false;
    const now = Date.now();
    if (!force && now - this.lastTariffCheck < 12 * 3600_000) return false;
    const meters = await this.client.discoverMeters(s.accountNumber);
    this.lastTariffCheck = now;
    const match = meters.find((m) => m.mpxn === s.mpxn && m.serial === s.serial
      && m.fuel === s.fuel && m.isExport === s.isExport);
    if (match && match.tariffCode && match.tariffCode !== s.tariffCode) {
      const oldT = s.tariffCode ?? 'unknown';
      await this.setStoreValue('tariffCode', match.tariffCode);
      await this.setStoreValue('productCode', match.productCode);
      this.lastStandingRefresh = 0;
      this.lastMonthlyRefresh = 0;
      await this.ensureRegisterCapabilities().catch((err) => this.error(err));
      const state = { deviceId: this.getData().id, old: oldT, new: match.tariffCode };
      this.fireAppTrigger('tariff_changed', { old: oldT, new: match.tariffCode }, state);
      if (this.notifyEnabled('notify_tariff_change', true)) {
        await this.notify(`🐙 Your ${s.fuel} tariff changed to ${match.tariffCode}.`);
      }
      return true;
    }
    return false;
  }

  /** Re-discover a changed tariff and retry a price failure once. */
  private async refreshPricesWithTariffRecovery(): Promise<void> {
    try {
      await this.refreshPrices();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      if (!/no (?:current )?.*rate|no rate covering|404|not found/i.test(message)) throw err;
      const changed = await this.checkTariffChange(true);
      if (!changed) throw err;
      this.log('Tariff changed during price refresh; retrying with the active tariff.');
      await this.refreshPrices();
    }
  }

  /** Reflect refresh success/failure on the connection alarm and availability. */
  private async setHealth(ok: boolean, priceOk: boolean, err: unknown): Promise<void> {
    this.consecutiveTotalFailures = ok ? 0 : this.consecutiveTotalFailures + 1;
    const decision = refreshHealthDecision(
      ok,
      priceOk,
      Boolean(this.store().productCode),
      this.consecutiveTotalFailures,
      err,
    );
    if (this.hasCapability('alarm_generic')) {
      await this.setCapabilityValue('alarm_generic', decision.alarm).catch(this.error);
    }
    if (decision.fullyHealthy) {
      this.notified401 = false;
      if (this.hasCapability('octopus_updated')) {
        await this.setCapabilityValue('octopus_updated', this.formatLocal(new Date())).catch(this.error);
      }
      if (!this.getAvailable()) await this.setAvailable().catch(this.error);
    } else if (decision.markUnavailable) {
      if (decision.authenticationFailure && !this.notified401 && this.notifyEnabled('notify_auth', true)) {
        this.notified401 = true;
        await this.notify('🐙 Octopus authentication failed — repair the device to update your API key.');
      }
      await this.setUnavailable(decision.message ?? 'Octopus Energy is temporarily unavailable.').catch(this.error);
    } else if (decision.markAvailable && !this.getAvailable()) {
      await this.setAvailable().catch(this.error);
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
      if (this.previousUsage !== null && usage !== this.previousUsage) {
        this.fireAppTrigger('usage_today_above', { usage }, {
          deviceId: this.getData().id, usage, previous: this.previousUsage,
        });
      }
      this.previousUsage = usage;
    }

    if (hasCost) {
      let pence = 0;
      for (const r of last48) {
        const rate = this.rateForRecord(r.interval_start, this.rates, this.nightRates);
        if (rate) pence += this.toEnergyUnit(r.consumption) * valueOf(rate, this.vatInc());
      }
      if (this.includeStandingChargeInCost()) {
        const sc = rateAt(this.standingRates) ?? this.standingRates[0];
        if (sc) pence += valueOf(sc, this.vatInc());
      }
      const cost = Number((pence / 100).toFixed(2));
      await this.setCapabilityValue(costCap, cost).catch(this.error);
      if (costCap === 'octopus_cost_today' && this.previousCostToday !== null && cost !== this.previousCostToday) {
        this.fireAppTrigger('cost_today_above', { cost }, {
          deviceId: this.getData().id, cost, previous: this.previousCostToday,
        });
      }
      this.previousCostToday = cost;
    }

    if (hasMeter) {
      // Re-read the cursor immediately before the read-modify-write to stay
      // correct; write the cursor before the total so an interrupted write
      // under-counts (loses a delta) rather than double-counting.
      const persistedEnd: string | null = this.getStoreValue('lastConsumptionEnd');
      const lastEnd = persistedEnd ? new Date(persistedEnd).getTime() : 0;
      const fresh = sorted.filter((r) => new Date(r.interval_end).getTime() > lastEnd);
      if (fresh.length) {
        const add = this.toMeterUnit(sumConsumption(fresh));
        const cumulative = Number(((Number(this.getStoreValue('cumulativeMeter')) || 0) + add).toFixed(3));
        await this.setStoreValue('lastConsumptionEnd', sorted[sorted.length - 1].interval_end);
        await this.setStoreValue('cumulativeMeter', cumulative);
        await this.setCapabilityValue(meterCap as string, cumulative).catch(this.error);
      } else if (this.getStoreValue('cumulativeMeter') != null) {
        await this.setCapabilityValue(meterCap as string, Number(this.getStoreValue('cumulativeMeter'))).catch(this.error);
      }
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

  private parseHM(s: string): number {
    const [h, m] = String(s).split(':').map((v) => Number(v));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }

  /** Whether the local time of an ISO instant falls in the Economy 7 night window. */
  protected isNightTime(iso: string): boolean {
    const tz = this.homey.clock.getTimezone();
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso))) parts[p.type] = p.value;
    const mins = Number(parts.hour) * 60 + Number(parts.minute);
    const start = this.parseHM(String(this.getSetting('night_start') || '00:30'));
    const end = this.parseHM(String(this.getSetting('night_end') || '07:30'));
    return start <= end ? (mins >= start && mins < end) : (mins >= start || mins < end);
  }

  /**
   * Pick the unit rate applicable to a consumption record, honouring Economy 7
   * day/night registers when the tariff is two-register.
   */
  protected rateForRecord(iso: string, dayRates: Rate[], nightRates: Rate[]): Rate | null {
    if (this.isTwoRegisterTariff() && nightRates.length && this.isNightTime(iso)) {
      return rateAt(nightRates, new Date(iso)) ?? nightRates[0];
    }
    return rateAt(dayRates, new Date(iso));
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

    let rates = await this.client.standardUnitRates(
      s.fuel,
      s.productCode,
      s.tariffCode,
      this.periodWindow(),
    );
    let current = rateAt(rates);
    if (!current) {
      const latest = await this.client.latestStandardUnitRates(s.fuel, s.productCode, s.tariffCode);
      const fallback = rateAt(latest);
      if (fallback) {
        rates = latest;
        current = fallback;
      }
    }
    this.rates = rates;
    await this.onRatesUpdated();
    if (!current) throw new Error('Octopus returned no rate covering the current time.');
    const value = Number(valueOf(current, this.vatInc()).toFixed(4));
    this.currentPrice = value;
    await this.setCapabilityValue('measure_octopus_price', value).catch(this.error);
    await this.onPriceUpdated(value, current);
  }

  /** Economy 7 / two-register tariffs: fetch separate day and night unit rates. */
  protected async refreshTwoRegisterPrices(productCode: string, tariffCode: string): Promise<void> {
    let [day, night] = await Promise.all([
      this.client.registerUnitRates('day', productCode, tariffCode, this.periodWindow()),
      this.client.registerUnitRates('night', productCode, tariffCode, this.periodWindow()),
    ]);
    let dayRate = rateAt(day);
    let nightRate = rateAt(night);
    if (!dayRate || !nightRate) {
      [day, night] = await Promise.all([
        this.client.latestRegisterUnitRates('day', productCode, tariffCode),
        this.client.latestRegisterUnitRates('night', productCode, tariffCode),
      ]);
      dayRate = rateAt(day);
      nightRate = rateAt(night);
    }
    // Use the day rates for the headline price and cost approximation; the exact
    // day/night switch time is region-specific and set via device settings.
    this.rates = day;
    this.nightRates = night;
    await this.onRatesUpdated();
    if (!dayRate || !nightRate) {
      throw new Error('Octopus returned no current day/night register rate.');
    }
    if (dayRate && this.hasCapability('octopus_price_day')) {
      await this.setCapabilityValue('octopus_price_day', Number(valueOf(dayRate, this.vatInc()).toFixed(2))).catch(this.error);
    }
    if (nightRate && this.hasCapability('octopus_price_night')) {
      await this.setCapabilityValue('octopus_price_night', Number(valueOf(nightRate, this.vatInc()).toFixed(2))).catch(this.error);
    }
    const currentRate = this.isNightTime(new Date().toISOString()) ? nightRate : dayRate;
    const value = Number(valueOf(currentRate, this.vatInc()).toFixed(4));
    this.currentPrice = value;
    await this.setCapabilityValue('measure_octopus_price', value).catch(this.error);
    await this.onPriceUpdated(value, currentRate);
  }

  /** Hook fired after the current price capability is set (Flow triggers etc.). */
  protected async onPriceUpdated(value: number, _rate: Rate): Promise<void> {
    if (this.hasCapability('octopus_price_level')) {
      const level = priceLevel(value, this.thresholds());
      await this.setCapabilityValue('octopus_price_level', level).catch(this.error);
    }
  }

  /** Hook fired after this.rates is replaced (subclasses detect new-rate horizons). */
  protected async onRatesUpdated(): Promise<void> {
    // no-op by default
  }

  /** The furthest-ahead instant covered by the cached rates (ms), or 0. */
  ratesHorizon(): number {
    let max = 0;
    for (const r of this.rates) {
      const end = r.valid_to ? new Date(r.valid_to).getTime() : new Date(r.valid_from).getTime() + 1800_000;
      if (end > max) max = end;
    }
    return max;
  }

  /** Cheapest / most expensive upcoming rate values (p/kWh) for tonight tokens. */
  upcomingExtremes(): { cheapest: number; cheapestStart: string; expensive: number } | null {
    const now = Date.now();
    const fwd = this.rates.filter((r) => {
      const end = r.valid_to ? new Date(r.valid_to).getTime() : Infinity;
      return end > now;
    });
    if (!fwd.length) return null;
    let cheapest = fwd[0];
    let expensive = fwd[0];
    for (const r of fwd) {
      if (valueOf(r, this.vatInc()) < valueOf(cheapest, this.vatInc())) cheapest = r;
      if (valueOf(r, this.vatInc()) > valueOf(expensive, this.vatInc())) expensive = r;
    }
    return {
      cheapest: Number(valueOf(cheapest, this.vatInc()).toFixed(2)),
      cheapestStart: this.formatLocal(new Date(cheapest.valid_from)),
      expensive: Number(valueOf(expensive, this.vatInc()).toFixed(2)),
    };
  }

  /** Is the current price within the cheapest `percent`% of the next `hours`? */
  isInCheapestPercentile(percent: number, hours: number, at: Date = new Date()): boolean {
    const current = rateAt(this.rates, at);
    if (!current) return false;
    const to = new Date(at.getTime() + hours * 3600_000);
    const window = ratesInWindow(this.rates, this.planningWindowStart(at), to)
      .map((r) => valueOf(r, this.vatInc()))
      .sort((a, b) => a - b);
    if (!window.length) return false;
    const cv = valueOf(current, this.vatInc());
    const rank = window.filter((v) => v <= cv).length; // 1-based count at/below current
    const pct = (rank / window.length) * 100;
    return pct <= Math.max(0, Math.min(100, percent));
  }

  /** Local time string for the start of the next smart-charge slot, or null. */
  nextChargeStart(durationHours: number, byTime: string, maxPrice?: number): string | null {
    const plan = this.getCheapestPlan(durationHours, byTime, maxPrice);
    const now = Date.now();
    const upcoming = plan.find((r) => new Date(r.valid_from).getTime() >= now)
      ?? plan.find((r) => rateCovers(r, new Date()));
    return upcoming ? this.formatLocal(new Date(upcoming.valid_from)) : null;
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
    return cheapestWindow(this.rates, slots, {
      from: this.planningWindowStart(now), to, incVat: this.vatInc(),
    });
  }

  /** Is the current half-hour the cheapest in the (optional) forward window? */
  isCheapestNow(withinHours?: number, at: Date = new Date()): boolean {
    return isCheapestSlotNow(this.rates, at, { withinHours, incVat: this.vatInc() });
  }

  /** Public entry point for the "refresh now" Flow action. */
  async refreshNow(): Promise<void> {
    await this.refresh();
  }

  /** Trigger an immediate EV bump charge (Intelligent Octopus Go; experimental). */
  async bumpCharge(): Promise<void> {
    const { accountNumber } = this.store();
    if (!accountNumber) throw new Error('No account number stored.');
    await this.kraken.triggerBoostCharge(accountNumber);
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
  findCheapestHours(durationHours: number, byTime: string, maxPrice?: number): { count: number; first_start: string; price: number; saving_pct: number } | null {
    const plan = this.getCheapestPlan(durationHours, byTime, maxPrice);
    if (!plan.length) return null;
    const avg = plan.reduce((acc, r) => acc + valueOf(r, this.vatInc()), 0) / plan.length;
    const window = ratesInWindow(this.rates, new Date(), this.nextLocalTime(byTime))
      .map((r) => valueOf(r, this.vatInc()));
    const dayAvg = window.length ? window.reduce((a, b) => a + b, 0) / window.length : avg;
    const savingPct = dayAvg > 0 ? ((dayAvg - avg) / dayAvg) * 100 : 0;
    return {
      count: plan.length,
      first_start: this.formatLocal(new Date(plan[0].valid_from)),
      price: Number(avg.toFixed(2)),
      saving_pct: Number(savingPct.toFixed(0)),
    };
  }

  /**
   * Find the most expensive contiguous block of `durationHours` within
   * `withinHours` — for exports, the best time to sell. Returns start + avg price.
   */
  findPeakSlot(withinHours: number, durationHours: number): { start_time: string; price: number } | null {
    const slots = Math.max(1, Math.round(Number(durationHours) * 2));
    const now = new Date();
    const to = withinHours ? new Date(now.getTime() + withinHours * 3600_000) : undefined;
    const win = expensiveWindow(this.rates, slots, {
      from: this.planningWindowStart(now), to, incVat: this.vatInc(),
    });
    if (!win || !win.length) return null;
    const avg = win.reduce((a, r) => a + valueOf(r, this.vatInc()), 0) / win.length;
    return { start_time: this.formatLocal(new Date(win[0].valid_from)), price: Number(avg.toFixed(2)) };
  }

  /** Is `at` within the most expensive `durationHours` block of the next `withinHours`? */
  isPeakNow(withinHours: number, durationHours: number, at: Date = new Date()): boolean {
    const slots = Math.max(1, Math.round(Number(durationHours) * 2));
    const to = withinHours ? new Date(at.getTime() + withinHours * 3600_000) : undefined;
    const win = expensiveWindow(this.rates, slots, {
      from: this.planningWindowStart(at), to, incVat: this.vatInc(),
    });
    if (!win || !win.length) return false;
    const start = new Date(win[0].valid_from).getTime();
    const lastTo = win[win.length - 1].valid_to;
    const end = lastTo ? new Date(lastTo).getTime() : Infinity;
    return at.getTime() >= start && at.getTime() < end;
  }

  /**
   * Carbon-weighted "green charge" plan: pick the half-hours before `byTime`
   * that minimise a blend of price and carbon intensity, biased by `greenness`
   * (0 = price only, 1 = carbon-heavy). Returns count, first start, avg price/carbon.
   */
  planGreenCharge(neededKwh: number, chargeRateKw: number, byTime: string, greenness = 0.5): {
    count: number; first_start: string; price: number; carbon: number;
  } | null {
    const energyPerSlot = Math.max(0.01, Number(chargeRateKw) * 0.5);
    const slots = Math.max(1, Math.ceil(Number(neededKwh) / energyPerSlot));
    const now = new Date();
    const to = this.nextLocalTime(byTime);
    const carbon = this.carbonForecastForWeighting();
    const pool = ratesInWindow(this.rates, this.planningWindowStart(now), to);
    if (pool.length < slots) return null;
    const g = Math.min(1, Math.max(0, Number(greenness)));
    const carbonAt = (start: string): number => {
      const t = new Date(start).getTime();
      const point = carbon.find((c) => new Date(c.from).getTime() <= t && t < new Date(c.to).getTime());
      return point ? point.intensity : 150; // neutral default
    };
    const scored = pool.map((r) => ({
      rate: r,
      score: (1 - g) * valueOf(r, this.vatInc()) + g * (carbonAt(r.valid_from) / 10),
    }));
    scored.sort((a, b) => a.score - b.score);
    const chosen = scored.slice(0, slots).map((s) => s.rate);
    if (!chosen.length) return null;
    const avgPrice = chosen.reduce((a, r) => a + valueOf(r, this.vatInc()), 0) / chosen.length;
    const avgCarbon = chosen.reduce((a, r) => a + carbonAt(r.valid_from), 0) / chosen.length;
    const sorted = chosen.sort((a, b) => new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime());
    return {
      count: sorted.length,
      first_start: this.formatLocal(new Date(sorted[0].valid_from)),
      price: Number(avgPrice.toFixed(2)),
      carbon: Math.round(avgCarbon),
    };
  }

  /** Carbon forecast for weighting; overridden by the electricity device. */
  protected carbonForecastForWeighting(): Array<{ from: string; to: string; intensity: number }> {
    return [];
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
    const now = new Date();
    const [th, tm] = hhmm.split(':').map((v) => Number(v));
    const hour = Number.isFinite(th) ? Math.min(23, Math.max(0, th)) : 7;
    const minute = Number.isFinite(tm) ? Math.min(59, Math.max(0, tm)) : 0;
    const parts = this.localDateParts(now);
    let target = this.zonedTime(parts.year, parts.month, parts.day, hour, minute);
    if (target.getTime() <= now.getTime()) {
      const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
      target = this.zonedTime(
        next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour, minute,
      );
    }
    return target;
  }

  /**
   * The cheapest `durationHours` of half-hours (non-contiguous) between now and
   * the next occurrence of `byTime` (hh:mm). Sorted ascending by time.
   * `maxPrice` (p/kWh) optionally excludes slots above a cap.
   */
  getCheapestPlan(durationHours: number, byTime: string, maxPrice?: number): Rate[] {
    const slots = Math.max(1, Math.round(Number(durationHours) * 2));
    const to = this.nextLocalTime(byTime);
    const now = new Date();
    const plan = cheapestSlots(this.rates, slots, {
      from: this.planningWindowStart(now), to, incVat: this.vatInc(), maxPrice,
    });
    return plan.length === slots ? plan : [];
  }

  /** Is `at` inside the cheapest plan for the given duration/deadline? */
  isInCheapestPlan(durationHours: number, byTime: string, maxPrice?: number, at: Date = new Date()): boolean {
    return this.getCheapestPlan(durationHours, byTime, maxPrice).some((r) => rateCovers(r, at));
  }

  /** A configured price cap (p/kWh) for the smart-charge window, or undefined. */
  protected smartChargeMaxPrice(): number | undefined {
    const v = Number(this.getSetting('smart_charge_max_price'));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }

  /**
   * Plan an EV/battery charge: pick the cheapest half-hours before `byTime` that
   * deliver `neededKwh` at `chargeRateKw`. Returns slot count, first start,
   * average price and estimated cost. `maxPrice` optionally caps slot price.
   */
  planCharge(neededKwh: number, chargeRateKw: number, byTime: string, maxPrice?: number): {
    count: number; first_start: string; price: number; cost: number;
  } | null {
    const energyNeeded = Number(neededKwh);
    const chargeRate = Number(chargeRateKw);
    if (!Number.isFinite(energyNeeded) || energyNeeded <= 0
      || !Number.isFinite(chargeRate) || chargeRate <= 0) return null;
    const energyPerSlot = chargeRate * 0.5;
    const slots = Math.ceil(energyNeeded / energyPerSlot);
    const to = this.nextLocalTime(byTime);
    const chosen = cheapestSlots(this.rates, slots, {
      from: this.planningWindowStart(), to, incVat: this.vatInc(), maxPrice,
    });
    if (chosen.length < slots) return null;
    const avg = chosen.reduce((a, r) => a + valueOf(r, this.vatInc()), 0) / chosen.length;
    let remaining = energyNeeded;
    const byPrice = [...chosen].sort((a, b) => valueOf(a, this.vatInc()) - valueOf(b, this.vatInc()));
    const costPence = byPrice.reduce((cost, rate) => {
      const energy = Math.min(remaining, energyPerSlot);
      remaining -= energy;
      return cost + energy * valueOf(rate, this.vatInc());
    }, 0);
    return {
      count: chosen.length,
      first_start: this.formatLocal(new Date(chosen[0].valid_from)),
      price: Number(avg.toFixed(2)),
      cost: Number((costPence / 100).toFixed(2)),
    };
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

    const candidates: Array<{ name: string; productCode: string; tariffCode: string }> = [
      { name: 'Current', productCode: s.productCode, tariffCode: s.tariffCode },
    ];
    if (s.fuel === 'electricity') {
      for (const [label, frag] of [['Agile', 'agile'], ['Go', 'go'], ['Flexible', 'flexible']]) {
        // eslint-disable-next-line no-await-in-loop
        const code = await this.client.findProductCode(frag);
        if (code && code !== s.productCode) {
          // Agile, Go and Flexible comparison candidates expose a one-register
          // tariff even when the current meter happens to be Economy 7.
          candidates.push({ name: label, productCode: code, tariffCode: `E-1R-${code}-${region}` });
        }
      }
    }

    const results: Array<{ name: string; annual: number }> = [];
    for (const c of candidates) {
      try {
        if (isTwoRegister(c.tariffCode)) {
          // eslint-disable-next-line no-await-in-loop
          const [dayRates, nightRates, standing] = await Promise.all([
            this.client.registerUnitRates('day', c.productCode, c.tariffCode, window),
            this.client.registerUnitRates('night', c.productCode, c.tariffCode, window),
            this.client.standingCharges(s.fuel, c.productCode, c.tariffCode, window),
          ]);
          if (!dayRates.length && !nightRates.length) continue;
          let pence = 0;
          for (const r of records) {
            const rate = this.rateForRecord(r.interval_start, dayRates, nightRates);
            if (rate) pence += this.toEnergyUnit(r.consumption) * valueOf(rate, this.vatInc());
          }
          const sc = rateAt(standing) ?? standing[0];
          const standingPence = sc ? valueOf(sc, this.vatInc()) : 0;
          const days = daysSpanned(records);
          results.push({ name: c.name, annual: (((pence + standingPence * days) / days) * 365) / 100 });
        } else {
          // eslint-disable-next-line no-await-in-loop
          const [rates, standing] = await Promise.all([
            this.client.standardUnitRates(s.fuel, c.productCode, c.tariffCode, window),
            this.client.standingCharges(s.fuel, c.productCode, c.tariffCode, window),
          ]);
          if (!rates.length) continue;
          const sc = rateAt(standing) ?? standing[0];
          const standingPence = sc ? valueOf(sc, this.vatInc()) : 0;
          results.push({ name: c.name, annual: estimateAnnualCost(records, rates, standingPence, this.vatInc()) });
        }
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

  /** Milliseconds offset (local - UTC) for the Homey timezone at instant `date`. */
  private tzOffsetMs(date: Date): number {
    const tz = this.homey.clock.getTimezone();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const map: Record<string, string> = {};
    for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
    const asUtc = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour), Number(map.minute), Number(map.second),
    );
    return asUtc - date.getTime();
  }

  /** Build the UTC instant for a local wall-clock date/time in the Homey timezone. */
  private zonedTime(year: number, month1: number, day: number, hour = 0, minute = 0): Date {
    const utcGuess = Date.UTC(year, month1 - 1, day, hour, minute);
    const offset = this.tzOffsetMs(new Date(utcGuess));
    return new Date(utcGuess - offset);
  }

  /** Local midnight `daysFromNow` days away (DST-safe). */
  protected localMidnight(daysFromNow: number): Date {
    const tz = this.homey.clock.getTimezone();
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date())) parts[p.type] = p.value;
    // Step the calendar date in UTC, then map that local date's midnight back.
    const cal = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
    cal.setUTCDate(cal.getUTCDate() + daysFromNow);
    return this.zonedTime(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate());
  }

  /** Start of the current local month (DST-safe). */
  protected localMonthStart(): Date {
    const tz = this.homey.clock.getTimezone();
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit',
    }).formatToParts(new Date())) parts[p.type] = p.value;
    return this.zonedTime(Number(parts.year), Number(parts.month), 1);
  }

  private localDateParts(date: Date = new Date()): { year: number; month: number; day: number; hour: number; minute: number } {
    const tz = this.homey.clock.getTimezone();
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)) parts[p.type] = p.value;
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
  }

  private daysInLocalMonth(date: Date = new Date()): number {
    const { year, month } = this.localDateParts(date);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  private elapsedLocalMonthDays(date: Date = new Date()): number {
    const { day, hour, minute } = this.localDateParts(date);
    const dayFraction = (hour * 60 + minute) / 1440;
    return Math.max(0.5, (day - 1) + dayFraction);
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

  /** Capability for month-to-date cost (export overrides to earnings). */
  protected monthCostCapability(): string {
    return 'octopus_cost_month';
  }

  /** Capability for projected month cost (export overrides to earnings). */
  protected monthProjectedCapability(): string {
    return 'octopus_cost_projected';
  }

  /** Compute month-to-date and projected monthly cost (incl. standing charge). */
  protected async refreshMonthlyCost(): Promise<void> {
    const monthCap = this.monthCostCapability();
    if (!this.hasCapability(monthCap)) return;
    const s = this.store();
    if (!s.mpxn || !s.serial || !s.productCode || !s.tariffCode) return;
    if (Date.now() - this.lastMonthlyRefresh < 2 * 3600_000) return;

    const now = new Date();
    const monthStart = this.localMonthStart();
    const window = { period_from: monthStart.toISOString(), period_to: now.toISOString() };
    const twoRegister = this.isTwoRegisterTariff();
    const [records, dayRates, nightRates, standingHistory] = await Promise.all([
      this.client.consumption(s.fuel, s.mpxn, s.serial, { ...window, order_by: 'period' }),
      twoRegister
        ? this.client.registerUnitRates('day', s.productCode, s.tariffCode, window)
        : this.client.standardUnitRates(s.fuel, s.productCode, s.tariffCode, window),
      twoRegister
        ? this.client.registerUnitRates('night', s.productCode, s.tariffCode, window)
        : Promise.resolve([] as typeof this.rates),
      this.includeStandingChargeInCost()
        ? this.client.standingCharges(s.fuel, s.productCode, s.tariffCode, window)
        : Promise.resolve([] as typeof this.standingRates),
    ]);
    if (!records.length) return;

    let pence = 0;
    for (const r of records) {
      const rate = this.rateForRecord(r.interval_start, dayRates, nightRates);
      if (rate) pence += this.toEnergyUnit(r.consumption) * valueOf(rate, this.vatInc());
    }
    if (this.includeStandingChargeInCost()) {
      const { year, month, day } = this.localDateParts(now);
      for (let calendarDay = 1; calendarDay <= day; calendarDay++) {
        const sc = rateAt(standingHistory, this.zonedTime(year, month, calendarDay, 12));
        if (sc) pence += valueOf(sc, this.vatInc());
      }
    }
    const cost = pence / 100;
    await this.setCapabilityValue(monthCap, Number(cost.toFixed(2))).catch(this.error);

    const projectedCap = this.monthProjectedCapability();
    if (this.hasCapability(projectedCap)) {
      const elapsed = this.elapsedLocalMonthDays(now);
      const daysInMonth = this.daysInLocalMonth(now);
      const projected = (cost / elapsed) * daysInMonth;
      await this.setCapabilityValue(projectedCap, Number(projected.toFixed(2))).catch(this.error);
    }

    await this.refreshDayBreakdown(records, dayRates, nightRates, standingHistory);
    this.lastMonthlyRefresh = Date.now();
  }

  /** True when the local hour of an instant is in the typical peak window (16:00–19:00). */
  protected isPeakHour(iso: string): boolean {
    const tz = this.homey.clock.getTimezone();
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso))) parts[p.type] = p.value;
    const h = Number(parts.hour);
    return h >= 16 && h < 19;
  }

  /** Calendar-yesterday cost and today's peak/off-peak split (from month data). */
  protected async refreshDayBreakdown(
    records: ConsumptionRecord[], dayRates: Rate[], nightRates: Rate[], standingHistory: Rate[] = [],
  ): Promise<void> {
    const recordCost = (r: ConsumptionRecord): number => {
      const rate = this.rateForRecord(r.interval_start, dayRates, nightRates);
      return rate ? this.toEnergyUnit(r.consumption) * valueOf(rate, this.vatInc()) : 0;
    };

    if (this.hasCapability('octopus_cost_yesterday')) {
      const yStart = this.localMidnight(-1).getTime();
      const yEnd = this.localMidnight(0).getTime();
      let pence = 0;
      for (const r of records) {
        const t = new Date(r.interval_start).getTime();
        if (t >= yStart && t < yEnd) pence += recordCost(r);
      }
      if (this.includeStandingChargeInCost()) {
        const sc = rateAt(standingHistory, new Date(yStart + 12 * 3600_000));
        if (sc) pence += valueOf(sc, this.vatInc());
      }
      await this.setCapabilityValue('octopus_cost_yesterday', Number((pence / 100).toFixed(2))).catch(this.error);
    }

    if (this.hasCapability('octopus_cost_peak_today')) {
      const tStart = this.localMidnight(0).getTime();
      let peak = 0;
      let off = 0;
      for (const r of records) {
        const t = new Date(r.interval_start).getTime();
        if (t < tStart) continue;
        const c = recordCost(r);
        if (this.isPeakHour(r.interval_start)) peak += c; else off += c;
      }
      await this.setCapabilityValue('octopus_cost_peak_today', Number((peak / 100).toFixed(2))).catch(this.error);
      if (this.hasCapability('octopus_cost_offpeak_today')) {
        await this.setCapabilityValue('octopus_cost_offpeak_today', Number((off / 100).toFixed(2))).catch(this.error);
      }
    }
  }

  protected async refreshStandingCharge(): Promise<void> {
    if (!this.hasCapability('octopus_standing_charge')) return;
    const s = this.store();
    if (!s.productCode || !s.tariffCode) return;
    if (this.standingRates.length && Date.now() - this.lastStandingRefresh < 6 * 3600_000) return;
    const charges = await this.client.standingCharges(s.fuel, s.productCode, s.tariffCode);
    this.standingRates = charges;
    this.lastStandingRefresh = Date.now();
    const current = rateAt(charges) ?? charges[0];
    if (current) {
      const value = Number(valueOf(current, this.vatInc()).toFixed(4));
      await this.setCapabilityValue('octopus_standing_charge', value).catch(this.error);
      if (this.previousStanding !== null && value !== this.previousStanding) {
        this.fireAppTrigger('standing_charge_changed', { charge: value }, { deviceId: this.getData().id });
      }
      this.previousStanding = value;
    }
  }

  protected async refreshBalance(): Promise<void> {
    const { apiKey, accountNumber } = this.store();
    if (!apiKey || !accountNumber) return;
    const app = this.homey.app as Homey.App & { getCachedBalance?(a: string, b: string): Promise<number> };
    const raw = app.getCachedBalance
      ? await app.getCachedBalance(apiKey, accountNumber)
      : await this.kraken.getBalance(accountNumber);
    const balance = Number(raw.toFixed(2));
    await this.setCapabilityValue('measure_octopus_balance', balance).catch(this.error);
    const prev = this.currentBalance;
    this.currentBalance = balance;
    if (prev !== null && balance !== prev) {
      const state = { deviceId: this.getData().id, balance, previous: prev };
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

  /** Fetch the Octoplus loyalty points balance (best-effort). */
  protected async refreshPoints(): Promise<void> {
    if (!this.hasCapability('octopus_points')) return;
    const { accountNumber } = this.store();
    if (!accountNumber) return;
    if (Date.now() - this.lastPointsRefresh < 60 * 60_000) return;
    const points = await this.kraken.getOctoplusPoints(accountNumber);
    this.lastPointsRefresh = Date.now();
    if (points !== null) {
      await this.setCapabilityValue('octopus_points', points).catch(this.error);
    }
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

  /** Whether the tariff has half-hourly varying prices (Agile/Go/Flux/Intelligent). */
  protected isDynamicTariff(): boolean {
    const code = `${this.store().productCode ?? ''}`.toUpperCase();
    return /AGILE|FLUX|INTELLI/.test(code) || (/(^|-)GO(-|$)/.test(code));
  }

  private scheduleRefresh(): void {
    this.stopTimers();
    if (!this.isDynamicTariff()) {
      // Flat/fixed tariffs don't change intraday — just poll on the interval.
      this.startInterval();
      return;
    }
    // Start polling immediately so a failed startup refresh retries promptly.
    // Keep an aligned tick that re-fires at EVERY half-hour boundary so the
    // Agile current price rolls within seconds of each new slot (not just once).
    this.startInterval();
    this.scheduleAlignedTick();
    if (/AGILE/i.test(this.store().productCode ?? '')) this.scheduleAgilePublication();
  }

  /**
   * Refresh just after each :00/:30 boundary so the live Agile price rolls
   * promptly, then reschedule for the following boundary. A one-shot timer
   * would only roll the price once and then drift with the coarse poll interval.
   */
  private scheduleAlignedTick(): void {
    const now = new Date();
    const msToHalfHour = (30 - (now.getMinutes() % 30)) * 60_000
      - now.getSeconds() * 1000 - now.getMilliseconds();
    // Fire ~2s after the boundary so the new slot's price is current.
    const delay = Math.max(1000, msToHalfHour) + 2000;
    this.alignTimer = this.homey.setTimeout(() => {
      this.refresh().catch((err) => this.error('Aligned refresh failed:', err));
      this.scheduleAlignedTick();
    }, delay);
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
    if (changedKeys.some((k) => [
      'vat', 'cheap_threshold', 'expensive_threshold', 'smart_charge_hours',
      'smart_charge_by', 'smart_charge_max_price', 'night_start', 'night_end',
      'carbon_region', 'gas_units', 'gas_cv',
    ].includes(k))) {
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
