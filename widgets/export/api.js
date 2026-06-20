'use strict';

module.exports = {

  async getData({ homey, query }) {
    const driver = homey.drivers.getDriver('export');
    const devices = driver.getDevices();
    const device = devices.find((d) => d.getData().id === (query && query.id)) || devices[0];
    if (!device) return { error: 'No export meter added yet.' };
    const cap = (c) => (device.hasCapability(c) ? device.getCapabilityValue(c) : null);
    let peak = null;
    try {
      peak = typeof device.findPeakSlot === 'function' ? device.findPeakSlot(12, 0.5) : null;
    } catch (err) {
      peak = null;
    }
    return {
      name: device.getName(),
      rate: cap('measure_octopus_price'),
      today: cap('octopus_earnings_today'),
      month: cap('octopus_earnings_month'),
      exported: cap('octopus_usage_today'),
      peakStart: peak ? peak.start_time : null,
      peakPrice: peak ? peak.price : null,
    };
  },

};
