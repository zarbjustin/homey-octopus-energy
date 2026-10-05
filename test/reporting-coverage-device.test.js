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

const NOW = Date.parse('2026-07-15T12:00:00Z');
const record = { interval_start: '2026-07-15T10:00:00Z', interval_end: '2026-07-15T10:30:00Z', consumption: 1 };
const rate = (p, from = '2026-01-01T00:00:00Z', to = null) => ({
  value_inc_vat: p, value_exc_vat: p, valid_from: from, valid_to: to, payment_method: null,
});

function deviceFixture() {
  const device = Object.create(OctopusMeterDevice.prototype);
  const values = {
    octopus_cost_today: 9, octopus_cost_today_so_far: 8, octopus_cost_month: 7, octopus_cost_projected: 6,
  };
  const persisted = {};
  const settings = new Map();
  const fired = [];
  device.homey = {
    clock: { getTimezone: () => 'UTC' },
    settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
  };
  device.store = () => ({
    fuel: 'electricity',
    isExport: false,
    mpxn: 'synthetic',
    serial: 'synthetic',
    apiKey: '',
    accountNumber: '',
    productCode: 'SYNTHETIC',
    tariffCode: 'E-1R-SYNTHETIC-A',
  });
  device.getData = () => ({ id: 'synthetic-device' });
  device.getSetting = () => undefined;
  device.hasCapability = (c) => c !== 'octopus_standing_charge' && c !== 'alarm_generic';
  device.getCapabilityValue = (c) => values[c];
  device.setCapabilityValue = async (c, v) => {
    values[c] = v;
  };
  device.getStoreValue = (k) => persisted[k];
  device.setStoreValue = async (k, v) => {
    persisted[k] = v;
  };
  device.fireAppTrigger = (id) => fired.push(id);
  device.error = () => {};
  device.log = () => {};
  device.rates = [rate(20)];
  device.nightRates = [];
  device.standingRates = [rate(50)];
  device.vatInc = () => true;
  device.isNightTime = () => false;
  device.refreshGeneration = 1;
  device.lastMonthlyRefresh = 0;
  device.lastBillingRefresh = 0;
  device.previousCostToday = 9;
  device.previousMonthCost = 7;
  device.previousProjectedCost = 6;
  device.diagnosticUpdates = {
    meter_data: { lastAttempt: new Date(NOW - 1000).toISOString(), lastSuccess: new Date(NOW - 1000).toISOString() },
  };
  device.client = {
    consumption: async () => [record],
    standardUnitRates: async () => device.rates,
    registerUnitRates: async (kind) => (kind === 'night' ? device.nightRates : device.rates),
    standingCharges: async () => device.standingRates,
    discoverMeters: async () => [],
  };
  return {
    device, values, persisted, settings, fired,
  };
}

test('unpriced rolling/today costs retain last-known values while usage and cumulative readings progress', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const {
    device, values, persisted, fired,
  } = deviceFixture();
  device.rates = [];
  let failure;
  try {
    await device.refreshConsumption(1);
  } catch (err) {
    failure = err;
  }
  assert.match(failure?.message, /coverage/);
  device.recordIntegrationDiagnostic('meter_data', failure);
  assert.equal(values.octopus_usage_today, 1);
  assert.equal(values.octopus_usage_today_so_far, 1);
  assert.equal(values.meter_power, 1);
  assert.equal(persisted.lastConsumptionEnd, record.interval_end);
  assert.equal(values.octopus_cost_today, 9);
  assert.equal(values.octopus_cost_today_so_far, 8);
  assert.equal(device.previousCostToday, 9);
  assert.ok(!fired.includes('cost_today_above'));
  assert.equal(device.getDataFreshness().sources.meter_data.state, 'stale', 'known coverage failure demotes recent last-known costs immediately');
  assert.equal(device.getDataFreshness().sources.meter_data.updatedAt, new Date(NOW - 1000).toISOString());
  device.flushIntegrationDiagnostics();
  device.recordIntegrationDiagnostic('meter_data', new Error('Synthetic transport failure'));
  assert.equal(device.getDataFreshness().sources.meter_data.state, 'stale', 'a later transport failure cannot clear a persisted coverage gap');
  device.flushIntegrationDiagnostics();
  device.rates = [rate(20)];
  await device.refreshConsumption(1);
  device.recordIntegrationDiagnostic('meter_data');
  assert.equal(device.getDataFreshness().sources.meter_data.state, 'current');
  assert.equal(values.meter_power, 1, 'recovery never double-counts consumption');
  assert.equal(values.octopus_cost_today, 0.7);
});

