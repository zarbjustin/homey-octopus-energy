'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice, refreshHealthDecision } = require('../.homeybuild/lib/OctopusMeterDevice.js');
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

test('missing current price degrades an otherwise reachable device without taking it offline', () => {
  const result = refreshHealthDecision(
    true,
    false,
    true,
    0,
    new Error('Octopus returned no rate covering the current time.'),
  );
  assert.equal(result.alarm, true);
  assert.equal(result.markAvailable, true);
  assert.equal(result.markUnavailable, false);
  assert.match(result.message, /tariff price/i);
});

test('transient total failures require three consecutive refreshes before unavailability', () => {
  assert.equal(refreshHealthDecision(false, false, true, 1, new Error('fetch failed')).markUnavailable, false);
  assert.equal(refreshHealthDecision(false, false, true, 2, new Error('fetch failed')).markUnavailable, false);
  assert.equal(refreshHealthDecision(false, false, true, 3, new Error('fetch failed')).markUnavailable, true);
});

test('authentication failures make the device unavailable immediately', () => {
  const result = refreshHealthDecision(false, false, true, 1, new Error('Authentication failed - check your API key.'));
  assert.equal(result.authenticationFailure, true);
  assert.equal(result.markUnavailable, true);
  assert.match(result.message, /repair the device/i);
});

test('successful refresh clears both availability and connection alarms', () => {
  const result = refreshHealthDecision(true, true, true, 0, null);
  assert.equal(result.fullyHealthy, true);
  assert.equal(result.alarm, false);
  assert.equal(result.markAvailable, true);
});

test('a missing current rate rediscovers a changed tariff and retries prices once', async () => {
  const store = {
    accountNumber: 'A-ONE',
    mpxn: '123',
    serial: 'meter-1',
    fuel: 'electricity',
    isExport: false,
    productCode: 'OLD',
    tariffCode: 'E-1R-OLD-A',
  };
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => store;
  device.client = {
    discoverMeters: async () => [{
      ...store,
      productCode: 'NEW',
      tariffCode: 'E-1R-NEW-A',
    }],
  };
  device.setStoreValue = async (key, value) => { store[key] = value; };
  device.ensureRegisterCapabilities = async () => {};
  device.getData = () => ({ id: 'device-1' });
  device.fireAppTrigger = () => {};
  device.notifyEnabled = () => false;
  device.log = () => {};
  device.error = () => {};
  let attempts = 0;
  device.refreshPrices = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Octopus returned no rate covering the current time.');
    assert.equal(store.tariffCode, 'E-1R-NEW-A');
  };

  await device.refreshPricesWithTariffRecovery();
  assert.equal(attempts, 2);
});

test('price refresh recovers a long-lived current rate omitted by the date window', async () => {
  const now = Date.now();
  const future = slot(now + 3600_000, 25);
  const current = slot(now - 60_000, 20);
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ fuel: 'electricity', productCode: 'FIXED', tariffCode: 'E-1R-FIXED-A' });
  device.isTwoRegisterTariff = () => false;
  device.client = {
    standardUnitRates: async () => [future],
    latestStandardUnitRates: async () => [current],
  };
  device.onRatesUpdated = async () => {};
  device.vatInc = () => true;
  device.setCapabilityValue = async () => {};
  device.onPriceUpdated = async () => {};
  device.error = () => {};

  await device.refreshPrices();

  assert.equal(device.currentPrice, 20);
  assert.deepEqual(device.rates, [current]);
});

