'use strict';

import Homey from 'homey';
import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';
import { crossedBelow } from '../../lib/rates';

interface GasDevice extends Homey.Device {
  getCurrentPrice(): number | null;
}

type Args<T> = T & { device: GasDevice };

module.exports = class GasDriver extends OctopusMeterDriver {

  async onInit(): Promise<void> {
    this.fuel = 'gas';
    this.homey.flow.getDeviceTriggerCard('gas_price_below')
      .registerRunListener(async (args: Args<{ price: number }>, state: { price: number; previous: number | null }) => (
        crossedBelow(state.price, state.previous, args.price)
      ));
    this.homey.flow.getConditionCard('gas_price_below')
      .registerRunListener(async (args: Args<{ price: number }>) => {
        const p = args.device.getCurrentPrice();
        return p !== null && p < args.price;
      });
    this.log('Gas driver initialised');
  }

};
