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
  device.formatLocal = (date) => date.toISOString();
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

test('charge planning prices only the energy requested in the final slot', () => {
  const start = Math.floor(Date.now() / (30 * 60_000)) * 30 * 60_000;
  const device = deviceWithRates([slot(start, 20), slot(start + 30 * 60_000, 30)]);
  const plan = device.planCharge(4, 7, '07:00');

  assert.equal(plan.count, 2);
  assert.equal(plan.cost, 0.85); // 3.5 kWh at 20p plus 0.5 kWh at 30p.
});

test('charge planning rejects non-positive energy or charge rates', () => {
  const start = Math.floor(Date.now() / (30 * 60_000)) * 30 * 60_000;
  const device = deviceWithRates([slot(start, 20)]);
  assert.equal(device.planCharge(0, 7, '07:00'), null);
  assert.equal(device.planCharge(7, 0, '07:00'), null);
});

test('tariff comparison uses one-register codes for candidates from an Economy 7 tariff', async () => {
  const recordStart = '2026-07-01T00:00:00.000Z';
  const records = [{
    consumption: 1,
    interval_start: recordStart,
    interval_end: '2026-07-01T00:30:00.000Z',
  }];
  const rates = [{
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_to: null,
    value_inc_vat: 20,
    value_exc_vat: 20,
    payment_method: null,
  }];
  const candidateTariffs = [];
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({
    fuel: 'electricity', mpxn: '123', serial: 'meter-1',
    productCode: 'CURRENT', tariffCode: 'E-2R-CURRENT-A',
  });
  device.client = {
    consumption: async () => records,
    findProductCode: async (fragment) => fragment.toUpperCase(),
    tariffCodeForProduct: async (code) => `E-1R-${code}-A`,
    registerUnitRates: async () => rates,
    standardUnitRates: async (_fuel, _product, tariff) => {
      candidateTariffs.push(tariff);
      return rates;
    },
    standingCharges: async () => [],
  };
  device.rateForRecord = () => rates[0];
  device.toEnergyUnit = (value) => value;
  device.vatInc = () => true;
  device.error = () => {};

  await device.compareTariffs(30);

  assert.deepEqual(candidateTariffs, [
    'E-1R-AGILE-A',
    'E-1R-GO-A',
    'E-1R-FLEXIBLE-A',
  ]);
});

test('zoned tariff boundaries preserve 23-hour and 25-hour UK DST days', () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.homey = { clock: { getTimezone: () => 'Europe/London' } };

  const springStart = device.zonedTime(2026, 3, 29);
  const springEnd = device.zonedTime(2026, 3, 30);
  const autumnStart = device.zonedTime(2026, 10, 25);
  const autumnEnd = device.zonedTime(2026, 10, 26);

  assert.equal(springEnd.getTime() - springStart.getTime(), 23 * 3600_000);
  assert.equal(autumnEnd.getTime() - autumnStart.getTime(), 25 * 3600_000);
});
