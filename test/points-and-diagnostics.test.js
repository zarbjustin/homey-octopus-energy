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

test('IOG is classified as dynamic', () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ productCode: 'IOG-VAR-26-01-01' });

  assert.equal(device.isDynamicTariff(), true);
});

test('other time-of-use tariff families align refreshes to half-hour boundaries', () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  for (const productCode of ['COSY-24-09-25', 'AIRA-ZERO-25-01-13', 'SNUG-24-01-01']) {
    device.store = () => ({ productCode });
    assert.equal(device.isDynamicTariff(), true, productCode);
  }
  device.store = () => ({ productCode: 'SILVER-TRACKER-25-01-13' });
  assert.equal(device.isDynamicTariff(), false, 'daily Tracker is not an intraday tariff');
});

test('IOG price gaps recover from account day/night rates', async () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({
    accountNumber: 'A-ONE', fuel: 'electricity', isExport: false,
    productCode: 'IOG-VAR-26-01-01', tariffCode: 'E-1R-IOG-VAR-26-01-01-C',
  });
  device.homey = { clock: { getTimezone: () => 'Europe/London' } };
  device.kraken = {
    getActiveIogTariff: async () => ({
      tariffType: 'FourRateEvTariff',
      dayRate: 31.5, nightRate: 8, preVatDayRate: 30, preVatNightRate: 7.619,
      evDevicePeakRate: 45, evDeviceOffPeakRate: 6,
    }),
  };
  device.log = () => {};

  const rates = await device.intelligentGoBaseRates();
  const midnightRate = rates.find((rate) => rate.valid_from.endsWith('T00:00:00.000Z'));
  const middayRate = rates.find((rate) => rate.valid_from.endsWith('T12:00:00.000Z'));

  assert.ok(rates.length >= 5 * 46, 'five local days should be represented across DST');
  assert.equal(midnightRate.value_inc_vat, 8);
  assert.equal(midnightRate.value_exc_vat, 7.619);
  assert.equal(middayRate.value_inc_vat, 31.5);
  assert.equal(middayRate.value_exc_vat, 30);
});

test('IOG account-rate recovery fails closed for unsupported agreement shapes', async () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({
    accountNumber: 'A-ONE', fuel: 'electricity', isExport: false,
    productCode: 'IOG-SYNTHETIC-26-01-01',
    tariffCode: 'E-1R-IOG-SYNTHETIC-26-01-01-C',
  });
  device.homey = { clock: { getTimezone: () => 'Europe/London' } };
  device.kraken = { getActiveIogTariff: async () => null };
  device.log = () => {};

  assert.equal(await device.intelligentGoBaseRates(), null);
});

test('IOG account-rate recovery fails closed when GraphQL is unavailable', async () => {
  const logs = [];
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({
    accountNumber: 'A-ONE', fuel: 'electricity', isExport: false,
    productCode: 'IOG-SYNTHETIC-26-01-01',
    tariffCode: 'E-1R-IOG-SYNTHETIC-26-01-01-C',
  });
  device.homey = { clock: { getTimezone: () => 'Europe/London' } };
  device.kraken = {
    getActiveIogTariff: async () => { throw new Error('Unsupported GraphQL field'); },
  };
  device.log = (...args) => logs.push(args.join(' '));

  assert.equal(await device.intelligentGoBaseRates(), null);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /A-ONE|E-1R-/);
});

test('effective-rate view is opt-in: null when the estimate setting is off', async () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({
    apiKey: 'k', accountNumber: 'A-ONE', fuel: 'electricity', isExport: false,
    productCode: 'IOG-VAR-26-01-01', tariffCode: 'E-1R-IOG-VAR-26-01-01-C',
  });
  device.currentPrice = 24.5;
  device.rates = [];
  device.rateSource = 'rest';
  device.vatInc = () => true;
  device.kraken = { getActiveIogTariff: async () => ({ evDevicePeakRate: 30, evDeviceOffPeakRate: 7 }) };
  let enabled = false;
  device.homey = {
    settings: { get: () => enabled },
    clock: { getTimezone: () => 'Europe/London' },
    app: { getDispatchView: () => ({ activeNow: false, active: [], next: null, recentFinalised: [] }) },
  };

  assert.equal(await device.getEffectiveRateView(), null, 'off by default → null');

  enabled = true;
  const view = await device.getEffectiveRateView();
  assert.ok(view, 'enabled → a view');
  assert.equal(view.estimated, true);
  assert.equal(view.settlement, false);
  assert.equal(view.householdBase, 24.5);
  assert.equal(view.ev.offPeak, 7);
});

test('effective-rate view never derives a finalised price from the IOG GraphQL fallback', async () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({
    apiKey: 'k', accountNumber: 'A-ONE', fuel: 'electricity', isExport: false,
    productCode: 'IOG-VAR-26-01-01', tariffCode: 'E-1R-IOG-VAR-26-01-01-C',
  });
  device.currentPrice = 24.5;
  // A rate row that WOULD cover the previous half-hour, but sourced from the IOG
  // GraphQL fallback — must NOT be reported as a finalised (settled) price.
  device.rates = [{
    value_inc_vat: 8, value_exc_vat: 7.6,
    valid_from: new Date(Date.now() - 3 * 3600_000).toISOString(),
    valid_to: new Date(Date.now() + 3 * 3600_000).toISOString(),
    payment_method: null,
  }];
  device.rateSource = 'iog-fallback';
  device.vatInc = () => true;
  device.kraken = { getActiveIogTariff: async () => ({ evDevicePeakRate: 30, evDeviceOffPeakRate: 7 }) };
  device.homey = {
    settings: { get: () => true },
    clock: { getTimezone: () => 'Europe/London' },
    app: { getDispatchView: () => ({ activeNow: false, active: [], next: null, recentFinalised: [] }) },
  };

  const view = await device.getEffectiveRateView();
  assert.equal(view.finalisedPrevHalfHour, null, 'iog-fallback is intent, not settlement');
});

test('a budget skip is recorded as a soft skip, never as an error or fault', () => {
  const { BudgetError } = require('../.homeybuild/lib/KrakenBudget.js');
  const device = Object.create(OctopusMeterDevice.prototype);
  device.diagnosticUpdates = {};
  device.store = () => ({ apiKey: 'api-key-xyz', accountNumber: 'A-1001', mpxn: '9900001', serial: 'SN-77' });

  device.recordIntegrationDiagnostic('points', new BudgetError());
  const entry = device.diagnosticUpdates.points;
  assert.ok(entry.lastSkip, 'a budget skip is recorded as lastSkip');
  assert.equal(entry.lastError, undefined, 'a budget skip is never recorded as an error');

  // A real error still records lastError.
  device.recordIntegrationDiagnostic('points', new Error('boom'));
  assert.match(device.diagnosticUpdates.points.lastError, /boom/);
});
