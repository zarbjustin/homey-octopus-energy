'use strict';

module.exports = {

  async getData({ homey, query }) {
    const driver = homey.drivers.getDriver('electricity');
    const devices = driver.getDevices();
    const wanted = query && query.id;
    const device = wanted
      ? devices.find((d) => d.getData().id === wanted)
      : devices[0];
    if (wanted && !device) return { error: 'The selected electricity meter is no longer available.' };
    if (!device) return { error: 'No electricity meter added yet.' };

    const cap = (c) => (device.hasCapability(c) ? device.getCapabilityValue(c) : null);

    let cheapest = null;
    try {
      cheapest = device.findCheapestSlot(12, 0.5);
    } catch (err) {
      cheapest = null;
    }

    return {
      name: device.getName(),
      freshness: typeof device.getDataFreshness === 'function' ? device.getDataFreshness() : null,
      price: cap('measure_octopus_price'),
      level: cap('octopus_price_level'),
      standing: cap('octopus_standing_charge'),
      usage: cap('octopus_usage_today'),
      cost: cap('octopus_cost_today'),
      balance: cap('measure_octopus_balance'),
      power: cap('measure_power'),
      cheapestStart: cheapest ? cheapest.start_time : null,
      cheapestPrice: cheapest ? cheapest.price : null,
    };
  },

};
