'use strict';

// S65 (BL-24b) — consent-gated EV boost control on OctopusMeterDevice.
// Verifies: the write refuses unless the user has opted in; the device id is
// resolved to a boost-capable EV/charger; BOOST/CANCEL are passed through to the
// verified updateBoostCharge mutation; and a clear error when no device exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');
Module._load = originalLoad;

function makeDevice({ consent = true, devices = [] } = {}) {
  const calls = [];
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ apiKey: 'key-a', accountNumber: 'A-ONE' });
  device.kraken = {
    updateBoostCharge: async (deviceId, action) => {
      calls.push({ deviceId, action });
      return { currentState: action === 'BOOST' ? 'BOOSTING' : 'SMART_CONTROL_OFF' };
    },
  };
  device.homey = {
    settings: { get: (k) => (k === 'enable_boost_control' ? consent : undefined) },
    app: { getCachedDevices: async () => devices },
  };
  return { device, calls };
}

const EV = { deviceId: 'ev-1', category: 'EV', controlState: 'SMART_CONTROL_CAPABLE' };
const CHARGER = { deviceId: 'cp-1', category: 'CHARGE_POINT', controlState: null };
const BATTERY = { deviceId: 'batt-1', category: 'BATTERY', controlState: 'SMART_CONTROL_IN_PROGRESS' };

test('bumpCharge refuses when boost control is not enabled (consent gate, default OFF)', async () => {
  const { device, calls } = makeDevice({ consent: false, devices: [EV] });
  await assert.rejects(() => device.bumpCharge(), /turned off/i);
  assert.equal(calls.length, 0, 'no write is attempted without consent');
});

test('bumpCharge resolves a boost-capable EV and sends BOOST', async () => {
  const { device, calls } = makeDevice({ consent: true, devices: [BATTERY, EV] });
  const res = await device.bumpCharge();
  assert.deepEqual(calls, [{ deviceId: 'ev-1', action: 'BOOST' }]);
  assert.equal(res.currentState, 'BOOSTING');
});

test('cancelBoost sends CANCEL to the resolved device', async () => {
  const { device, calls } = makeDevice({ consent: true, devices: [EV] });
  const res = await device.cancelBoost();
  assert.deepEqual(calls, [{ deviceId: 'ev-1', action: 'CANCEL' }]);
  assert.equal(res.currentState, 'SMART_CONTROL_OFF');
});

test('boost resolution prefers a boost-capable device but falls back to the first EV/charger', async () => {
  const { device, calls } = makeDevice({ consent: true, devices: [CHARGER, EV] });
  await device.bumpCharge();
  assert.equal(calls[0].deviceId, 'ev-1', 'EV with a SMART_CONTROL state is preferred over the stateless charger');
});

test('bumpCharge throws a clear error when no EV/charger exists', async () => {
  const { device, calls } = makeDevice({ consent: true, devices: [BATTERY] });
  await assert.rejects(() => device.bumpCharge(), /No Intelligent Octopus Go device/i);
  assert.equal(calls.length, 0);
});
