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
    return {
      name: device.getName(),
      carbon: cap('measure_octopus_carbon'),
      level: cap('octopus_carbon_level'),
      greenest: typeof device.isGreenestNow === 'function' ? device.isGreenestNow(12) : false,
    };
  },

};
