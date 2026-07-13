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

function slot(start, price) {
  return {
    valid_from: new Date(start).toISOString(),
    valid_to: new Date(start + 30 * 60_000).toISOString(),
    value_inc_vat: price,
    value_exc_vat: price,
    payment_method: null,
  };
}

function deviceWithRates(rates) {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.rates = rates;
  device.getSettings = () => ({ vat: 'inc' });
  device.nextLocalTime = () => new Date(Date.now() + 3 * 3600_000);
  return device;
}

test('cheapest planning keeps the currently active half-hour eligible', () => {
  const start = Math.floor(Date.now() / (30 * 60_000)) * 30 * 60_000;
  const device = deviceWithRates([slot(start, -5), slot(start + 30 * 60_000, 20)]);
  const chosen = device.getCheapestWindow(1, 2);
  assert.equal(chosen[0].valid_from, new Date(start).toISOString());
});

test('charge planning rejects a plan with fewer slots than requested', () => {
  const start = Math.floor(Date.now() / (30 * 60_000)) * 30 * 60_000;
  const device = deviceWithRates([slot(start, 5), slot(start + 30 * 60_000, 6)]);
  assert.deepEqual(device.getCheapestPlan(2, '07:00'), []);
  assert.equal(device.planCharge(14, 7, '07:00'), null);
});

test('peak-now evaluation includes the current export slot', () => {
  const start = Math.floor(Date.now() / (30 * 60_000)) * 30 * 60_000;
  const device = deviceWithRates([slot(start, 50), slot(start + 30 * 60_000, 5)]);
  assert.equal(device.isPeakNow(2, 0.5), true);
});
