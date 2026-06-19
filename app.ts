'use strict';

import Homey from 'homey';

interface BalanceDevice extends Homey.Device {
  getBalance(): number | null;
}

module.exports = class OctopusEnergyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    this.registerBalanceFlowCards();
    this.log('Octopus Energy app has been initialized');
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