test('monthly gaps preserve costs, trigger baselines, refresh timestamps and source freshness', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const missing of ['rates', 'standingRates']) {
    const { device, values, fired } = deviceFixture();
    device[missing] = [];
    await device.runReporting('Monthly-cost refresh', 'monthly_cost', () => device.refreshMonthlyCost(1));
    assert.equal(values.octopus_cost_month, 7);
    assert.equal(values.octopus_cost_projected, 6);
    assert.equal(device.previousMonthCost, 7);
    assert.equal(device.previousProjectedCost, 6);
    assert.equal(device.lastMonthlyRefresh, 0);
    assert.deepEqual(fired, []);
    assert.equal(device.getDataFreshness().sources.monthly_cost.state, 'unknown');
    assert.equal(device.diagnosticUpdates.monthly_cost.coverageUnavailable, true);
  }
});

test('billing gaps and export lookup failures do not overwrite the last summary or advance its throttle', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const failure of ['standing', 'night', 'export']) {
    const { device, settings } = deviceFixture();
    const old = { synthetic: { importCost: 9, updatedAt: '2026-07-14T12:00:00Z' } };
    settings.set('billing_summary_v1', old);
    if (failure === 'standing') device.standingRates = [];
    if (failure === 'night') {
      device.isTwoRegisterTariff = () => true;
      device.isNightTime = () => true;
    }
    if (failure === 'export') {
      device.client.discoverMeters = async () => {
        throw new Error('Synthetic lookup failure');
      };
    }
    await assert.rejects(device.refreshBillingSummary(1), /coverage|lookup failure/);
    assert.equal(settings.get('billing_summary_v1'), old);
    assert.equal(device.lastBillingRefresh, 0);
  }
});

test('current standing charge cannot borrow a future or expired row', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const rows of [[], [rate(50, '2026-07-16T00:00:00Z')], [rate(50, '2026-01-01T00:00:00Z', '2026-07-14T00:00:00Z')]]) {
    const { device, values } = deviceFixture();
    device.hasCapability = () => true;
    device.standingRates = rows;
    device.lastStandingRefresh = 0;
    values.octopus_standing_charge = 60;
    await assert.rejects(device.refreshStandingCharge(), /coverage/);
    assert.equal(values.octopus_standing_charge, 60);
    assert.equal(device.lastStandingRefresh, 0);
  }
});

test('tariff comparisons reject an unknown current baseline and use each candidate register identity', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { device } = deviceFixture();
  device.client.findProductCode = async () => 'CANDIDATE';
  device.client.tariffCodeForProduct = async () => 'E-1R-CANDIDATE-A';
  device.client.registerUnitRates = async (kind) => [rate(kind === 'night' ? 10 : 30)];
  device.client.standardUnitRates = async () => [rate(20)];
  device.store = () => ({
    fuel: 'electricity', mpxn: 'synthetic', serial: 'synthetic', productCode: 'CURRENT', tariffCode: 'E-2R-CURRENT-A',
  });
  device.isNightTime = () => true;
  const result = await device.compareTariffs(30);
  assert.equal(result.current_annual, 219, 'current two-register night is 10p + 50p standing');
  assert.equal(result.best_annual, 219, 'single-register candidates cost 20p, not the current night price');
  device.client.registerUnitRates = async () => [];
  assert.equal(await device.compareTariffs(30), null, 'priced alternatives do not make the unknown baseline £0');
});
