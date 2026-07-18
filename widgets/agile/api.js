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

    let cheapestCount = 6;
    if (query && query.cheapest !== undefined && query.cheapest !== '') {
      const n = Number(query.cheapest);
      if (Number.isFinite(n)) cheapestCount = Math.max(0, Math.min(24, Math.round(n)));
    }

    let data;
    try {
      data = typeof device.getFreshAgileDayData === 'function'
        ? await device.getFreshAgileDayData(cheapestCount)
        : device.getAgileDayData(cheapestCount);
    } catch (err) {
      return { error: (err && err.message) ? err.message : 'No price data yet.' };
    }

    return {
      name: device.getName(),
      ...data,
    };
  },

};
