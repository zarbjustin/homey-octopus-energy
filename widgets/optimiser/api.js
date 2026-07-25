'use strict';

function bounded(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

module.exports = {

  async getData({ homey, query }) {
    const driver = homey.drivers.getDriver('electricity');
    const devices = driver.getDevices();
    const wanted = query && query.id;
    const device = wanted
      ? devices.find((candidate) => candidate.getData().id === wanted)
      : devices[0];
    if (wanted && !device) return { error: 'The selected electricity meter is no longer available.' };
    if (!device) return { error: 'No electricity meter added yet.' };
    if (typeof device.getCostCarbonPlan !== 'function') {
      return { error: 'The optimiser is not available for this meter yet.' };
    }

    const duration = bounded(query && query.duration, 2, 0.5, 12);
    const within = bounded(query && query.within, 12, 1, 48);
    const greenness = bounded(query && query.greenness, 0.5, 0, 1);
    return {
      name: device.getName(),
      freshness: typeof device.getDataFreshness === 'function' ? device.getDataFreshness() : null,
      duration,
      within,
      greenness,
      plan: device.getCostCarbonPlan(duration, within, greenness),
    };
  },

};
