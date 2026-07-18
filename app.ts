'use strict';

import Homey from 'homey';
import { SavingSessionsPoller } from './lib/SavingSessionsPoller';
import { DispatchPoller } from './lib/DispatchPoller';
import { Dispatch, KrakenClient } from './lib/KrakenClient';
import { crossedAbove, crossedBelow } from './lib/rates';

interface BalanceDevice extends Homey.Device {
  getBalance(): number | null;
}

module.exports = class OctopusEnergyApp extends Homey.App {

  private savingSessions?: SavingSessionsPoller;

  private dispatches?: DispatchPoller;

  private balanceCache = new Map<string, { value: number; ts: number }>();

  private balanceInflight = new Map<string, Promise<number>>();

  private krakenClients = new Map<string, { apiKey: string; client: KrakenClient }>();

  private plannedDispatchCache = new Map<string, { value: Dispatch[]; ts: number }>();

  private plannedDispatchInflight = new Map<string, Promise<Dispatch[]>>();

  private completedDispatchCache = new Map<string, { value: Dispatch[]; ts: number }>();

  private completedDispatchInflight = new Map<string, Promise<Dispatch[]>>();

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
    const client = new KrakenClient(apiKey);
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

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    this.registerBalanceFlowCards();
    this.registerBudgetFlowCards();
    this.registerSavingSessionCards();
    this.savingSessions = new SavingSessionsPoller(this);
    this.savingSessions.start();
    this.dispatches = new DispatchPoller(this);
    this.registerDispatchCards();
    this.dispatches.start();
    this.log('Octopus Energy app has been initialized');
  }

  async onUninit(): Promise<void> {
    this.savingSessions?.stop();
    this.dispatches?.stop();
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
