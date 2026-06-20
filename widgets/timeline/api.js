'use strict';

module.exports = {

  async getData({ homey, query }) {
    const driver = homey.drivers.getDriver('electricity');
    const devices = driver.getDevices();
    const device = devices.find((d) => d.getData().id === (query && query.id)) || devices[0];
    if (!device) return { error: 'No electricity meter added yet.' };
    return {
      name: device.getName(),
      prices: device.getUpcomingPrices(12),
    };
  },

};
