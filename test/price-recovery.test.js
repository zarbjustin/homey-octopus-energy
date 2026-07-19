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

// Build a device whose refreshPrices only succeeds once the stored tariff code
// matches `workingCode`. Everything the recovery path touches is stubbed.
function recoveryDevice({ workingCode, candidate }) {
  const store = {
    fuel: 'electricity',
    isExport: false,
    productCode: 'VAR-22-11-01',
    tariffCode: 'E-1R-VAR-22-11-01-C',
  };
  const logs = [];
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => store;
  device.setStoreValue = async (key, value) => { store[key] = value; };
  device.isTwoRegisterTariff = () => false;
  device.checkTariffChange = async () => false; // account discovery yields the same code
  device.client = {
    tariffCodeForProduct: async () => candidate,
  };
  device.log = (...args) => logs.push(args.join(' '));
  device.error = () => {};
  device.refreshPrices = async () => {
    if (workingCode && store.tariffCode === workingCode) return;
    throw new Error('Octopus returned no rate covering the current time.');
  };
  return { device, store, logs };
}

test('guarded recovery switches to a product-derived tariff variant that resolves the gap', async () => {
  const { device, store, logs } = recoveryDevice({
    workingCode: 'E-1R-VAR-22-11-01-CORRECT-C',
    candidate: 'E-1R-VAR-22-11-01-CORRECT-C',
  });

  await device.refreshPricesWithTariffRecovery();

  assert.equal(store.tariffCode, 'E-1R-VAR-22-11-01-CORRECT-C');
  assert.ok(logs.some((l) => /switched to a product-derived tariff variant/i.test(l)));
});

test('guarded recovery reverts and rethrows when the derived variant still fails', async () => {
  const { device, store } = recoveryDevice({
    workingCode: null, // nothing ever works
    candidate: 'E-1R-VAR-22-11-01-OTHER-C',
  });

  await assert.rejects(
    device.refreshPricesWithTariffRecovery(),
    /no rate covering the current time/,
  );
  // The unverified guess must not be persisted.
  assert.equal(store.tariffCode, 'E-1R-VAR-22-11-01-C');
});

test('guarded recovery is a no-op when the product advertises the same code', async () => {
  const { device, store } = recoveryDevice({
    workingCode: null,
    candidate: 'E-1R-VAR-22-11-01-C', // identical to stored
  });

  await assert.rejects(
    device.refreshPricesWithTariffRecovery(),
    /no rate covering the current time/,
  );
  assert.equal(store.tariffCode, 'E-1R-VAR-22-11-01-C');
});

test('guarded recovery still prefers a genuine tariff change from account discovery', async () => {
  const store = {
    fuel: 'electricity', isExport: false, productCode: 'VAR', tariffCode: 'E-1R-OLD-C',
  };
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => store;
  device.setStoreValue = async (k, v) => { store[k] = v; };
  device.isTwoRegisterTariff = () => false;
  device.checkTariffChange = async () => { store.tariffCode = 'E-1R-NEW-C'; return true; };
  let variantLookupCalled = false;
  device.client = { tariffCodeForProduct: async () => { variantLookupCalled = true; return 'X'; } };
  device.log = () => {};
  device.error = () => {};
  let attempts = 0;
  device.refreshPrices = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Octopus returned no rate covering the current time.');
  };

  await device.refreshPricesWithTariffRecovery();

  assert.equal(store.tariffCode, 'E-1R-NEW-C');
  assert.equal(variantLookupCalled, false, 'variant lookup should not run when discovery already fixed the tariff');
});
