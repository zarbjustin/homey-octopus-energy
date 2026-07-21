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

// --- IOG price gap + budget fix ---------------------------------------------

test('forced price-gap recovery is throttled to once per 6h (budget/log churn)', async () => {
  const store = { fuel: 'electricity', isExport: false, productCode: 'VAR-22-11-01', tariffCode: 'E-1R-VAR-22-11-01-C' };
  const device = Object.create(OctopusMeterDevice.prototype);
  let checks = 0;
  device.store = () => store;
  device.setStoreValue = async () => {};
  device.isTwoRegisterTariff = () => false;
  device.isIntelligentGoTariff = () => false;
  device.checkTariffChange = async () => { checks += 1; return false; };
  device.tryProductVariantRecovery = async () => false;
  device.log = () => {};
  device.error = () => {};
  device.refreshPrices = async () => { throw new Error('Octopus returned no rate covering the current time.'); };

  await assert.rejects(device.refreshPricesWithTariffRecovery());
  assert.equal(checks, 1, 'first gap attempts forced recovery');
  await assert.rejects(device.refreshPricesWithTariffRecovery());
  assert.equal(checks, 1, 'a second gap within 6h does NOT re-run forced recovery');
});

test('an IOG import meter never runs product-variant recovery', async () => {
  const store = { fuel: 'electricity', isExport: false, productCode: 'IOG-VAR-26-01-01', tariffCode: 'E-1R-IOG-VAR-26-01-01-C' };
  const device = Object.create(OctopusMeterDevice.prototype);
  let variantTried = 0;
  device.store = () => store;
  device.setStoreValue = async () => {};
  device.isTwoRegisterTariff = () => false;
  device.isIntelligentGoTariff = () => true;
  device.checkTariffChange = async () => false;
  device.tryProductVariantRecovery = async () => { variantTried += 1; return false; };
  device.log = () => {};
  device.error = () => {};
  device.refreshPrices = async () => { throw new Error('Octopus returned no rate covering the current time.'); };

  await assert.rejects(device.refreshPricesWithTariffRecovery());
  assert.equal(variantTried, 0, 'IOG must not guess a product-derived variant');
});

test('checkTariffChange never lets REST clobber an IOG import tariff code (anti ping-pong)', async () => {
  const store = { fuel: 'electricity', isExport: false, accountNumber: 'A-1', mpxn: '1234', productCode: 'IOG-VAR-26-01-01', tariffCode: 'E-1R-IOG-VAR-26-01-01-C' };
  const device = Object.create(OctopusMeterDevice.prototype);
  let discovered = 0;
  device.store = () => store;
  device.isIntelligentGoTariff = () => true;
  device.client = { discoverMeters: async () => { discovered += 1; return []; } };

  const changed = await device.checkTariffChange(true);
  assert.equal(changed, false);
  assert.equal(discovered, 0, 'REST discovery is not even consulted for an IOG import meter');
});

test('intelligentGoBaseRates adopts the resolved household code when the stored one is stale', async () => {
  const store = { fuel: 'electricity', isExport: false, accountNumber: 'A-1', productCode: 'IOG-STALE-26-01-01', tariffCode: 'E-1R-IOG-STALE-26-01-01-C' };
  const device = Object.create(OctopusMeterDevice.prototype);
  let invalidated = 0;
  device.store = () => store;
  device.setStoreValue = async (k, v) => { store[k] = v; };
  device.isIntelligentGoTariff = () => true;
  device.ensureRegisterCapabilities = async () => {};
  device.log = () => {};
  device.error = () => {};
  device.homey = { clock: { getTimezone: () => 'Europe/London' }, app: { invalidateIogTariff: () => { invalidated += 1; } } };
  device.vatInc = () => true;
  device.localMidnight = (d) => new Date(Date.UTC(2026, 0, 1 + d));
  device.kraken = {
    getActiveIogTariff: async () => ({
      tariffType: 'DayNightTariff', resolvedVia: 'fallback', scheduleTrusted: true, validTo: null,
      tariffCode: 'E-1R-IOG-REAL-26-01-01-C', productCode: 'IOG-REAL-26-01-01',
      dayRate: 31.5, nightRate: 8, preVatDayRate: 30, preVatNightRate: 7.619,
      evDevicePeakRate: null, evDeviceOffPeakRate: null,
      preVatEvDevicePeakRate: null, preVatEvDeviceOffPeakRate: null, standingCharge: 49,
    }),
  };

  const rates = await device.intelligentGoBaseRates();
  assert.ok(rates && rates.length > 0, 'the household schedule is synthesized');
  assert.equal(store.tariffCode, 'E-1R-IOG-REAL-26-01-01-C', 'adopted the real code');
  assert.equal(store.productCode, 'IOG-REAL-26-01-01');
  assert.equal(invalidated, 1, 'the IOG tariff cache is invalidated (not the whole account/budget)');
});

