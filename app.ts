'use strict';

import Homey from 'homey';
import { SavingSessionsPoller } from './lib/SavingSessionsPoller';
import { DispatchPoller } from './lib/DispatchPoller';
import {
  Dispatch, KrakenClient, AccountIogTariff, IogResolveDiagnostic,
} from './lib/KrakenClient';
import { SmartFlexDevice, DispatchView } from './lib/dispatch/types';
import { PlannedInput, CompletedInput } from './lib/dispatch/reconcile';
import { LiveDemandSource, LiveDemandCreds } from './lib/LiveDemandSource';
import { resetBudget, budgetDiagnostics } from './lib/KrakenBudget';
import { Reading } from './lib/freshness';
import { crossedAbove, crossedBelow } from './lib/rates';

interface BalanceDevice extends Homey.Device {
  getBalance(): number | null;
}

module.exports = class OctopusEnergyApp extends Homey.App {

  private savingSessions?: SavingSessionsPoller;

  private dispatches?: DispatchPoller;

  private liveDemand?: LiveDemandSource;

  private balanceCache = new Map<string, { value: number; ts: number }>();

  private balanceInflight = new Map<string, Promise<number>>();

  private krakenClients = new Map<string, { apiKey: string; client: KrakenClient }>();

  private plannedDispatchCache = new Map<string, { value: Dispatch[]; ts: number }>();

  private plannedDispatchInflight = new Map<string, Promise<Dispatch[]>>();

  private completedDispatchCache = new Map<string, { value: Dispatch[]; ts: number }>();

  private completedDispatchInflight = new Map<string, Promise<Dispatch[]>>();

  private deviceCache = new Map<string, { value: SmartFlexDevice[]; ts: number }>();

  private deviceInflight = new Map<string, Promise<SmartFlexDevice[]>>();

  private flexPlannedCache = new Map<string, { value: PlannedInput[]; ts: number }>();

  private flexPlannedInflight = new Map<string, Promise<PlannedInput[]>>();

  private completedWindowCache = new Map<string, { value: CompletedInput[]; ts: number }>();

  private completedWindowInflight = new Map<string, Promise<CompletedInput[]>>();

  private iogTariffCache = new Map<string, {
    value: AccountIogTariff | null; ts: number; nullStreak: number; diag?: IogResolveDiagnostic;
  }>();

  private iogTariffInflight = new Map<string, Promise<AccountIogTariff | null>>();

  private trimMap<T>(map: Map<string, T>, max = 20): void {
    while (map.size > max) {
      const oldest = map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  /** One token cache/client per account; a changed key invalidates account data. */
  getKrakenClient(apiKey: string, accountNumber: string): KrakenClient {
    const existing = this.krakenClients.get(accountNumber);
    if (existing?.apiKey === apiKey) return existing.client;
    this.invalidateAccountCaches(accountNumber);
    const client = new KrakenClient(apiKey, accountNumber);
    this.krakenClients.set(accountNumber, { apiKey, client });
    this.trimMap(this.krakenClients);
    return client;
  }

  /** Clear values tied to credentials that have just been repaired/replaced. */
  invalidateAccountCaches(accountNumber: string): void {
    this.krakenClients.delete(accountNumber);
    this.balanceCache.delete(accountNumber);
    this.balanceInflight.delete(accountNumber);
    this.plannedDispatchCache.delete(accountNumber);
    this.plannedDispatchInflight.delete(accountNumber);
    this.completedDispatchCache.delete(accountNumber);
    this.completedDispatchInflight.delete(accountNumber);
    this.deviceCache.delete(accountNumber);
    this.deviceInflight.delete(accountNumber);
    this.flexPlannedCache.delete(accountNumber);
    this.flexPlannedInflight.delete(accountNumber);
    this.completedWindowCache.delete(accountNumber);
    this.completedWindowInflight.delete(accountNumber);
    const iogPrefix = `${accountNumber}|`;
    for (const key of [...this.iogTariffCache.keys()]) {
      if (key.startsWith(iogPrefix)) this.iogTariffCache.delete(key);
    }
    for (const key of [...this.iogTariffInflight.keys()]) {
      if (key.startsWith(iogPrefix)) this.iogTariffInflight.delete(key);
    }
    resetBudget(accountNumber);
    this.liveDemand?.invalidate(accountNumber);
  }

  // --- Live Home Mini demand (shared, account-scoped) ---------------------

  /** Subscribe a device to shared live-demand updates for its account. */
  subscribeLiveDemand(creds: LiveDemandCreds, subscriberId: string, onUpdate: (reading: Reading<number>) => void): void {
    this.liveDemand?.subscribe(creds, subscriberId, onUpdate);
  }

  /** Remove a device's live-demand subscription. */
  unsubscribeLiveDemand(accountNumber: string, subscriberId: string): void {
    this.liveDemand?.unsubscribe(accountNumber, subscriberId);
  }

  /** Latest shared live-demand reading for an account, if any. */
  getLiveDemand(accountNumber: string): Reading<number> | null {
    return this.liveDemand?.getLiveDemand(accountNumber) ?? null;
  }

  /** Sanitised dispatch presentation snapshot for widgets (deviceId-free). */
  getDispatchView(accountNumber: string): DispatchView | null {
    return this.dispatches?.getAccountView(accountNumber) ?? null;
  }

  /** Account-wide balance with a short TTL cache (dedupes per-device calls). */
  async getCachedBalance(apiKey: string, accountNumber: string): Promise<number> {
    const cached = this.balanceCache.get(accountNumber);
    if (cached && Date.now() - cached.ts < 10 * 60_000) return cached.value;
    const inflight = this.balanceInflight.get(accountNumber);
    if (inflight) return inflight;
    const request = this.getKrakenClient(apiKey, accountNumber).getBalance(accountNumber)
      .then((value) => {
        this.balanceCache.set(accountNumber, { value, ts: Date.now() });
        this.trimMap(this.balanceCache);
        return value;
      })
      .finally(() => this.balanceInflight.delete(accountNumber));
    this.balanceInflight.set(accountNumber, request);
    return request;
  }

  /** Planned dispatches shared by the poller and all devices on an account. */
  async getCachedPlannedDispatches(apiKey: string, accountNumber: string): Promise<Dispatch[]> {
    const cached = this.plannedDispatchCache.get(accountNumber);
    if (cached && Date.now() - cached.ts < 60_000) return cached.value;
    const inflight = this.plannedDispatchInflight.get(accountNumber);
    if (inflight) return inflight;
    const request = this.getKrakenClient(apiKey, accountNumber).getPlannedDispatches(accountNumber)
      .then((value) => {
        this.plannedDispatchCache.set(accountNumber, { value, ts: Date.now() });
        this.trimMap(this.plannedDispatchCache);
        return value;
      })
      .finally(() => this.plannedDispatchInflight.delete(accountNumber));
    this.plannedDispatchInflight.set(accountNumber, request);
    return request;
  }

  /** Completed dispatches change slowly, so share them for four minutes. */
  async getCachedCompletedDispatches(apiKey: string, accountNumber: string): Promise<Dispatch[]> {
    const cached = this.completedDispatchCache.get(accountNumber);
    if (cached && Date.now() - cached.ts < 4 * 60_000) return cached.value;
    const inflight = this.completedDispatchInflight.get(accountNumber);
    if (inflight) return inflight;
    const request = this.getKrakenClient(apiKey, accountNumber).getCompletedDispatches(accountNumber)
      .then((value) => {
        this.completedDispatchCache.set(accountNumber, { value, ts: Date.now() });
        this.trimMap(this.completedDispatchCache);
        return value;
      })
      .finally(() => this.completedDispatchInflight.delete(accountNumber));
    this.completedDispatchInflight.set(accountNumber, request);
    return request;
  }

  // --- Sprint 43: device-aware dispatch acquisition -----------------------

  /** Linked smart-flex devices for an account (long TTL — the list is stable). */
  async getCachedDevices(apiKey: string, accountNumber: string): Promise<SmartFlexDevice[]> {
    const cached = this.deviceCache.get(accountNumber);
    if (cached && Date.now() - cached.ts < 30 * 60_000) return cached.value;
    const inflight = this.deviceInflight.get(accountNumber);
    if (inflight) return inflight;
    const request = this.getKrakenClient(apiKey, accountNumber).getDevices(accountNumber)
      .then((value) => {
        this.deviceCache.set(accountNumber, { value, ts: Date.now() });
        this.trimMap(this.deviceCache);
        return value;
      })
      .finally(() => this.deviceInflight.delete(accountNumber));
    this.deviceInflight.set(accountNumber, request);
    return request;
  }

  /**
   * Aggregated planned dispatches for an account. Uses device-scoped
   * flexPlannedDispatches for each participating smart-flex device; falls back
   * to the legacy account-scoped planned dispatches when no such device exists.
   * Throws on failure so the caller can retain prior state (never falsely cancel)
   * and surface the error once.
   */
  async getFlexPlanned(apiKey: string, accountNumber: string): Promise<PlannedInput[]> {
    const cached = this.flexPlannedCache.get(accountNumber);
    if (cached && Date.now() - cached.ts < 60_000) return cached.value;
    if (!this.flexPlannedInflight.has(accountNumber)) {
      const request = (async () => {
        const devices = await this.getCachedDevices(apiKey, accountNumber);
        const candidates = devices.filter((d) => d.participating || d.category === 'EV' || d.category === 'CHARGE_POINT');
        const client = this.getKrakenClient(apiKey, accountNumber);
        if (!devices.length) {
          // No smart-flex device at all: preserve legacy account-scoped behaviour.
          const legacy = await client.getPlannedDispatches(accountNumber);
          return legacy.map((d) => ({
            deviceId: 'account', start: d.start, end: d.end, kind: 'unknown' as const,
          }));
        }
        const perDevice = await Promise.all(candidates.map((d) => client.getFlexPlannedDispatches(d.deviceId)));
        return perDevice.flat();
      })()
        .then((value) => {
          this.flexPlannedCache.set(accountNumber, { value, ts: Date.now() });
          this.trimMap(this.flexPlannedCache);
          return value;
        })
        .finally(() => this.flexPlannedInflight.delete(accountNumber));
      this.flexPlannedInflight.set(accountNumber, request);
    }
    return this.flexPlannedInflight.get(accountNumber)!;
  }

  /** Completed dispatch windows (with kWh delta) shared for four minutes. */
  async getCachedCompletedWindows(apiKey: string, accountNumber: string): Promise<CompletedInput[]> {
    const cached = this.completedWindowCache.get(accountNumber);
    if (cached && Date.now() - cached.ts < 4 * 60_000) return cached.value;
    const inflight = this.completedWindowInflight.get(accountNumber);
    if (inflight) return inflight;
    const request = this.getKrakenClient(apiKey, accountNumber).getCompletedDispatchWindows(accountNumber)
      .then((value) => {
        this.completedWindowCache.set(accountNumber, { value, ts: Date.now() });
        this.trimMap(this.completedWindowCache);
        return value;
      })
      .finally(() => this.completedWindowInflight.delete(accountNumber));
    this.completedWindowInflight.set(accountNumber, request);
    return request;
  }

  /**
   * Active IOG tariff (household day/night + separate EV device rates) shared
   * across the meter's price-recovery path and the Sprint 44 effective-rate
   * view. Long TTL (30 min) + inflight dedup so it costs the F0 budget at most
   * one `core`-priority GraphQL call per account per half-hour. Returns null on
   * failure (fail closed — never fabricates rates).
   */
  async getCachedIogTariff(
    apiKey: string, accountNumber: string, tariffCode: string, productCode: string,
    onResolve?: (diagnostic: IogResolveDiagnostic) => void,
  ): Promise<AccountIogTariff | null> {
    const key = `${accountNumber}|${tariffCode}|${productCode}`;
    const cached = this.iogTariffCache.get(key);
    if (cached && Date.now() - cached.ts < this.iogTariffTtl(cached)) {
      // Replay the last census on a cache hit so the caller's periodic price-gap
      // diagnostic reflects the real resolution instead of going stale.
      if (cached.diag) onResolve?.(cached.diag);
      return cached.value;
    }
    const inflight = this.iogTariffInflight.get(key);
    if (inflight) return inflight;
    let lastDiag: IogResolveDiagnostic | undefined;
    const captureDiag = (d: IogResolveDiagnostic): void => {
      lastDiag = d;
      onResolve?.(d);
    };
    const request = this.getKrakenClient(apiKey, accountNumber)
      .getActiveIogTariff(accountNumber, tariffCode, productCode, captureDiag)
      .then((value) => {
        // A resolved household schedule is effectively fixed (day/night rates
        // change only at contract/price-cap boundaries), so cache it for 6h — a
        // persistent null backs off exponentially (30m → 6h) so a broken account
        // stops paying a `core` Kraken token every 30 min for nothing.
        const priorNulls = value === null ? (this.iogTariffCache.get(key)?.nullStreak ?? 0) + 1 : 0;
        this.iogTariffCache.set(key, {
          value, ts: Date.now(), nullStreak: priorNulls, diag: lastDiag,
        });
        this.trimMap(this.iogTariffCache);
        return value;
      })
      .finally(() => this.iogTariffInflight.delete(key));
    this.iogTariffInflight.set(key, request);
    return request;
  }

  /** Cache lifetime for an IOG tariff entry: 6h for a fixed day/night value
   *  (bounded by the agreement's validTo); a HalfHourly agreement carries a
   *  DYNAMIC price series, so cap it to its row horizon (and refresh at least
   *  every 30 min so the forward series stays current); exponential 30m→6h
   *  backoff for a persistent null. */
  private iogTariffTtl(entry: { value: AccountIogTariff | null; ts: number; nullStreak: number }): number {
    if (entry.value === null) {
      return Math.min(30 * 60_000 * 2 ** Math.max(0, entry.nullStreak - 1), 6 * 3600_000);
    }
    const sixHours = 6 * 3600_000;
    const rows = entry.value.unitRates;
    if (rows && rows.length) {
      // Cache only while the returned rows can still price "now"; never the 6h
      // used for fixed rates (which would leave a stale half-hourly series).
      const lastTo = rows.reduce((max, r) => {
        const t = r.validTo ? Date.parse(r.validTo) : Infinity;
        return Number.isFinite(t) && t > max ? t : max;
      }, 0);
      const horizon = lastTo > 0 ? Math.max(0, lastTo - entry.ts) : sixHours;
      // Refresh at the row horizon when it is sooner than 30 min (a 1-min floor
      // avoids hammering); never keep an expired half-hourly series cached.
      return Math.max(60_000, Math.min(30 * 60_000, horizon));
    }
    const validTo = entry.value.validTo ? Date.parse(entry.value.validTo) : NaN;
    if (Number.isFinite(validTo)) return Math.max(0, Math.min(sixHours, validTo - entry.ts));
    return sixHours;
  }

  /** Drop only the IOG-tariff cache for an account (e.g. after the household code
   *  is adopted) WITHOUT resetting the budget or other account caches. */
  invalidateIogTariff(accountNumber: string): void {
    const prefix = `${accountNumber}|`;
    for (const key of [...this.iogTariffCache.keys()]) {
      if (key.startsWith(prefix)) this.iogTariffCache.delete(key);
    }
    for (const key of [...this.iogTariffInflight.keys()]) {
      if (key.startsWith(prefix)) this.iogTariffInflight.delete(key);
    }
  }

  async onInit(): Promise<void> {
    this.registerBalanceFlowCards();
    this.registerBudgetFlowCards();
    this.registerSavingSessionCards();
    this.savingSessions = new SavingSessionsPoller(this);
    this.savingSessions.start();
    this.dispatches = new DispatchPoller(this);
    this.registerDispatchCards();
    this.dispatches.start();
    this.startLiveDemand();
    this.log('Octopus Energy app has been initialized');
  }

  /** Create the shared live-demand source and track the cadence setting. */
  private startLiveDemand(): void {
    const cadence = Number(this.homey.settings.get('live_demand_cadence_s')) || 120;
    this.liveDemand = new LiveDemandSource({
      getClient: (creds) => this.getKrakenClient(creds.apiKey, creds.accountNumber),
      setInterval: (fn, ms) => this.homey.setInterval(fn, ms),
      clearInterval: (handle) => this.homey.clearInterval(handle as NodeJS.Timeout),
      now: () => Date.now(),
      onError: (message, err) => this.error(message, err),
    }, cadence);
    this.homey.settings.on('set', (key: string) => {
      if (key === 'live_demand_cadence_s') {
        this.liveDemand?.setCadenceSeconds(Number(this.homey.settings.get('live_demand_cadence_s')) || 120);
      }
    });
  }

  /** Aggregate, identifier-free live-data diagnostics snapshot. */
  liveDataDiagnostics(): { budget: ReturnType<typeof budgetDiagnostics>; liveAccounts: number } {
    return { budget: budgetDiagnostics(), liveAccounts: this.liveDemand?.activeAccounts() ?? 0 };
  }

  async onUninit(): Promise<void> {
    this.savingSessions?.stop();
    this.dispatches?.stop();
    this.liveDemand?.stopAll();
  }

  /** App-level Saving Session Flow triggers. */
  private registerSavingSessionCards(): void {
    this.homey.flow.getTriggerCard('saving_session_starting_soon')
      .registerRunListener(async (args: { lead: number }, state: { minutesUntil: number }) => state.minutesUntil <= args.lead && state.minutesUntil > args.lead - 15);
  }

  /** App-level Intelligent Octopus Go dispatch condition. */
  private registerDispatchCards(): void {
    this.homey.flow.getConditionCard('dispatch_active')
      .registerRunListener(async () => Boolean(this.dispatches?.isActive()));
  }

  /** App-level budget and standing-charge Flow triggers (device-scoped). */
  private registerBudgetFlowCards(): void {
    this.homey.flow.getTriggerCard('cost_today_above')
      .registerRunListener(async (
        args: { device: Homey.Device; amount: number },
        state: { deviceId: string; cost: number; previous: number },
      ) => args.device.getData().id === state.deviceId
        && crossedAbove(state.cost, state.previous, args.amount));

    this.homey.flow.getTriggerCard('usage_today_above')
      .registerRunListener(async (
        args: { device: Homey.Device; amount: number },
        state: { deviceId: string; usage: number; previous: number },
      ) => args.device.getData().id === state.deviceId
        && crossedAbove(state.usage, state.previous, args.amount));

    this.homey.flow.getTriggerCard('standing_charge_changed')
      .registerRunListener(async (
        args: { device: Homey.Device },
        state: { deviceId: string },
      ) => args.device.getData().id === state.deviceId);

    this.homey.flow.getTriggerCard('tariff_changed')
      .registerRunListener(async (
        args: { device: Homey.Device },
        state: { deviceId: string },
      ) => args.device.getData().id === state.deviceId);
  }

  /** App-level account-balance Flow cards, scoped to a chosen meter device. */
  private registerBalanceFlowCards(): void {
    const { flow } = this.homey;

    flow.getTriggerCard('balance_changed')
      .registerRunListener(async (
        args: { device: Homey.Device },
        state: { deviceId: string },
      ) => args.device.getData().id === state.deviceId);

    flow.getTriggerCard('balance_below')
      .registerRunListener(async (
        args: { device: Homey.Device; amount: number },
        state: { deviceId: string; balance: number; previous?: number | null },
      ) => args.device.getData().id === state.deviceId && crossedBelow(state.balance, state.previous, args.amount));

    flow.getConditionCard('balance_below_now')
      .registerRunListener(async (args: { device: BalanceDevice; amount: number }) => {
        const balance = args.device.getBalance();
        return balance !== null && balance < args.amount;
      });
  }

};
