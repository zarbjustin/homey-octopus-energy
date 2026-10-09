'use strict';

const { supportSnapshot } = require('./lib/supportSnapshot');

function read(operation) {
  try {
    return operation();
  } catch (err) {
    return null;
  }
}

module.exports = {
  async getSupportSnapshot({ homey }) {
    const meters = [];
    const driverReads = {};
    for (const kind of ['electricity', 'gas', 'export']) {
      const devices = read(() => homey.drivers.getDriver(kind).getDevices());
      driverReads[kind] = Array.isArray(devices);
      if (!driverReads[kind]) continue;
      // Bound processing even if an unexpected registry returns excessive devices.
      for (const device of devices.slice(0, 101)) {
        const freshness = read(() => device.getDataFreshness());
        meters.push({
          kind,
          freshness,
          freshnessRead: freshness !== null && typeof freshness === 'object' && !Array.isArray(freshness),
          plan: kind === 'electricity' ? read(() => device.getChargingPlanView()) : null,
        });
      }
    }
    return supportSnapshot({
      version: read(() => homey.manifest.version),
      meters,
      driverReads,
      sessions: read(() => homey.settings.get('saving_sessions_diagnostics_v1')),
      dispatch: read(() => homey.settings.get('dispatch_diagnostics_v2')),
    });
  },
};
