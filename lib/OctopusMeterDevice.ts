'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType } from './OctopusClient';
import { KrakenClient, AccountIogTariff, IogResolveDiagnostic } from './KrakenClient';
import { isBudgetError } from './KrakenBudget';
import { opaqueKeyMigrating } from './diagnosticsKey';
import {
  Rate, rateAt, valueOf, sumConsumption, cheapestRate, cheapestWindow,
  isCheapestSlotNow, priceLevel, PriceLevel, cheapestSlots, rateCovers, ratesInWindow,
  regionFromTariff, isTwoRegister, expensiveWindow, ConsumptionRecord,
} from './rates';
import { daysSpanned, estimateAnnualCost } from './compare';
import { resolveBillingPeriod } from './billing/period';
import { computeBillingSummary } from './billing/aggregate';
import { DispatchView } from './dispatch/types';
import {
  computeEffectiveRate, EffectiveDispatchKind, EffectiveRateResult,
} from './effectiveRate';
import {
  TieStrategy, createSeededRandom, seedToUint32, selectCheapestWindow,
  selectExpensiveWindow, planEnergy,
} from './planner/tie';
import {
  analysePriceWindow, classifyBand, estimatePlanSavings, RelativeBand,
} from './analytics/priceAnalytics';
import {
  localMidnight as tzLocalMidnight, localMonthStart as tzLocalMonthStart,
  localDateParts as tzLocalDateParts, daysInLocalMonth as tzDaysInLocalMonth,
  elapsedLocalMonthDays as tzElapsedLocalMonthDays, zonedTime as tzZonedTime,
  tzOffsetMs as tzOffset,
} from './timezone';
import { redactSecrets, maskAccount as maskAccountId } from './redact';
import { DeviceScheduler } from './DeviceScheduler';
import { refreshHealthDecision, RefreshHealthDecision } from './health';
import {
  iogUnitRatesToRates, synthesiseIogDayNightRates, isFlatUnitRates, iogFlatDayRate,
  iogHouseholdBands, iogRateTypeSummary,
} from './pricing/iogSchedule';
import { isRecoverablePriceGapError } from './pricing/priceGap';
import { computeCumulativeUpdate } from './consumption/cumulative';
import {
  computeRatesHorizon, computeUpcomingExtremes, isWithinCheapestPercentile,
} from './planning/window';

// Re-exported for backward compatibility with existing importers/tests.
export { refreshHealthDecision };
export type { RefreshHealthDecision };

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

export interface DataFreshness {
  updatedAt: string | null;
  stale: boolean;
  problem: boolean;
}

interface IntegrationDiagnostic {
  lastAttempt: string;
  lastSuccess?: string;
  lastError?: string;
  /** Last time this area was skipped to protect the shared API budget (a soft
   *  retained-value skip, not a fault). */
  lastSkip?: string;
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

  /** Provenance of `this.rates`: REST is settlement-authoritative; the IOG
   *  GraphQL base-schedule fallback is NOT, so finalised prices are only ever
   *  derived when this is 'rest'. */
  protected rateSource: 'rest' | 'iog-fallback' | 'unknown' = 'unknown';

  protected currentBalance: number | null = null;

  private lastBillingRefresh = 0;

  private previousUsage: number | null = null;

  private previousCostToday: number | null = null;

  private previousStanding: number | null = null;

  private scheduler: DeviceScheduler | null = null;

  private refreshing = false;

  private refreshPromise: Promise<void> | null = null;

  /** Epoch ms when the current refresh began, for the stuck-lock watchdog. */
  private refreshStartedAt = 0;

  /** Monotonic refresh generation. Bumped for every NEW refresh, including a
   *  watchdog-forced replacement of a stuck one. A superseded (stale) refresh
   *  compares its captured generation against this to fence off its writes so it
   *  can never overwrite fresher data (notably the cumulative meter). */
  private refreshGeneration = 0;

  /** Serialises cumulative-meter commits so overlapping refreshes cannot
   *  interleave the read-modify-write and double-count. See commitCumulative. */
  private cumulativeCommit: Promise<void> = Promise.resolve();

  private lastTariffCheck = 0;

  /** Epoch ms of the last forced price-gap recovery (rediscovery + variant),
   *  throttled so a persistent gap does not churn REST every refresh. */
  private lastForcedRecoveryAt = 0;

  /** Last identifier-free IOG agreement-resolution summary, for diagnostics. */
  private lastIogResolve: IogResolveDiagnostic | null = null;

  private lastStandingRefresh = 0;

  private lastMonthlyRefresh = 0;

  private lastPointsRefresh = 0;

  private pointsUnsupportedUntil = 0;

  private pointsUnsupportedLogged = false;

  private notified401 = false;

  private consecutiveTotalFailures = 0;

  private lastHealthyRefreshAt = 0;

  private diagnosticUpdates: Record<string, IntegrationDiagnostic> = {};

