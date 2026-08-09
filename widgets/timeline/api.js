'use strict';

const { widgetPriceBandOptions, withPriceBands } = require('../../lib/widgetPriceBands');

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
    const bandOptions = widgetPriceBandOptions({
      greenMax: query && query.green_max,
      yellowMax: query && query.yellow_max,
      orangeMax: query && query.orange_max,
      palette: query && query.palette,
    });
    return {
      name: device.getName(),
      freshness: typeof device.getDataFreshness === 'function' ? device.getDataFreshness() : null,
      prices: withPriceBands(device.getUpcomingPrices(12), bandOptions),
      bandOptions,
    };
  },

};
