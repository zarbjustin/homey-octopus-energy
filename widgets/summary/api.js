'use strict';

module.exports = {

  async getData({ homey, query }) {
    const wanted = query && query.id;
    let device = null;
    for (const driverId of ['electricity', 'gas', 'export']) {
      let driver;
      try { driver = homey.drivers.getDriver(driverId); } catch (e) { continue; }
      const devices = driver.getDevices();
      device = devices.find((d) => d.getData().id === wanted) || device || devices[0];
      if (device && device.getData().id === wanted) break;
    }
    if (!device) return { error: 'No meter added yet.' };
    const cap = (c) => (device.hasCapability(c) ? device.getCapabilityValue(c) : null);
    return {
      name: device.getName(),
      balance: cap('octopus_balance'),
      usage: cap('octopus_usage_today'),
      cost: cap('octopus_cost_today'),
      month: cap('octopus_cost_month'),
      points: cap('octopus_points'),
    };
  },

};
