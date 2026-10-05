'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const GasDevice = require('../.homeybuild/drivers/gas/device.js');
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');

Module._load = originalLoad;

test('gas carbon preserves unknown usage, while genuine zero and measured kWh remain numeric', async (t) => {
  t.mock.method(OctopusMeterDevice.prototype, 'refreshExtra', async () => {});
  for (const [usage, expected] of [[null, null], [undefined, null], [NaN, null], ['', null], [0, 0], [10, 1.83]]) {
    const device = Object.create(GasDevice.prototype);
    device.hasCapability = () => true;
    device.getCapabilityValue = () => usage;
    let written;
    device.setCapabilityValue = async (_id, value) => {
      written = value;
    };
    device.error = () => {};
    await device.refreshExtra(1);
    assert.equal(written, expected);
  }
});