  async onInit(): Promise<void> {
    this.lastHealthyRefreshAt = Number(this.getStoreValue('lastHealthyRefreshAt')) || 0;
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
    const { apiKey, accountNumber } = this.store();
    this.client = new OctopusClient({ apiKey });
    const app = this.homey.app as Homey.App & {
      getKrakenClient?(key: string, account: string): KrakenClient;
    };
    this.kraken = app.getKrakenClient?.(apiKey, accountNumber) ?? new KrakenClient(apiKey, accountNumber);
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

  /** Widget-safe freshness summary without exposing credentials or raw errors. */
  getDataFreshness(): DataFreshness {
    const pollMinutes = Math.max(5, Number(this.getSetting('poll_interval')) || 30);
    const maxAgeMs = Math.max(20, pollMinutes * 2.5) * 60_000;
    const alarm = this.hasCapability('alarm_generic')
      ? Boolean(this.getCapabilityValue('alarm_generic'))
      : false;
    return {
      updatedAt: this.lastHealthyRefreshAt
        ? new Date(this.lastHealthyRefreshAt).toISOString()
        : null,
      stale: !this.lastHealthyRefreshAt || Date.now() - this.lastHealthyRefreshAt > maxAgeMs,
      problem: alarm,
    };
  }

  /**
   * Widget-safe live demand view derived from the shared Home Mini net reading.
   * The Mini reports a single signed net figure, so import/export are DERIVED
   * (only one is ever non-zero at an instant) and are null (never 0) when the
   * reading is unavailable. Populated only while a device has live power on.
   */
  getLiveDemandView(): {
    netW: number | null; importW: number | null; exportW: number | null;
    state: string; readAt: string | null; source: string | null;
    } {
    const app = this.homey.app as Homey.App & { getLiveDemand?(a: string): { value: number | null; readAt: string | null; source: string; state: string } | null };
    const reading = app.getLiveDemand?.(this.store().accountNumber) ?? null;
    if (!reading || reading.value === null) {
      return {
        netW: null,
        importW: null,
        exportW: null,
        state: reading?.state ?? 'unknown',
        readAt: reading?.readAt ?? null,
        source: reading?.source ?? null,
      };
    }
    const net = reading.value;
    return {
      netW: Math.round(net),
      importW: Math.round(Math.max(net, 0)),
      exportW: Math.round(Math.max(-net, 0)),
      state: reading.state,
      readAt: reading.readAt,
      source: reading.source,
    };
  }

  /** Widget-safe, deviceId-free dispatch snapshot for this device's account. */
  getDispatchView(): unknown {
    const app = this.homey.app as Homey.App & { getDispatchView?(a: string): unknown };
    return app.getDispatchView?.(this.store().accountNumber) ?? null;
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
    const previousStore = this.store();
    if (nextStore) {
      const written: string[] = [];
      try {
        for (const [key, value] of Object.entries(nextStore)) {
          // eslint-disable-next-line no-await-in-loop
          await this.setStoreValue(key, value);
          written.push(key);
        }
      } catch (err) {
        for (const key of written.reverse()) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await this.setStoreValue(key, previousStore[key as keyof MeterStore]);
          } catch (rollbackError) {
            this.error(`Could not roll back repaired store value ${key}:`, rollbackError);
          }
        }
        this.buildClients();
        throw err;
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
    this.lastForcedRecoveryAt = 0;
    this.lastStandingRefresh = 0;
    this.lastMonthlyRefresh = 0;
    this.lastPointsRefresh = 0;
    this.pointsUnsupportedUntil = 0;
    this.pointsUnsupportedLogged = false;
    this.notified401 = false;
    this.consecutiveTotalFailures = 0;
    this.lastHealthyRefreshAt = 0;
    await this.setStoreValue('lastHealthyRefreshAt', 0).catch((err) => this.error(err));

    const app = this.homey.app as Homey.App & { invalidateAccountCaches?(account: string): void };
    if (previousStore.accountNumber) app.invalidateAccountCaches?.(previousStore.accountNumber);
    this.buildClients();
    await this.onCredentialsApplied();
    await this.ensureRegisterCapabilities().catch((err) => this.error(err));
    await this.refresh().catch((err) => this.error('Refresh after repair failed:', err));
  }

  /** Hook for subclasses to clear credential-scoped state after Repair. */
  protected async onCredentialsApplied(): Promise<void> {
    // no-op by default
  }

  /**
   * Quietly adopt a rotated API key on a SIBLING meter after another meter on the
   * same account was repaired: update the stored key and rebuild the clients so the
   * next scheduled refresh uses it — WITHOUT an immediate refresh (avoids a
   * per-sibling budget burst) and without resetting the shared account budget.
   */
  async reloadCredentials(apiKey: string): Promise<void> {
    if (!apiKey || this.store().apiKey === apiKey) return;
    // If the key write fails, do NOT rebuild clients with the stale key (that would
    // recreate the very key-thrash we are fixing); let it reject so the caller's
    // per-sibling try/catch records it and the sibling is retried on next repair.
    await this.setStoreValue('apiKey', apiKey);
    this.buildClients();
    await this.onCredentialsApplied().catch((err) => this.error(err));
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
      // Fall through to start a new generation; the stuck refresh is superseded
      // and its in-flight writes are fenced off by the generation bump below.
    }
    this.refreshing = true;
    this.refreshStartedAt = Date.now();
    // A new generation supersedes any prior (stuck) refresh still settling.
    const generation = ++this.refreshGeneration;
    const promise = this.runRefresh(generation)
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

  /** Whether `generation` has been superseded by a newer refresh (e.g. after a
   *  watchdog-forced reset). Superseded refreshes must not persist their results. */
  protected isStaleRefresh(generation: number): boolean {
    return generation !== this.refreshGeneration;
  }

  private async runRefresh(generation: number): Promise<void> {
    let ok = false;
    let priceOk = false;
    let firstErr: unknown = null;
    const run = async (label: string, area: string, fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        this.recordIntegrationDiagnostic(area);
        ok = true;
        return true;
      } catch (err) {
        this.recordIntegrationDiagnostic(area, err);
        // A budget skip is a deliberate freshness-preserving skip (retain the
        // last value), NOT a fault: don't log it as an error and don't let it
        // affect device health.
        if (isBudgetError(err)) {
          this.log(`${label} skipped to protect the API budget; keeping the last value.`);
          return false;
        }
        if (!firstErr) firstErr = err;
        this.error(`${label} failed:`, err);
        return false;
      }
    };

    [priceOk] = await Promise.all([
      run('Price refresh', 'prices', () => this.refreshPricesWithTariffRecovery()),
      run('Standing-charge refresh', 'standing_charge', () => this.refreshStandingCharge()),
      run('Balance refresh', 'balance', () => this.refreshBalance()),
    ]);
    await run('Extra refresh', 'meter_data', () => this.refreshExtra(generation));
    // Fence: if the watchdog started a newer refresh while this one was in
    // flight, stop before the non-critical reporting writes so this superseded
    // generation cannot overwrite fresher data.
    if (this.isStaleRefresh(generation)) return;
    // Non-critical reporting: failures here do not affect device health.
    await this.runReporting('Price-stats refresh', 'price_stats', () => this.refreshPriceStats());
    await this.runReporting('Monthly-cost refresh', 'monthly_cost', () => this.refreshMonthlyCost());
    await this.runReporting('Billing-summary refresh', 'billing_summary', () => this.refreshBillingSummary());
    await this.runReporting('Points refresh', 'points', () => this.refreshPoints());
    await this.runReporting('Tariff-change check', 'tariff', () => this.checkTariffChange());

    try {
      await this.setHealth(ok, priceOk, firstErr);
    } finally {
      this.flushIntegrationDiagnostics();
    }
  }

