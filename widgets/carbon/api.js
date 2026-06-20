'use strict';

module.exports = {

  async getData({ homey, query }) {
    const driver = homey.drivers.getDriver('electricity');
    const devices = driver.getDevices();
    const device = devices.find((d) => d.getData().id === (query && query.id)) || devices[0];
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
