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

function pointsDevice(getOctoplusPoints) {
  const logs = [];
  const capabilities = {};
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ accountNumber: 'A-ONE' });
  device.hasCapability = () => true;
  device.kraken = { getOctoplusPoints };
  device.setCapabilityValue = async (cap, value) => { capabilities[cap] = value; };
  device.log = (...args) => logs.push(args.join(' '));
  device.error = () => {};
  return { device, logs, capabilities };
}

test('points refresh backs off for 24h and logs once when the field is unsupported', async () => {
  let calls = 0;
  const { device, logs } = pointsDevice(async () => { calls += 1; return null; });

  await device.refreshPoints();
  await device.refreshPoints();
  await device.refreshPoints();

  // Only the first attempt reaches Kraken; the unsupported backoff blocks the rest.
  assert.equal(calls, 1);
  assert.equal(logs.filter((l) => /pausing points refresh/i.test(l)).length, 1);
});

test('points refresh updates the capability and clears the unsupported flag on success', async () => {
  const { device, capabilities } = pointsDevice(async () => 720);

  await device.refreshPoints();

  assert.equal(capabilities.octopus_points, 720);
});

test('a transient points failure only retries at most hourly, not every cycle', async () => {
  let calls = 0;
  const { device } = pointsDevice(async () => { calls += 1; throw new Error('Transient Kraken error 503'); });

  await assert.rejects(device.refreshPoints(), /Transient Kraken error 503/);
  // The cooldown was advanced before the call, so an immediate second refresh is skipped.
  await device.refreshPoints();

  assert.equal(calls, 1);
});

test('a recovered account resumes points polling after credentials are re-applied', async () => {
  let mode = 'unsupported';
  const { device, capabilities } = pointsDevice(async () => (mode === 'unsupported' ? null : 55));

  await device.refreshPoints(); // enters 24h backoff

  // applyCredentials resets the per-account points state.
  device.refreshPromise = null;
  device.rates = [];
  device.nightRates = [];
  device.standingRates = [];
  device.setStoreValue = async () => {};
  device.getStoreValue = () => undefined;
  device.homey = { app: {} };
  device.buildClients = () => {};
  device.onCredentialsApplied = async () => {};
  device.ensureRegisterCapabilities = async () => {};
  device.refresh = async () => {};
  await device.applyCredentials({
    apiKey: 'k', accountNumber: 'A-ONE', mpxn: '1', serial: 's',
    fuel: 'electricity', isExport: false, productCode: 'P', tariffCode: 'E-1R-P-A',
  });

  mode = 'ok';
  await device.refreshPoints();
  assert.equal(capabilities.octopus_points, 55);
});

test('a price gap logs a privacy-safe diagnostic shape and throws', async () => {
  const now = Date.now();
  const stalePrimary = [slot(now - 3 * 3600_000, 20)]; // ended before now
  const staleFallback = [slot(now - 2 * 3600_000, 21)]; // also ended before now
  const logs = [];
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ fuel: 'electricity', isExport: false, productCode: 'VAR-22-11-01', tariffCode: 'E-1R-VAR-22-11-01-A' });
  device.isTwoRegisterTariff = () => false;
  device.isDynamicTariff = () => false;
  device.client = {
    standardUnitRates: async () => stalePrimary,
    latestStandardUnitRates: async () => staleFallback,
  };
  device.onRatesUpdated = async () => {};
  device.vatInc = () => true;
  device.setCapabilityValue = async () => {};
  device.onPriceUpdated = async () => {};
  device.log = (...args) => logs.push(args.join(' '));
  device.error = () => {};

  await assert.rejects(device.refreshPrices(), /no rate covering the current time/);

  const line = logs.find((l) => l.includes('price-gap diagnostic'));
  assert.ok(line, 'a price-gap diagnostic line should be logged');
  const json = line.slice(line.indexOf('{'));
  const shape = JSON.parse(json);
  assert.equal(shape.role, 'import');
  assert.equal(shape.register, '1R');
  assert.equal(shape.productFamily, 'VAR');
  assert.equal(shape.dynamic, false);
  assert.equal(shape.primaryCount, 1);
  assert.equal(shape.primaryCurrentFound, false);
  assert.equal(shape.fallbackFetched, true);
  assert.equal(shape.fallbackCurrentFound, false);
  // The diagnostic must never leak identifiers.
  assert.doesNotMatch(json, /E-1R-VAR-22-11-01-A|A-ONE/);
});
