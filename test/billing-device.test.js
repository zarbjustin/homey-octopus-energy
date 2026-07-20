'use strict';

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

function settingsStore() {
  const map = new Map();
  return { get: (k) => map.get(k), set: (k, v) => map.set(k, v), _map: map };
}

test('persistBillingSummary stores under a masked account key without the full number', () => {
  const settings = settingsStore();
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ accountNumber: 'A-12345678' });
  device.homey = { settings };
  device.error = () => {};

  device.persistBillingSummary({ importCost: 7.2, netPosition: 7.2 });

  const stored = settings.get('billing_summary_v1');
  const keys = Object.keys(stored);
  assert.equal(keys.length, 1);
  assert.equal(keys[0], 'A-***78');
  assert.equal(JSON.stringify(stored).includes('A-12345678'), false, 'the full account number is never stored');
  assert.equal(stored['A-***78'].importCost, 7.2);
  assert.ok(stored['A-***78'].updatedAt);
});

test('refreshBillingSummary is import-electricity only (export meter is skipped)', async () => {
  let fetched = false;
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ fuel: 'electricity', isExport: true, mpxn: '1', serial: 's', productCode: 'P', tariffCode: 'E-1R-P-A', accountNumber: 'A-ONE' });
  device.client = { consumption: async () => { fetched = true; return []; } };
  device.homey = { clock: { getTimezone: () => 'Europe/London' }, settings: settingsStore() };

  await device.refreshBillingSummary();
  assert.equal(fetched, false, 'export devices do not compute a billing summary');
});