  private async runReporting(label: string, area: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
      this.recordIntegrationDiagnostic(area);
    } catch (err) {
      this.recordIntegrationDiagnostic(area, err);
      if (isBudgetError(err)) {
        this.log(`${label} skipped to protect the API budget; keeping the last value.`);
        return;
      }
      this.error(`${label} failed:`, err);
    }
  }

  /** Subclasses use this for integrations they intentionally handle best-effort. */
  protected recordIntegrationDiagnostic(area: string, err?: unknown): void {
    const now = new Date().toISOString();
    const previous = this.diagnosticUpdates[area];
    if (err === undefined) {
      this.diagnosticUpdates[area] = { lastAttempt: now, lastSuccess: now };
    } else if (isBudgetError(err)) {
      // Soft skip: retained the last value to protect the shared budget — not a fault.
      this.diagnosticUpdates[area] = {
        lastAttempt: now, lastSuccess: previous?.lastSuccess, lastSkip: now,
      };
    } else {
      this.diagnosticUpdates[area] = {
        lastAttempt: now,
        lastSuccess: previous?.lastSuccess,
        lastError: this.redactedError(err),
      };
    }
  }

  private redactedError(err: unknown): string {
    const s = this.store();
    return redactSecrets(err, [s.apiKey, s.accountNumber, s.mpxn, s.serial]);
  }

  private flushIntegrationDiagnostics(): void {
    if (!Object.keys(this.diagnosticUpdates).length) return;
    try {
      const key = 'integration_diagnostics_v1';
      const all = (this.homey.settings.get(key) || {}) as Record<string, Record<string, IntegrationDiagnostic>>;
      // Key by a salted opaque id, not the raw `${fuel}-${mpan}-${serial}` device id,
      // so a settings/backup export cannot leak the MPAN/serial. Legacy raw-keyed
      // entries are migrated in place.
      const deviceId = opaqueKeyMigrating(
        this.homey, all as Record<string, unknown>, String(this.getData().id),
      );
      const existing = all[deviceId] || {};
      for (const [area, update] of Object.entries(this.diagnosticUpdates)) {
        if (!update.lastSuccess && existing[area]?.lastSuccess) {
          update.lastSuccess = existing[area].lastSuccess;
        }
      }
      all[deviceId] = { ...existing, ...this.diagnosticUpdates };
      // The `dispatches` area is now owned by DispatchPoller (dispatch_diagnostics_v2);
      // prune any legacy per-device entry so a stale error can't linger in settings.
      delete all[deviceId].dispatches;
      const entries = Object.entries(all);
      if (entries.length > 30) {
        entries
          .sort(([, a], [, b]) => {
            const aTime = Math.max(...Object.values(a).map((v) => Date.parse(v.lastAttempt) || 0));
            const bTime = Math.max(...Object.values(b).map((v) => Date.parse(v.lastAttempt) || 0));
            return bTime - aTime;
          })
          .slice(30)
          .forEach(([id]) => delete all[id]);
      }
      this.homey.settings.set(key, all);
    } catch (err) {
      this.error('Could not persist integration diagnostics:', err);
    } finally {
      this.diagnosticUpdates = {};
    }
  }

  /** Periodically re-check the account's active tariff and alert on a change. */
  protected async checkTariffChange(force = false): Promise<boolean> {
    const s = this.store();
    if (!s.accountNumber || !s.mpxn) return false;
    // IOG household tariff truth comes ONLY from the account's active GraphQL
    // agreement (see maybeAdoptIogAgreement); the REST /accounts view can report
    // a stale code, so we must never let it clobber the adopted code (ping-pong).
    if (s.fuel === 'electricity' && !s.isExport && this.isIntelligentGoTariff()) return false;
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
      if (!isRecoverablePriceGapError(err)) throw err;
      // Throttle the expensive forced recovery: a persistent gap must not run
      // REST rediscovery + product-variant probing every refresh (budget/log
      // churn). The first failure always attempts it; then at most once per 6h.
      const now = Date.now();
      if (now - this.lastForcedRecoveryAt < 6 * 3600_000) throw err;
      this.lastForcedRecoveryAt = now;
      const changed = await this.checkTariffChange(true);
      if (changed) {
        this.log('Tariff changed during price refresh; retrying with the active tariff.');
        await this.refreshPrices();
        return;
      }
      // For IOG import meters, zero public product rows are an EXPECTED contract
      // and the household price is account-authoritative (GraphQL) — a product
      // metadata guess cannot resolve it and only churns the tariff code, so skip
      // the product-variant probe entirely.
      const iogImport = this.store().fuel === 'electricity' && !this.store().isExport
        && this.isIntelligentGoTariff();
      if (!iogImport && await this.tryProductVariantRecovery()) return;
      this.log('Price-gap recovery: rediscovery returned the same tariff code and no product-derived variant resolved it.');
      throw err;
    }
  }

  /**
   * Attempt to recover a "no rate covering now" failure by switching to the
   * tariff code the product metadata advertises for this meter's region and
   * register count. Applies the candidate, retries the price refresh once, and
   * reverts to the previous code if the retry still fails. Returns whether a
   * working variant was found and applied.
   */
  private async tryProductVariantRecovery(): Promise<boolean> {
    const s = this.store();
    if (!s.productCode || !s.tariffCode) return false;
    const region = regionFromTariff(s.tariffCode);
    if (!region) return false;
    const registers: 1 | 2 = this.isTwoRegisterTariff() ? 2 : 1;
    let candidate: string | null = null;
    try {
      candidate = await this.client.tariffCodeForProduct(s.productCode, s.fuel, region, registers);
    } catch (err) {
      this.error('Product-variant lookup failed during price recovery:', err);
      return false;
    }
    if (!candidate || candidate === s.tariffCode) return false;
    const previous = s.tariffCode;
    await this.setStoreValue('tariffCode', candidate);
    try {
      await this.refreshPrices();
      this.log('Price-gap recovery: switched to a product-derived tariff variant and recovered the current price.');
      return true;
    } catch (retryErr) {
      // Never persist an unverified guess — restore the original stored code.
      await this.setStoreValue('tariffCode', previous).catch((error) => this.error(error));
      this.error('Product-derived tariff variant did not resolve the price gap; reverted.', retryErr);
      return false;
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
    // Surface a missing tariff price as a non-blocking advisory rather than a
    // connection error, so a price-only gap does not read as "offline" while
    // the account, meter data and live readings are still working.
    if (decision.warning) {
      await this.setWarning(decision.warning).catch(this.error);
    } else {
      await this.unsetWarning().catch(this.error);
    }
    if (decision.fullyHealthy) {
      this.notified401 = false;
      this.lastHealthyRefreshAt = Date.now();
      await this.setStoreValue('lastHealthyRefreshAt', this.lastHealthyRefreshAt).catch((error) => this.error(error));
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

  /** Hook for subclasses to add fuel-specific refresh work (e.g. consumption).
   *  `generation` is the refresh generation for stale-write fencing (BL-08). */
  protected async refreshExtra(generation: number): Promise<void> {
    await this.refreshConsumption(generation);
  }

  /**
   * Fetch recent half-hourly consumption and derive:
   *  - usage over the last 24h of available data (octopus_usage_today),
   *  - the cost of that usage incl. one day's standing charge (octopus_cost_today),
   *  - a monotonic cumulative total for Homey Energy (meter_power).
   * Octopus consumption typically lags real time by up to ~24 hours.
   */
  protected async refreshConsumption(generation: number): Promise<void> {
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
      await this.commitCumulative(sorted, meterCap as string, generation);
    }
  }

  /**
   * Serialise the cumulative-meter read-modify-write so overlapping refreshes
   * (e.g. after a watchdog-forced reset) can never interleave and double-count.
   *
   * Correctness rests on two things, not on timing:
   *  - a per-device commit queue (`cumulativeCommit`) runs commits strictly one
   *    at a time, so there is no interleaving between the cursor read and the
   *    awaited writes; and
   *  - the cursor and prior total are re-read INSIDE the critical section, so a
   *    later commit always sees an earlier one's advance and adds only genuinely
   *    new records (an already-applied window collapses to a no-op).
   *
   * The generation check is a cheap early-out for a superseded refresh; the
   * re-read guarantees no double-count even if it slips through. The cursor is
   * written before the total so an interrupted commit under-counts (loses a
   * delta, recovered next cycle) rather than double-counting.
   *
   * Liveness vs correctness (deliberate): the commit is STRICTLY serialised and
   * not force-released on a timeout. Homey store/capability writes cannot be
   * cancelled, so releasing the queue while a write is still pending would let a
   * delayed write land after a newer commit and corrupt a billing-relevant
   * monotonic meter. We therefore favour write-order correctness. This is safe
   * in practice because the realistic hang vector is the NETWORK consumption
   * fetch, which happens BEFORE this mutex and is already bounded by the refresh
   * watchdog; the writes inside the mutex are local persistence and settle
   * immediately. A (theoretical) hung local write would pause only cumulative
   * updates — never corrupt them.
   */
  private commitCumulative(sorted: ConsumptionRecord[], meterCap: string, generation: number): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.isStaleRefresh(generation)) return;
      const persistedEnd: string | null = this.getStoreValue('lastConsumptionEnd');
      const priorCumulative = Number(this.getStoreValue('cumulativeMeter')) || 0;
      const update = computeCumulativeUpdate(sorted, persistedEnd, priorCumulative, (raw) => this.toMeterUnit(raw));
      if (update) {
        await this.setStoreValue('lastConsumptionEnd', update.cursorIso);
        await this.setStoreValue('cumulativeMeter', update.cumulative);
        await this.setCapabilityValue(meterCap, update.cumulative).catch(this.error);
      } else if (this.getStoreValue('cumulativeMeter') != null) {
        await this.setCapabilityValue(meterCap, Number(this.getStoreValue('cumulativeMeter'))).catch(this.error);
      }
    };
    // Chain onto the queue (running on both fulfil and reject so one failed
    // commit does not block the next), and keep the stored tail non-rejecting.
    const queue = this.cumulativeCommit ?? Promise.resolve();
    const next = queue.then(run, run);
    this.cumulativeCommit = next.catch(() => {});
    return next;
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

  /**
   * The unit rates used to price HISTORICAL consumption over a window.
   *
   * The public REST unit-rate feed is empty for Intelligent Octopus Go accounts
   * (the settlement product publishes no public rows — the account's own
   * HalfHourly agreement is authoritative). The live price already recovers this
   * via `intelligentGoBaseRates`, leaving the resolved series in `this.rates`.
   * The cost-history paths (month cost, peak/off-peak/yesterday breakdown,
   * billing summary) fetch their own REST rates, so for IOG they would price
   * every record at £0. When the REST feed returns no rows for a single-register
   * import meter, fall back to the authoritative live series so those surfaces
   * stay consistent with the live "cost today" tile instead of showing zero.
   *
   * Two-register (Economy 7) meters are never substituted — their day/night
   * registers must not borrow the single-rate series.
   */
  protected costRatesForWindow(restDayRates: Rate[], twoRegister: boolean): Rate[] {
    if (twoRegister || restDayRates.length) return restDayRates;
    return this.rates;
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
    const primaryRates = rates;
    let current = rateAt(rates);
    let rateSource: 'rest' | 'iog-fallback' | 'unknown' = current ? 'rest' : 'unknown';
    let fallbackRates: Rate[] | null = null;
    if (!current) {
      fallbackRates = await this.client.latestStandardUnitRates(s.fuel, s.productCode, s.tariffCode);
      const fallback = rateAt(fallbackRates);
      if (fallback) {
        rates = fallbackRates;
        current = fallback;
        rateSource = 'rest';
      }
    }
    if (!current) {
      const intelligentGoRates = await this.intelligentGoBaseRates();
      const fallback = rateAt(intelligentGoRates ?? []);
      if (fallback && intelligentGoRates) {
        rates = intelligentGoRates;
        current = fallback;
        rateSource = 'iog-fallback';
        this.log('Price-gap recovery: using the account IOG household base schedule.');
      }
    }
    this.rates = rates;
    this.rateSource = rateSource;
    await this.onRatesUpdated();
    if (!current) {
      this.logPriceGapDiagnostic(s, primaryRates, fallbackRates);
      throw new Error('Octopus returned no rate covering the current time.');
    }
    const value = Number(valueOf(current, this.vatInc()).toFixed(4));
    this.currentPrice = value;
    await this.setCapabilityValue('measure_octopus_price', value).catch(this.error);
    await this.onPriceUpdated(value, current);
  }

  /**
   * Recover IOG household base prices when its public product endpoint has no
   * rows. Both legacy day/night and newer four-rate agreements expose the
   * household 23:30-05:30 schedule. Device and settlement prices stay separate.
   */
  private async intelligentGoBaseRates(): Promise<Rate[] | null> {
    const s = this.store();
    if (s.fuel !== 'electricity' || s.isExport || !s.accountNumber || !s.tariffCode || !s.productCode
      || !this.isIntelligentGoTariff()) return null;
    // Capture the ORIGINAL stored codes before adoption may mutate them.
    const priorTariff = `${s.tariffCode ?? ''}`.toUpperCase();
    const priorProduct = `${s.productCode ?? ''}`.toUpperCase();
    try {
      const tariff = await this.activeIogTariff();
      if (!tariff) return null;
      // Adopt the live code first (fixes a stale stored code for ALL typenames),
      // then only synthesise a schedule when the agreement carries an
      // authoritative two-band household schedule. For single-rate/half-hourly
      // types we deliberately do NOT fabricate a day/night schedule — adoption
      // lets the authoritative REST half-hourly rows recover.
      await this.maybeAdoptIogAgreement(tariff);
      // FIRST-CLASS PRICE SOURCE: a HalfHourlyTariff agreement carries its own
      // authoritative half-hourly rows (like Agile REST rows). IOG is frequently
      // published this way with an EMPTY REST feed, so these rows are the only
      // current price — use them directly, never synthesise, never defer to REST.
      if (tariff.unitRates && tariff.unitRates.length) {
        const rows: Rate[] = iogUnitRatesToRates(tariff.unitRates);
        if (rateAt(rows)) {
          // Diagnostic (identifier-free): what bands does this account actually
          // publish? Reveals whether the off-peak rate is available upstream.
          this.log(`Price-gap recovery: HalfHourly rate bands — ${iogRateTypeSummary(tariff.unitRates)}.`);
          // AUTOMATIC day/night: IOG publishes the guaranteed 23:30–05:30 cheap
          // rate as a distinct OFF_PEAK row alongside the STANDARD day row. When
          // both household bands are present, reconstruct the two-band schedule
          // directly — no user configuration needed.
          const published = iogHouseholdBands(tariff.unitRates, Date.now());
          if (published) {
            const { from, to } = this.iogScheduleWindow();
            const synthesised = synthesiseIogDayNightRates(
              published, from, to, (slotStart) => this.isIogNightTime(slotStart),
            );
            this.log('Price-gap recovery: synthesising day/night from the published HalfHourly OFF_PEAK band.');
            return synthesised;
          }
          // IOG is commonly published as a HalfHourlyTariff whose `unitRates`
          // carry ONLY the single standard/day rate (e.g. 28.86p) — the
          // guaranteed off-peak band is NOT exposed as a distinct row. Promoting
          // a flat single-rate series to the authoritative price series flattens
          // every tile (Lowest/Highest/Average, Next price, off-peak cost) and
          // blinds the local cheapest-window planner (community 156860). When the
          // user has configured their IOG night rate, synthesise a proper
          // day/night series over the guaranteed window instead of pricing flat.
          const dayBase = isFlatUnitRates(tariff.unitRates) ? iogFlatDayRate(tariff.unitRates) : null;
          const override = dayBase ? this.iogNightRateOverride() : null;
          if (dayBase && override && override.inc !== dayBase.inc) {
            const { from, to } = this.iogScheduleWindow();
            const synthesised = synthesiseIogDayNightRates(
              {
                dayRate: dayBase.inc,
                nightRate: override.inc,
                preVatDayRate: dayBase.exc,
                preVatNightRate: override.exc,
              },
              from, to, (slotStart) => this.isIogNightTime(slotStart),
            );
            this.log('Price-gap recovery: HalfHourly rows are flat; synthesising day/night from the configured IOG night rate.');
            return synthesised;
          }
          this.log('Price-gap recovery: pricing from the account HalfHourly agreement rows (authoritative).');
          return rows;
        }
        this.log('Price-gap recovery: HalfHourly agreement rows do not cover now; deferring.');
      }
      if (!tariff.scheduleTrusted) {
        // The live code is adopted; fetch its authoritative REST rows NOW so we
        // recover within THIS refresh instead of waiting a cycle — but only when
        // adoption actually changed the code (else it repeats the same empty call
        // that brought us here). Falls closed to null if REST still has no rows.
        const changed = tariff.tariffCode.toUpperCase() !== priorTariff
          || tariff.productCode.toUpperCase() !== priorProduct;
        if (changed) {
          try {
            const restRates = await this.client.standardUnitRates(
              s.fuel, tariff.productCode, tariff.tariffCode, this.periodWindow(),
            );
            if (rateAt(restRates)) {
              this.log('Price-gap recovery: adopted the live IOG code and recovered its REST rows.');
              return restRates;
            }
          } catch (err) {
            this.log('Price-gap recovery: REST retry on the adopted IOG code was unavailable.');
          }
        }
        this.log('Price-gap recovery: adopted the live IOG code; deferring rates to REST (untrusted schedule shape).');
        return null;
      }
      const { from, to } = this.iogScheduleWindow();
      return synthesiseIogDayNightRates(tariff, from, to, (slotStart) => this.isIogNightTime(slotStart));
    } catch (err) {
      this.log('Intelligent Octopus Go account-rate fallback was unavailable.');
      return null;
    }
  }

  /**
   * When the household schedule was resolved from a DIFFERENT active agreement
   * than the stored code (the stored code was stale — the reason REST is empty),
   * adopt the real code so future lookups match exactly and the standing charge
   * uses the correct product. GraphQL is the sole source of IOG tariff truth
   * (see the IOG guard in checkTariffChange), so REST cannot revert this.
   */
  private async maybeAdoptIogAgreement(tariff: AccountIogTariff): Promise<void> {
    const s = this.store();
    if (s.fuel !== 'electricity' || s.isExport || !this.isIntelligentGoTariff()) return;
    if (tariff.resolvedVia !== 'fallback') return;
    const sameCode = (s.tariffCode ?? '').toUpperCase() === tariff.tariffCode.toUpperCase()
      && (s.productCode ?? '').toUpperCase() === tariff.productCode.toUpperCase();
    if (sameCode) return;
    try {
      await this.setStoreValue('tariffCode', tariff.tariffCode);
      await this.setStoreValue('productCode', tariff.productCode);
      this.lastStandingRefresh = 0;
      this.lastMonthlyRefresh = 0;
      await this.ensureRegisterCapabilities().catch((err) => this.error(err));
      const app = this.homey.app as Homey.App & { invalidateIogTariff?(a: string): void };
      app.invalidateIogTariff?.(s.accountNumber);
      this.log('Price-gap recovery: adopted the account IOG household tariff code (stored code was stale).');
    } catch (err) {
      this.error('Could not adopt the resolved IOG tariff code:', err);
    }
  }

  /** Shared, cached active IOG tariff (dedupes the price-recovery and
   *  effective-rate reads to a single account-scoped, budgeted call). */
  private async activeIogTariff(): Promise<AccountIogTariff | null> {
    const s = this.store();
    if (!s.accountNumber || !s.tariffCode || !s.productCode) return null;
    const onResolve = (d: IogResolveDiagnostic): void => {
      this.lastIogResolve = d;
    };
    const app = this.homey.app as (Homey.App & {
      getCachedIogTariff?(a: string, acc: string, t: string, p: string,
        onResolve?: (d: IogResolveDiagnostic) => void): Promise<AccountIogTariff | null>;
    }) | undefined;
    if (app?.getCachedIogTariff) {
      return app.getCachedIogTariff(s.apiKey, s.accountNumber, s.tariffCode, s.productCode, onResolve);
    }
    return this.kraken.getActiveIogTariff(s.accountNumber, s.tariffCode, s.productCode, onResolve);
  }

  /**
   * Sprint 44 — opt-in *estimated* effective rate for Intelligent Octopus Go.
   * Populated only for IOG electricity import meters (null otherwise, so no
   * other tariff gets a spurious "estimate"). The whole-home effective rate
   * equals the authoritative household base; EV device rates are returned
   * separately and never folded in. Never a bill or settled price.
   */
  async getEffectiveRateView(): Promise<EffectiveRateResult | null> {
    const s = this.store();
    if (s.fuel !== 'electricity' || s.isExport || !this.isIntelligentGoTariff()) return null;
    // Opt-in: the estimate is off by default and only computed when the user has
    // explicitly enabled it (app setting), so no meter surfaces an estimate — or
    // triggers a tariff lookup for it — without consent.
    if (!this.effectiveRateOptIn()) return null;

    let tariff: { evPeak: number | null; evOffPeak: number | null } | null = null;
    try {
      const t = await this.activeIogTariff();
      if (t) {
        const inc = this.vatInc();
        tariff = {
          evPeak: inc ? t.evDevicePeakRate : t.preVatEvDevicePeakRate,
          evOffPeak: inc ? t.evDeviceOffPeakRate : t.preVatEvDeviceOffPeakRate,
        };
      }
    } catch (err) {
      tariff = null; // fail closed
    }

    return computeEffectiveRate({
      optedIn: true,
      householdBase: this.currentPrice,
      inGuaranteedWindow: this.isIogNightTime(new Date()),
      activeKinds: this.activeDispatchKinds(),
      tariff,
      finalisedPrevHalfHour: this.finalisedPreviousHalfHourRate(),
    });
  }

  /** Whether the user has opted into the estimated effective rate (default off). */
  private effectiveRateOptIn(): boolean {
    try {
      return Boolean(this.homey.settings.get('effective_rate_estimate'));
    } catch (err) {
      return false;
    }
  }

  /** Kinds of dispatch active right now, from the reconciled dispatch view. */
  private activeDispatchKinds(): EffectiveDispatchKind[] {
    const view = this.getDispatchView() as DispatchView | null;
    if (!view || !Array.isArray(view.active)) return [];
    return view.active.map((w) => w.kind);
  }

  /** REST-authoritative rate for the just-ended half-hour, else null. The IOG
   *  GraphQL base-schedule fallback is intent, not settlement, so it never
   *  yields a "finalised" figure. */
  private finalisedPreviousHalfHourRate(): number | null {
    if (this.rateSource !== 'rest') return null;
    const slot = 30 * 60_000;
    const prev = new Date(Math.floor(Date.now() / slot) * slot - slot);
    const rate = rateAt(this.rates, prev);
    return rate ? Number(valueOf(rate, this.vatInc()).toFixed(2)) : null;
  }

  private isIntelligentGoTariff(): boolean {
    const code = `${this.store().productCode ?? ''}`.toUpperCase();
    return /(^|-)IOG(-|$)/.test(code)
      || (/^INTELLI-/.test(code) && !/^INTELLI-FLUX-/.test(code));
  }

  /**
   * The user-configured IOG off-peak (night) rate, as an inc-VAT + exc-VAT pair,
   * or null when unset/invalid. IOG's guaranteed 23:30–05:30 band is often absent
   * from the account's HalfHourly settlement rows, so this optional setting lets a
   * user restore correct two-band pricing without depending on an unverified
   * upstream schema. exc-VAT is derived using the standard 5% UK domestic
   * electricity VAT rate so it stays consistent with the settlement rows.
   */
  private iogNightRateOverride(): { inc: number; exc: number } | null {
    const raw = Number(this.getSetting('iog_night_rate'));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return { inc: raw, exc: Number((raw / 1.05).toFixed(4)) };
  }

  /**
   * The horizon over which the IOG day/night schedule is synthesised into
   * `this.rates`. It reaches well back because month-to-date and billing-period
   * cost price IOG history against `this.rates` when the public REST feed is
   * empty (see `costRatesForWindow`); a short window would leave older records
   * unpriced (£0) and undercount the month. Still bounded (a few thousand slots).
   */
  private iogScheduleWindow(): { from: number; to: number } {
    return { from: this.localMidnight(-45).getTime(), to: this.localMidnight(3).getTime() };
  }

  private isIogNightTime(at: Date): boolean {
    const tz = this.homey.clock.getTimezone();
    const parts: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(at)) parts[part.type] = part.value;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= 23 * 60 + 30 || minutes < 5 * 60 + 30;
  }

  /**
   * Emit a privacy-safe summary of a "no rate covering now" failure so a user
   * diagnostic report can distinguish the competing root causes (stale/closed
   * agreement vs wrong tariff variant vs a genuine upstream gap) without ever
   * logging credentials, account/meter identifiers, or raw upstream bodies.
   */
  private logPriceGapDiagnostic(s: MeterStore, primary: Rate[], fallback: Rate[] | null): void {
    try {
      const bounds = (rows: Rate[]): { oldest: string | null; newest: string | null } => {
        const froms = rows
          .map((r) => new Date(r.valid_from).getTime())
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => a - b);
        const day = (t: number): string => new Date(t).toISOString().slice(0, 10);
        return froms.length
          ? { oldest: day(froms[0]), newest: day(froms[froms.length - 1]) }
          : { oldest: null, newest: null };
      };
      const family = `${s.productCode ?? ''}`.toUpperCase().split('-')[0] || null;
      const shape = {
        fuel: s.fuel,
        role: s.isExport ? 'export' : 'import',
        register: this.isTwoRegisterTariff() ? '2R' : '1R',
        productFamily: family,
        dynamic: this.isDynamicTariff(),
        primaryCount: primary.length,
        primaryCurrentFound: rateAt(primary) !== null,
        primaryOpenEnded: primary.filter((r) => !r.valid_to).length,
        primaryBounds: bounds(primary),
        fallbackFetched: fallback !== null,
        fallbackCount: fallback?.length ?? 0,
        fallbackCurrentFound: fallback ? rateAt(fallback) !== null : false,
        fallbackOpenEnded: fallback ? fallback.filter((r) => !r.valid_to).length : 0,
        fallbackBounds: fallback ? bounds(fallback) : null,
        // IOG household-agreement resolution (identifier-free): did the GraphQL
        // fallback find an active agreement, and did the synthesized schedule
        // resolve the price? Distinguishes a stale-code-recovered gap from a
        // genuine "account has no active agreement" gap.
        iogResolve: this.lastIogResolve,
        iogFallbackResolved: this.rateSource === 'iog-fallback',
      };
      this.log('price-gap diagnostic (no identifiers):', JSON.stringify(shape));
    } catch (err) {
      // Diagnostics must never interfere with the refresh outcome.
      this.error('Could not build price-gap diagnostic:', err);
    }
  }

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
    this.rateSource = 'rest';
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
    return computeRatesHorizon(this.rates);
  }

  /** Cheapest / most expensive upcoming rate values (p/kWh) for tonight tokens. */
  upcomingExtremes(): { cheapest: number; cheapestStart: string; expensive: number } | null {
    const ext = computeUpcomingExtremes(this.rates, Date.now(), this.vatInc());
    if (!ext) return null;
    return {
      cheapest: ext.cheapest,
      cheapestStart: this.formatLocal(new Date(ext.cheapestStartIso)),
      expensive: ext.expensive,
    };
  }

  /** Is the current price within the cheapest `percent`% of the next `hours`? */
  isInCheapestPercentile(percent: number, hours: number, at: Date = new Date()): boolean {
    const current = rateAt(this.rates, at);
    if (!current) return false;
    const to = new Date(at.getTime() + hours * 3600_000);
    const window = ratesInWindow(this.rates, this.planningWindowStart(at), to);
    return isWithinCheapestPercentile(window, current, this.vatInc(), percent);
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

  // --- Sprint 47: opt-in planner & tariff analytics ------------------------

  /** Privacy-safe planning seed: a NON-reversible hash of the device id (never
   *  the raw id) plus any user seed. Contains no wall-clock or window timestamps,
   *  so `random` is reproducible for a given device + user seed. Never logged. */
  private plannerSeed(userSeed: string): string {
    let id = '';
    try {
      id = String(this.getData()?.id ?? '');
    } catch (err) {
      id = '';
    }
    return `${seedToUint32(id)}|${userSeed ?? ''}`;
  }

  private priceBasisLabel(): 'vat-inclusive' | 'vat-exclusive' {
    return this.vatInc() ? 'vat-inclusive' : 'vat-exclusive';
  }

  /**
   * Tie-aware extreme contiguous slot (cheapest for import, dearest for export)
   * with a declared window and tie rule. Never clamps negatives.
   */
  findExtremeSlotAdvanced(
    kind: 'import' | 'export', withinHours: number, durationHours: number,
    tie: TieStrategy, userSeed: string,
  ): {
    start_time: string; end_time: string; price: number;
    window_start: string; window_end: string; tie_rule: string;
    price_basis: string; estimate_label: string;
  } | null {
    const slots = Math.max(1, Math.round(Number(durationHours) * 2));
    const now = new Date();
    const from = this.planningWindowStart(now);
    const to = withinHours > 0 ? new Date(now.getTime() + withinHours * 3600_000) : this.nextLocalTime('00:00');
    const rng = createSeededRandom(this.plannerSeed(userSeed));
    const opts = {
      from, to, incVat: this.vatInc(), tie, rng,
    };
    const win = kind === 'export'
      ? selectExpensiveWindow(this.rates, slots, opts)
      : selectCheapestWindow(this.rates, slots, opts);
    if (!win || !win.length) return null;
    const avg = win.reduce((a, r) => a + valueOf(r, this.vatInc()), 0) / win.length;
    const last = win[win.length - 1];
    const lastEnd = last.valid_to ?? new Date(new Date(last.valid_from).getTime() + 30 * 60_000).toISOString();
    return {
      start_time: this.formatLocal(new Date(win[0].valid_from)),
      end_time: this.formatLocal(new Date(lastEnd)),
      price: Number(avg.toFixed(2)),
      window_start: this.formatLocal(from),
      window_end: this.formatLocal(to),
      tie_rule: tie,
      price_basis: this.priceBasisLabel(),
      estimate_label: 'Estimated plan — not a settled bill',
    };
  }

  /**
   * Tie-aware complete plan for `kind` with estimated saving/uplift vs a uniform
   * window baseline. Returns null on insufficient window (never a partial plan).
   */
  planAdvanced(
    kind: 'import' | 'export', neededKwh: number, rateKw: number, byTime: string,
    tie: TieStrategy, userSeed: string,
  ): {
    count: number; first_start: string; last_end: string;
    weighted_average_price: number; estimated_amount: number;
    baseline_amount: number; estimated_saving: number;
    window_start: string; window_end: string; tie_rule: string; estimate_label: string;
  } | null {
    const now = new Date();
    const from = this.planningWindowStart(now);
    const to = this.nextLocalTime(byTime);
    const rng = createSeededRandom(this.plannerSeed(userSeed));
    const plan = planEnergy(this.rates, Number(neededKwh), Number(rateKw), {
      from, to, incVat: this.vatInc(), tie, rng, kind,
    });
    if (!plan) return null;
    // Baseline over the SAME eligible slots the planner can use (whole slots that
    // finish by the deadline) — so the estimate never compares the plan against an
    // infeasible/overrun population. Eligible slots are full 30-min rows, so the
    // simple mean equals the duration-weighted mean.
    const eligible = this.rates
      .filter((r) => {
        const s = new Date(r.valid_from).getTime();
        const e = r.valid_to ? new Date(r.valid_to).getTime() : s + 30 * 60_000;
        return s >= from.getTime() && e <= to.getTime();
      })
      .map((r) => valueOf(r, this.vatInc()));
    const windowAvg = eligible.length
      ? eligible.reduce((a, b) => a + b, 0) / eligible.length
      : plan.weightedAveragePrice;
    const savings = estimatePlanSavings(plan.neededKwh, plan.weightedAveragePrice, windowAvg);
    // estimatePlanSavings is import-oriented (baseline - plan). For export the
    // favourable direction is reversed, so the uplift is plan - baseline.
    const signedSaving = kind === 'export' ? -savings.estimatedSaving : savings.estimatedSaving;
    const last = plan.allocations[plan.allocations.length - 1];
    return {
      count: plan.count,
      first_start: this.formatLocal(new Date(plan.allocations[0].from)),
      last_end: this.formatLocal(new Date(last.to)),
      weighted_average_price: Number(plan.weightedAveragePrice.toFixed(2)),
      estimated_amount: Number((plan.estimatedAmount / 100).toFixed(2)),
      baseline_amount: Number((savings.baselineAmount / 100).toFixed(2)),
      estimated_saving: Number((signedSaving / 100).toFixed(2)),
      window_start: this.formatLocal(from),
      window_end: this.formatLocal(to),
      tie_rule: tie,
      estimate_label: savings.label,
    };
  }

  /** Relative price-band analysis of a whole local tariff day (today/tomorrow). */
  analysePriceDay(which: 'today' | 'tomorrow'): {
    window_start: string; window_end: string; current_band: string;
    time_weighted_average: number; median: number; q1: number; q3: number;
    relative_offpeak_share: number; negative_slots: number; spike_slots: number;
    price_basis: string; tie_rule: string; estimate_label: string;
  } | null {
    const from = which === 'tomorrow' ? this.localMidnight(1) : this.localMidnight(0);
    const to = which === 'tomorrow' ? this.localMidnight(2) : this.localMidnight(1);
    const a = analysePriceWindow(this.rates, from, to, { incVat: this.vatInc() });
    if (!a) return null;
    const current = which === 'today' ? rateAt(this.rates, new Date()) : null;
    const currentBand = current
      ? classifyBand(valueOf(current, this.vatInc()), a.points, a.spikeThreshold)
      : '';
    return {
      window_start: this.formatLocal(from),
      window_end: this.formatLocal(to),
      current_band: currentBand,
      time_weighted_average: Number(a.timeWeightedAverage.toFixed(2)),
      median: Number(a.median.toFixed(2)),
      q1: Number(a.q1.toFixed(2)),
      q3: Number(a.q3.toFixed(2)),
      relative_offpeak_share: Number((a.relativeOffPeakShare * 100).toFixed(0)),
      negative_slots: a.negativeSlots,
      spike_slots: a.spikeSlots,
      price_basis: a.priceBasis,
      tie_rule: a.tieRule,
      estimate_label: 'Relative to the stated local-day window — tariff prices, not settled',
    };
  }

  /** The current price's relative band over today's complete local day, or null
   *  when the day is not fully published or there is no current price. */
  currentPriceBand(): RelativeBand | null {
    const from = this.localMidnight(0);
    const to = this.localMidnight(1);
    const a = analysePriceWindow(this.rates, from, to, { incVat: this.vatInc() });
    const current = rateAt(this.rates, new Date());
    if (!a || !current) return null;
    return classifyBand(valueOf(current, this.vatInc()), a.points, a.spikeThreshold);
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
          // Resolve the API's real regional code rather than assuming its
          // register/payment-method naming convention.
          // eslint-disable-next-line no-await-in-loop
          const tariffCode = await this.client.tariffCodeForProduct(code, 'electricity', region, 1);
          if (tariffCode) candidates.push({ name: label, productCode: code, tariffCode });
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
    return tzOffset(date, this.homey.clock.getTimezone());
  }

  /** Build the UTC instant for a local wall-clock date/time in the Homey timezone. */
  private zonedTime(year: number, month1: number, day: number, hour = 0, minute = 0): Date {
    return tzZonedTime(year, month1, day, this.homey.clock.getTimezone(), hour, minute);
  }

  /** Local midnight `daysFromNow` days away (DST-safe). */
  protected localMidnight(daysFromNow: number): Date {
    return tzLocalMidnight(this.homey.clock.getTimezone(), daysFromNow);
  }

  /** Start of the current local month (DST-safe). */
  protected localMonthStart(): Date {
    return tzLocalMonthStart(this.homey.clock.getTimezone());
  }

  private localDateParts(date: Date = new Date()): { year: number; month: number; day: number; hour: number; minute: number } {
    return tzLocalDateParts(date, this.homey.clock.getTimezone());
  }

  private daysInLocalMonth(date: Date = new Date()): number {
    return tzDaysInLocalMonth(date, this.homey.clock.getTimezone());
  }

  private elapsedLocalMonthDays(date: Date = new Date()): number {
    return tzElapsedLocalMonthDays(date, this.homey.clock.getTimezone());
  }

  /** The half-hourly prices in effect across today (local), sampled from the
   *  schedule at each :00/:30 slot. Sampling (rather than filtering rows by
   *  `valid_from` within today) makes the stats correct for BOTH discrete rate
   *  rows (Agile — one row per slot, valid_from today) AND long-span rows (IOG
   *  day/night — a few rows covering many hours whose valid_from predates today).
   *  DST-safe: the local-day window is 46/48/50 slots as appropriate. */
  private pricesAcrossToday(): number[] {
    const start = this.localMidnight(0).getTime();
    const end = this.localMidnight(1).getTime();
    const inc = this.vatInc();
    const out: number[] = [];
    for (let t = start; t < end; t += 30 * 60_000) {
      const rate = rateAt(this.rates, new Date(t));
      if (rate) out.push(valueOf(rate, inc));
    }
    return out;
  }

  /** Compute today's price min/max/avg and the next half-hour price. */
  protected async refreshPriceStats(): Promise<void> {
    if (!this.hasCapability('octopus_price_avg_today')) return;
    const todays = this.pricesAcrossToday();
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

    // For IOG (and any single-register import meter whose public REST feed is
    // empty), price history from the authoritative live series instead of £0.
    const dayRatesForCost = this.costRatesForWindow(dayRates, twoRegister);

    let pence = 0;
    for (const r of records) {
      const rate = this.rateForRecord(r.interval_start, dayRatesForCost, nightRates);
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

    await this.refreshDayBreakdown(records, dayRatesForCost, nightRates, standingHistory);
    this.lastMonthlyRefresh = Date.now();
  }

  /**
   * Compute a billing-period summary (import cost, standing charge, net, and a
   * clearly-labelled projection + confidence) for the import electricity meter,
   * and persist a masked, privacy-safe mirror for the settings surface. REST is
   * authoritative; the value is a pure recomputation (restart-safe), not an
   * accumulator. No new capabilities or Flow IDs; no version bump.
   */
  protected async refreshBillingSummary(): Promise<void> {
    const s = this.store();
    if (s.fuel !== 'electricity' || s.isExport) return; // import electricity only
    if (!s.mpxn || !s.serial || !s.productCode || !s.tariffCode) return;
    if (Date.now() - this.lastBillingRefresh < 2 * 3600_000) return;

    const tz = this.homey.clock.getTimezone();
    const rawDay = Number(this.homey.settings.get('billing_day'));
    const billingDay = Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 31 ? rawDay : undefined;
    const now = new Date();
    const period = resolveBillingPeriod(now, tz, billingDay);
    const window = { period_from: period.start, period_to: now.toISOString() };
    const twoRegister = this.isTwoRegisterTariff();
    const [records, dayRates, nightRates, standing] = await Promise.all([
      this.client.consumption(s.fuel, s.mpxn, s.serial, { ...window, order_by: 'period' }),
      twoRegister
        ? this.client.registerUnitRates('day', s.productCode, s.tariffCode, window)
        : this.client.standardUnitRates(s.fuel, s.productCode, s.tariffCode, window),
      twoRegister
        ? this.client.registerUnitRates('night', s.productCode, s.tariffCode, window)
        : Promise.resolve([] as Rate[]),
      this.client.standingCharges(s.fuel, s.productCode, s.tariffCode, window),
    ]);
    // IOG parity: price history from the authoritative live series when the
    // public REST feed is empty, so the billing summary never shows £0 usage.
    const dayRatesForCost = this.costRatesForWindow(dayRates, twoRegister);
    if (!records.length) {
      // No settled data for the current period yet — persist a current-period
      // placeholder so the settings surface never shows the previous period.
      this.lastBillingRefresh = Date.now();
      this.persistBillingSummary(computeBillingSummary({
        period,
        settledThrough: period.start,
        now: now.toISOString(),
        timeZone: tz,
        incVat: this.vatInc(),
        import: {
          records: [], dayRates: dayRatesForCost, nightRates, standing, isNight: (iso: string) => this.isNightTime(iso),
        },
      }));
      return;
    }

    const settledThrough = records.reduce(
      (max, r) => (r.interval_end > max ? r.interval_end : max),
      records[0].interval_end,
    );
    const exportInput = await this.exportBillingInput(window).catch(() => undefined);
    const summary = computeBillingSummary({
      period,
      settledThrough,
      now: now.toISOString(),
      timeZone: tz,
      incVat: this.vatInc(),
      import: {
        records,
        dayRates: dayRatesForCost,
        nightRates,
        standing,
        isNight: (iso: string) => this.isNightTime(iso),
      },
      export: exportInput,
    });
    this.lastBillingRefresh = Date.now();
    this.persistBillingSummary(summary);
  }

  /**
   * Load the account's export meter consumption + export rates for the same
   * window, so net position can deduct export value. Returns undefined when the
   * account has no export meter with an export tariff (the common case), leaving
   * export value as unavailable rather than £0.
   */
  private async exportBillingInput(
    window: { period_from: string; period_to: string },
  ): Promise<{ records: ConsumptionRecord[]; rates: Rate[] } | undefined> {
    const s = this.store();
    const meters = await this.client.discoverMeters(s.accountNumber);
    const exp = meters.find((m) => m.isExport && m.fuel === 'electricity' && m.productCode && m.tariffCode);
    if (!exp || !exp.productCode || !exp.tariffCode) return undefined;
    const [records, rates] = await Promise.all([
      this.client.consumption('electricity', exp.mpxn, exp.serial, { ...window, order_by: 'period' }),
      this.client.standardUnitRates('electricity', exp.productCode, exp.tariffCode, window),
    ]);
    if (!records.length) return undefined;
    return { records, rates };
  }

  /** Persist a masked, identifier-safe billing summary for the settings page. */
  private persistBillingSummary(summary: unknown): void {
    try {
      const key = 'billing_summary_v1';
      const all = (this.homey.settings.get(key) || {}) as Record<string, unknown>;
      all[this.maskAccount(this.store().accountNumber)] = { ...(summary as object), updatedAt: new Date().toISOString() };
      const entries = Object.entries(all);
      if (entries.length > 10) {
        for (const [id] of entries.slice(0, entries.length - 10)) delete all[id];
      }
      this.homey.settings.set(key, all);
    } catch (err) {
      this.error('Could not persist billing summary:', err);
    }
  }

  private maskAccount(accountNumber: string): string {
    return maskAccountId(accountNumber);
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
    const now = Date.now();
    // Once points are known to be unavailable for this account, back off for a
    // full day so an unenrolled/ineligible account is not polled every cycle.
    if (now < this.pointsUnsupportedUntil) return;
    if (now - this.lastPointsRefresh < 60 * 60_000) return;
    // Advance the cooldown up-front so a transient failure backs off to at most
    // once an hour instead of re-attempting (and re-logging) on every refresh.
    this.lastPointsRefresh = now;
    const points = await this.kraken.getOctoplusPoints(accountNumber);
    if (points === null) {
      this.pointsUnsupportedUntil = now + 24 * 60 * 60_000;
      if (!this.pointsUnsupportedLogged) {
        this.pointsUnsupportedLogged = true;
        this.log('Octoplus points are unavailable for this account; pausing points refresh for 24h.');
      }
      return;
    }
    this.pointsUnsupportedLogged = false;
    await this.setCapabilityValue('octopus_points', points).catch(this.error);
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

  /** Whether the tariff can change at a half-hour boundary. */
  protected isDynamicTariff(): boolean {
    const code = `${this.store().productCode ?? ''}`.toUpperCase();
    return /AGILE|FLUX|INTELLI|COSY|AIRA|SNUG/.test(code)
      || /(^|-)IOG(-|$)/.test(code)
      || /(^|-)GO(-|$)/.test(code);
  }

  /** Build the refresh-timer scheduler. Config is read fresh on each start()
   *  so a tariff or poll-interval change takes effect on the next start. */
  private buildScheduler(): DeviceScheduler {
    return new DeviceScheduler({
      host: this.homey,
      refresh: () => this.refresh(),
      config: () => ({
        isDynamic: this.isDynamicTariff(),
        isAgile: /AGILE/i.test(this.store().productCode ?? ''),
        pollIntervalMinutes: Number(this.settings().poll_interval) || 30,
      }),
      nextLocalTime: (hhmm) => this.nextLocalTime(hhmm),
      onError: (message, err) => this.error(message, err),
    });
  }

  private scheduleRefresh(): void {
    if (!this.scheduler) this.scheduler = this.buildScheduler();
    this.scheduler.start();
  }

  private stopTimers(): void {
    this.scheduler?.stop();
  }

  // --- Lifecycle -----------------------------------------------------------

  async onSettings({ changedKeys }: { changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes('poll_interval')) {
      this.homey.setTimeout(() => this.scheduleRefresh(), 100);
    }
    if (changedKeys.some((k) => [
      'vat', 'cheap_threshold', 'expensive_threshold', 'smart_charge_hours',
      'smart_charge_by', 'smart_charge_max_price', 'night_start', 'night_end',
      'carbon_region', 'gas_units', 'gas_cv', 'iog_night_rate',
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