test('intelligentGoBaseRates adopts an untrusted-shape code but defers rates to REST', async () => {
  const store = { fuel: 'electricity', isExport: false, accountNumber: 'A-1', productCode: 'INTELLI-STALE-26-01-01', tariffCode: 'E-1R-INTELLI-STALE-26-01-01-C' };
  const device = Object.create(OctopusMeterDevice.prototype);
  let invalidated = 0;
  device.store = () => store;
  device.setStoreValue = async (k, v) => { store[k] = v; };
  device.isIntelligentGoTariff = () => true;
  device.ensureRegisterCapabilities = async () => {};
  device.log = () => {};
  device.error = () => {};
  device.homey = { clock: { getTimezone: () => 'Europe/London' }, app: { invalidateIogTariff: () => { invalidated += 1; } } };
  device.vatInc = () => true;
  device.localMidnight = (d) => new Date(Date.UTC(2026, 0, 1 + d));
  const restCalls = [];
  device.client = {
    standardUnitRates: async (fuel, productCode, tariffCode) => {
      restCalls.push({ productCode, tariffCode });
      // The adopted (live) code returns real rows covering now; the stale one did not.
      if (productCode === 'INTELLI-REAL-26-01-01') {
        const from = new Date(Date.now() - 3600_000).toISOString();
        const to = new Date(Date.now() + 3600_000).toISOString();
        return [{ value_inc_vat: 24, value_exc_vat: 22.8, valid_from: from, valid_to: to, payment_method: null }];
      }
      return [];
    },
  };
  device.kraken = {
    // A StandardTariff/HalfHourly-style agreement: resolved for code adoption
    // only. We must NOT fabricate a day/night schedule from it.
    getActiveIogTariff: async () => ({
      tariffType: 'StandardTariff', resolvedVia: 'fallback', scheduleTrusted: false, validTo: null,
      tariffCode: 'E-1R-INTELLI-REAL-26-01-01-C', productCode: 'INTELLI-REAL-26-01-01',
      dayRate: 28.95, nightRate: 28.95, preVatDayRate: 27.571, preVatNightRate: 27.571,
      evDevicePeakRate: null, evDeviceOffPeakRate: null,
      preVatEvDevicePeakRate: null, preVatEvDeviceOffPeakRate: null, standingCharge: 49,
    }),
  };

  const rates = await device.intelligentGoBaseRates();
  // The live code is adopted AND its authoritative REST rows are recovered in the
  // same cycle — never a fabricated day/night schedule.
  assert.ok(Array.isArray(rates) && rates.length === 1, 'recovered the adopted code\'s REST rows');
  assert.equal(rates[0].value_inc_vat, 24);
  assert.deepEqual(restCalls, [{ productCode: 'INTELLI-REAL-26-01-01', tariffCode: 'E-1R-INTELLI-REAL-26-01-01-C' }]);
  assert.equal(store.tariffCode, 'E-1R-INTELLI-REAL-26-01-01-C', 'the live code is still adopted');
  assert.equal(store.productCode, 'INTELLI-REAL-26-01-01');
  assert.equal(invalidated, 1, 'adoption invalidated the IOG tariff cache');
});

test('intelligentGoBaseRates fails closed to null when an untrusted adopted code still has no REST rows', async () => {
  const store = { fuel: 'electricity', isExport: false, accountNumber: 'A-1', productCode: 'INTELLI-STALE-26-01-01', tariffCode: 'E-1R-INTELLI-STALE-26-01-01-C' };
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => store;
  device.setStoreValue = async (k, v) => { store[k] = v; };
  device.isIntelligentGoTariff = () => true;
  device.ensureRegisterCapabilities = async () => {};
  device.log = () => {};
  device.error = () => {};
  device.homey = { clock: { getTimezone: () => 'Europe/London' }, app: { invalidateIogTariff: () => {} } };
  device.vatInc = () => true;
  device.localMidnight = (d) => new Date(Date.UTC(2026, 0, 1 + d));
  device.client = { standardUnitRates: async () => [] }; // no rows even for the live code
  device.kraken = {
    getActiveIogTariff: async () => ({
      tariffType: 'HalfHourlyTariff', resolvedVia: 'fallback', scheduleTrusted: false, validTo: null,
      tariffCode: 'E-1R-INTELLI-REAL-26-01-01-C', productCode: 'INTELLI-REAL-26-01-01',
      dayRate: 0, nightRate: 0, preVatDayRate: 0, preVatNightRate: 0,
      evDevicePeakRate: null, evDeviceOffPeakRate: null,
      preVatEvDevicePeakRate: null, preVatEvDeviceOffPeakRate: null, standingCharge: null,
    }),
  };

  const rates = await device.intelligentGoBaseRates();
  assert.equal(rates, null, 'no rows and no fabricated schedule → fail closed');
  assert.equal(store.tariffCode, 'E-1R-INTELLI-REAL-26-01-01-C', 'code still adopted for the next cycle');
});
