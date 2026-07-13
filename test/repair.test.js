'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Driver: class Driver {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDriver } = require('../.homeybuild/lib/OctopusMeterDriver.js');
const { OctopusClient } = require('../.homeybuild/lib/OctopusClient.js');
Module._load = originalLoad;

test('repair refuses to rebind a device to a different meter serial', async (t) => {
  t.mock.method(OctopusClient.prototype, 'discoverMeters', async () => [{
    fuel: 'electricity', mpxn: '111', serial: 'replacement', isExport: false,
    tariffCode: 'E-1R-AGILE-C', productCode: 'AGILE',
  }]);
  const driver = Object.create(OctopusMeterDriver.prototype);
  driver.fuel = 'electricity';
  let login;
  const session = { setHandler: (name, handler) => { if (name === 'login') login = handler; } };
  const writes = [];
  const device = {
    getStoreValue: (key) => ({ mpxn: '111', serial: 'original' }[key]),
    setStoreValue: async (...args) => { writes.push(args); },
  };
  await driver.onRepair(session, device);
  await assert.rejects(() => login({ apiKey: 'key', account: 'A-ONE' }), /original meter was not found/);
  assert.equal(writes.length, 0);
});
