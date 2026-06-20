'use strict';

import Homey from 'homey';
import { SavingSessionsPoller } from './lib/SavingSessionsPoller';
import { DispatchPoller } from './lib/DispatchPoller';

interface BalanceDevice extends Homey.Device {
  getBalance(): number | null;
}

module.exports = class OctopusEnergyApp extends Homey.App {

  private savingSessions?: SavingSessionsPoller;

  private dispatches?: DispatchPoller;

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
      .registerRunListener(async (args: { lead: number }, state: { minutesUntil: number }) => state.minutesUntil <= args.lead && state.minutesUntil > args.lead - 16);
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
        state: { deviceId: string; cost: number },
      ) => args.device.getData().id === state.deviceId && state.cost > args.amount);

    this.homey.flow.getTriggerCard('usage_today_above')
      .registerRunListener(async (
        args: { device: Homey.Device; amount: number },
        state: { deviceId: string; usage: number },
      ) => args.device.getData().id === state.deviceId && state.usage > args.amount);

    this.homey.flow.getTriggerCard('standing_charge_changed')
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
        state: { deviceId: string; balance: number },
      ) => args.device.getData().id === state.deviceId && state.balance < args.amount);

    flow.getConditionCard('balance_below_now')
      .registerRunListener(async (args: { device: BalanceDevice; amount: number }) => {
        const balance = args.device.getBalance();
        return balance !== null && balance < args.amount;
      });
  }

};
