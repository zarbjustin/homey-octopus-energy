'use strict';

module.exports = {

  async getData({ homey, query }) {
    const driver = homey.drivers.getDriver('electricity');
    const devices = driver.getDevices();
    const wanted = query && query.id;
    const device = devices.find((d) => d.getData().id === wanted) || devices[0];
    if (!device) return { error: 'No electricity meter added yet.' };

    let cheapestCount = 6;
    if (query && query.cheapest !== undefined && query.cheapest !== '') {
      const n = Number(query.cheapest);
      if (Number.isFinite(n)) cheapestCount = Math.max(0, Math.min(24, Math.round(n)));
    }

    let data;
    try {
      data = device.getAgileDayData(cheapestCount);
    } catch (err) {
      return { error: (err && err.message) ? err.message : 'No price data yet.' };
    }

    return {
      name: device.getName(),
      ...data,
    };
  },

};
