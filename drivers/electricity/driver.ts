'use strict';

import Homey from 'homey';
import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';

interface ElectricityDevice extends Homey.Device {
  getCurrentPrice(): number | null;
  getPriceLevel(): string | null;
  isCheapestNow(hours?: number): boolean;
  isWithinCheapestPeriod(duration: number, within: number): boolean;
  refreshNow(): Promise<void>;
  findCheapestSlot(within: number, duration: number): { start_time: string; price: number } | null;
}

type Args<T> = T & { device: ElectricityDevice };

module.exports = class ElectricityDriver extends OctopusMeterDriver {

  async onInit(): Promise<void> {
    this.fuel = 'electricity';
    this.registerFlowCards();
    this.log('Electricity driver initialised');
  }

  private registerFlowCards(): void {
    const { flow } = this.homey;

    // Filtered triggers.
    flow.getDeviceTriggerCard('price_below')
      .registerRunListener(async (args: Args<{ price: number }>, state: { price: number }) => state.price < args.price);
    flow.getDeviceTriggerCard('cheapest_slot_started')
      .registerRunListener(async (args: Args<{ hours: number }>) => args.device.isCheapestNow(args.hours));

    // Conditions.
    flow.getConditionCard('price_below_now')
      .registerRunListener(async (args: Args<{ price: number }>) => {
        const p = args.device.getCurrentPrice();
        return p !== null && p < args.price;
      });
    flow.getConditionCard('is_cheapest_now')
      .registerRunListener(async (args: Args<{ hours: number }>) => args.device.isCheapestNow(args.hours));
    flow.getConditionCard('price_level_is')
      .registerRunListener(async (args: Args<{ level: string }>) => args.device.getPriceLevel() === args.level);
    flow.getConditionCard('within_cheapest_period')
      .registerRunListener(async (args: Args<{ duration: number; within: number }>) => args.device.isWithinCheapestPeriod(args.duration, args.within));

    // Actions.
    flow.getActionCard('refresh_now')
      .registerRunListener(async (args: Args<unknown>) => { await args.device.refreshNow(); });
    flow.getActionCard('find_cheapest_slot')
      .registerRunListener(async (args: Args<{ within: number; duration: number }>) => {
        const result = args.device.findCheapestSlot(args.within, args.duration);
        if (!result) throw new Error('No upcoming rates are available yet.');
        return result;
      });
  }

};
