'use strict';

const { summaryMetricFreshness } = require('../../lib/statusPresentation');

module.exports = {

  async getData({ homey, query }) {
    const wanted = query && query.id;
    let device = null;
    let selectedDriver = null;
    for (const driverId of ['electricity', 'gas', 'export']) {
      let driver;
      try {
        driver = homey.drivers.getDriver(driverId);
      } catch (e) {
        continue;
      }
      const devices = driver.getDevices();
      if (wanted) {
        const found = devices.find((d) => d.getData().id === wanted);
        if (found) {
          device = found; selectedDriver = driverId;
        }
        if (device) break;
      } else if (!device && devices[0]) {
        device = devices[0]; selectedDriver = driverId;
      }
    }
    if (wanted && !device) return { error: 'The selected meter is no longer available.' };
    if (!device) return { error: 'No meter added yet.' };
    const cap = (c) => (device.hasCapability(c) ? device.getCapabilityValue(c) : null);
    let effectivePrice = null;
    try {
      if (typeof device.getCachedEffectiveRateView === 'function') {
        effectivePrice = device.getCachedEffectiveRateView();
      }
    } catch (e) {
      effectivePrice = null;
    }
    let breakdown = null;
    try {
      if (typeof device.getCachedSettledDailyUsage === 'function') {
        breakdown = device.getCachedSettledDailyUsage(7);
      }
    } catch (e) {
      breakdown = null;
    }
    const freshness = typeof device.getDataFreshness === 'function' ? device.getDataFreshness() : null;
    const metrics = {
      balance: cap('measure_octopus_balance'),
      usage: cap('octopus_usage_today'),
      cost: cap('octopus_cost_today'),
      month: cap('octopus_cost_month'),
      points: cap('octopus_points'),
    };
    return {
      name: device.getName(),
      freshness,
      metricFreshness: summaryMetricFreshness(freshness, metrics),
      health: typeof device.getDataHealthView === 'function' ? device.getDataHealthView() : null,
      chargingPlan: selectedDriver === 'electricity' && typeof device.getChargingPlanView === 'function' ? device.getChargingPlanView() : null,
      live: typeof device.getLiveDemandView === 'function' ? device.getLiveDemandView() : null,
      dispatch: typeof device.getDispatchView === 'function' ? device.getDispatchView() : null,
      // S44: opt-in estimated effective rate (confidence-tagged). Null unless IOG.
      effectivePrice,
      // BL-18b: settled 7-day usage history (backfills what Homey Insights can't).
      breakdown,
      presentation: typeof device.getPresentationFreshness === 'function' ? device.getPresentationFreshness() : null,
      ...metrics,
    };
  },

};