test('repair clears account-scoped caches before rebuilding clients', async () => {
  const store = {
    apiKey: 'old-key', accountNumber: 'A-OLD', mpxn: '123', serial: 'meter-1',
    fuel: 'electricity', isExport: false, productCode: 'OLD', tariffCode: 'E-1R-OLD-A',
  };
  const device = Object.create(OctopusMeterDevice.prototype);
  device.refreshPromise = null;
  device.rates = [slot(Date.now(), 20)];
  device.nightRates = [slot(Date.now(), 10)];
  device.standingRates = [slot(Date.now(), 40)];
  device.currentPrice = 20;
  device.currentBalance = 50;
  device.lastTariffCheck = Date.now();
  device.lastStandingRefresh = Date.now();
  device.lastMonthlyRefresh = Date.now();
  device.lastPointsRefresh = Date.now();
  device.setStoreValue = async (key, value) => { store[key] = value; };
  device.getStoreValue = (key) => store[key];
  device.homey = { app: {} };
  let builtWith;
  device.buildClients = () => { builtWith = store.apiKey; };
  let hookCalled = false;
  device.onCredentialsApplied = async () => { hookCalled = true; };
  device.ensureRegisterCapabilities = async () => {};
  device.refresh = async () => {};
  device.error = () => {};

  await device.applyCredentials({
    ...store,
    apiKey: 'new-key',
    accountNumber: 'A-NEW',
    productCode: 'NEW',
    tariffCode: 'E-1R-NEW-A',
  });

  assert.equal(builtWith, 'new-key');
  assert.equal(hookCalled, true);
  assert.deepEqual(device.rates, []);
  assert.deepEqual(device.nightRates, []);
  assert.deepEqual(device.standingRates, []);
  assert.equal(device.currentPrice, null);
  assert.equal(device.currentBalance, null);
  assert.equal(device.lastPointsRefresh, 0);
});

test('freshness reports stale data and connection alarms independently', () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.lastHealthyRefreshAt = Date.now() - 3 * 3600_000;
  device.getSetting = () => 30;
  device.hasCapability = () => true;
  device.getCapabilityValue = () => true;
  let freshness = device.getDataFreshness();
  assert.equal(freshness.stale, true);
  assert.equal(freshness.problem, true);

  device.lastHealthyRefreshAt = Date.now();
  device.getCapabilityValue = () => false;
  freshness = device.getDataFreshness();
  assert.equal(freshness.stale, false);
  assert.equal(freshness.problem, false);
  assert.ok(freshness.updatedAt);
});

test('integration diagnostics redact all stored account identifiers', () => {
  const settings = new Map();
  const device = Object.create(OctopusMeterDevice.prototype);
  device.diagnosticUpdates = {};
  device.store = () => ({
    apiKey: 'secret-key', accountNumber: 'A-SECRET', mpxn: '123456', serial: 'SERIAL',
  });
  device.getData = () => ({ id: 'device-1' });
  device.homey = {
    settings: {
      get: (key) => settings.get(key),
      set: (key, value) => settings.set(key, value),
    },
  };
  device.error = () => {};

  device.recordIntegrationDiagnostic(
    'prices',
    new Error('secret-key A-SECRET 123456 SERIAL failed'),
  );
  device.flushIntegrationDiagnostics();

  const saved = JSON.stringify(settings.get('integration_diagnostics_v1'));
  assert.doesNotMatch(saved, /secret-key|A-SECRET|123456|SERIAL/);
  assert.match(saved, /\[redacted\]/);
});

test('repair rolls back store values after a partial write failure', async () => {
  const original = {
    apiKey: 'old-key', accountNumber: 'A-OLD', mpxn: '123', serial: 'meter-1',
    fuel: 'electricity', isExport: false, productCode: 'OLD', tariffCode: 'E-1R-OLD-A',
  };
  const store = { ...original };
  const device = Object.create(OctopusMeterDevice.prototype);
  device.refreshPromise = null;
  device.store = () => ({ ...store });
  let failed = false;
  device.setStoreValue = async (key, value) => {
    if (!failed && key === 'mpxn' && value === '999') {
      failed = true;
      throw new Error('store write failed');
    }
    store[key] = value;
  };
  device.buildClients = () => {};
  device.error = () => {};

  await assert.rejects(() => device.applyCredentials({
    ...original,
    apiKey: 'new-key',
    accountNumber: 'A-NEW',
    mpxn: '999',
  }), /store write failed/);

  assert.deepEqual(store, original);
});
