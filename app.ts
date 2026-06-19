'use strict';

import Homey from 'homey';
import { SavingSessionsPoller } from './lib/SavingSessionsPoller';

interface BalanceDevice extends Homey.Device {
  getBalance(): number | null;
}

module.exports = class OctopusEnergyApp extends Homey.App {

  private savingSessions?: SavingSessionsPoller;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    this.registerBalanceFlowCards();
    this.registerSavingSessionCards();
    this.savingSessions = new SavingSessionsPoller(this);
    this.savingSessions.start();
    this.log('Octopus Energy app has been initialized');
  }

  async onUninit(): Promise<void> {
    this.savingSessions?.stop();
  }

  /** App-level Saving Session Flow triggers. */
  private registerSavingSessionCards(): void {
    this.homey.flow.getTriggerCard('saving_session_starting_soon')
      .registerRunListener(async (args: { lead: number }, state: { minutesUntil: number }) => state.minutesUntil <= args.lead && state.minutesUntil > args.lead - 16);
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
