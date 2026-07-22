'use strict';

module.exports = {

  async getData({ homey, query }) {
    const wanted = query && query.id;
    let device = null;
    for (const driverId of ['electricity', 'gas', 'export']) {
      let driver;
      try { driver = homey.drivers.getDriver(driverId); } catch (e) { continue; }
      const devices = driver.getDevices();
      if (wanted) {
        device = devices.find((d) => d.getData().id === wanted) || device;
        if (device) break;
      } else {
        device = device || devices[0];
      }
    }
    if (wanted && !device) return { error: 'The selected meter is no longer available.' };
    if (!device) return { error: 'No meter added yet.' };
    const cap = (c) => (device.hasCapability(c) ? device.getCapabilityValue(c) : null);
    let effectivePrice = null;
    try {
      if (typeof device.getEffectiveRateView === 'function') {
        effectivePrice = await device.getEffectiveRateView();
      }
    } catch (e) {
      effectivePrice = null;
    }
    let breakdown = null;
    try {
      if (typeof device.getSettledDailyUsage === 'function') {
        breakdown = await device.getSettledDailyUsage(7);
      }
    } catch (e) {
      breakdown = null;
    }
    return {
      name: device.getName(),
      freshness: typeof device.getDataFreshness === 'function' ? device.getDataFreshness() : null,
      live: typeof device.getLiveDemandView === 'function' ? device.getLiveDemandView() : null,
      dispatch: typeof device.getDispatchView === 'function' ? device.getDispatchView() : null,
      // S44: opt-in estimated effective rate (confidence-tagged). Null unless IOG.
      effectivePrice,
      // BL-18b: settled 7-day usage history (backfills what Homey Insights can't).
      breakdown,
      balance: cap('measure_octopus_balance'),
      usage: cap('octopus_usage_today'),
      cost: cap('octopus_cost_today'),
      month: cap('octopus_cost_month'),
      points: cap('octopus_points'),
    };
  },

};
