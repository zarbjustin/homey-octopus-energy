'use strict';

// Golden / characterization tests for the reporting surface of OctopusMeterDevice
// (refreshMonthlyCost, refreshDayBreakdown). These pin the CURRENT observable
// behaviour — the exact capability values written for known inputs — so the
// upcoming extraction of a ReportingService (Sprint S60) is provably
// behaviour-preserving. They deliberately let the real cost/tz math run and stub
// only the external ports (client, capabilities, clock, settings) plus a fixed
// clock via mock timers so month-window/standing-day/projection maths are stable.

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

const FIXED_NOW = Date.parse('2026-07-15T12:00:00Z'); // BST; mid-month for stable maths
const TZ = 'Europe/London';

function rate(valueIncVat, validFrom = '2026-07-01T00:00:00Z', validTo = null) {
  return {
    value_inc_vat: valueIncVat,
    value_exc_vat: Number((valueIncVat / 1.05).toFixed(4)),
    valid_from: validFrom,
    valid_to: validTo,
    payment_method: null,
  };
}

/** A device whose real cost/tz helpers run; only ports are stubbed. */
function makeDevice({ records, dayRates, standing, caps }) {
  const calls = {};
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({
    fuel: 'electricity', isExport: false, mpxn: '1', serial: 's',
    productCode: 'AGILE-24', tariffCode: 'E-1R-AGILE-24-A', accountNumber: 'A-ONE',
  });
  device.homey = { clock: { getTimezone: () => TZ } };
  device.rates = [];
  device.lastMonthlyRefresh = 0;
  device.vatInc = () => true; // config input, not part of the maths under test
  device.hasCapability = (c) => caps.includes(c);
  device.setCapabilityValue = async (c, v) => { calls[c] = v; };
  device.error = () => {};
  device.client = {
    consumption: async () => records,
    standardUnitRates: async () => dayRates,
    registerUnitRates: async () => [],
    standingCharges: async () => standing,
  };
  return { device, calls };
}

test('refreshMonthlyCost writes the golden month-to-date cost + projection for known inputs', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });

  // Two 1 kWh records in July at a flat 20p/kWh, standing 50p/day, 15 days elapsed.
  const records = [
    { interval_start: '2026-07-10T10:00:00Z', interval_end: '2026-07-10T10:30:00Z', consumption: 1 },
    { interval_start: '2026-07-10T10:30:00Z', interval_end: '2026-07-10T11:00:00Z', consumption: 1 },
  ];
  const { device, calls } = makeDevice({
    records, dayRates: [rate(20)], standing: [rate(50)],
    caps: ['octopus_cost_month', 'octopus_cost_projected'],
  });
  // Isolate the monthly path from the day-breakdown path (characterised separately).
  device.refreshDayBreakdown = async () => {};

  await device.refreshMonthlyCost();

  // Energy: 2 kWh × 20p = 40p. Standing: 15 days × 50p = 750p. Total £7.90.
  assert.equal(calls.octopus_cost_month, 7.9, 'month-to-date cost is energy + standing to date');

  // Projection uses the device's own elapsed/days-in-month helpers.
  const now = new Date();
  const elapsed = device.elapsedLocalMonthDays(now);
  const daysInMonth = device.daysInLocalMonth(now);
  const expectedProjected = Number(((7.9 / elapsed) * daysInMonth).toFixed(2));
  assert.equal(calls.octopus_cost_projected, expectedProjected, 'projection = month cost scaled to full month');
});

test('refreshMonthlyCost is a no-op when there are no settled records (fails closed, no £0 write)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
  const { device, calls } = makeDevice({
    records: [], dayRates: [rate(20)], standing: [rate(50)],
    caps: ['octopus_cost_month', 'octopus_cost_projected'],
  });
  device.refreshDayBreakdown = async () => {};
  await device.refreshMonthlyCost();
  assert.equal(calls.octopus_cost_month, undefined, 'no records → no cost written (not a misleading £0)');
});

test('refreshMonthlyCost does not write when its generation is superseded (stale-write fence)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
  const records = [
    { interval_start: '2026-07-10T10:00:00Z', interval_end: '2026-07-10T10:30:00Z', consumption: 1 },
  ];
  const { device, calls } = makeDevice({
    records, dayRates: [rate(20)], standing: [rate(50)],
    caps: ['octopus_cost_month', 'octopus_cost_projected'],
  });
  device.refreshDayBreakdown = async () => {};
  device.refreshGeneration = 5; // a newer refresh superseded generation 1 during the fetch

  await device.refreshMonthlyCost(1);

  assert.equal(calls.octopus_cost_month, undefined, 'a superseded generation must not overwrite a newer summary');
  assert.equal(device.lastMonthlyRefresh, 0, 'the throttle is not advanced, so the current generation re-runs');
});

test('refreshMonthlyCost writes when its generation is still current', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
  const records = [
    { interval_start: '2026-07-10T10:00:00Z', interval_end: '2026-07-10T10:30:00Z', consumption: 1 },
    { interval_start: '2026-07-10T10:30:00Z', interval_end: '2026-07-10T11:00:00Z', consumption: 1 },
  ];
  const { device, calls } = makeDevice({
    records, dayRates: [rate(20)], standing: [rate(50)],
    caps: ['octopus_cost_month', 'octopus_cost_projected'],
  });
  device.refreshDayBreakdown = async () => {};
  device.refreshGeneration = 3;

  await device.refreshMonthlyCost(3); // matches → not superseded

  assert.equal(calls.octopus_cost_month, 7.9, 'a current generation writes normally');
});

test('refreshDayBreakdown writes golden yesterday / peak / off-peak costs', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });

  const dayRates = [rate(20)];
  const standing = [rate(50)];
  // Local (BST = UTC+1): 17:00 local = 16:00Z (peak 16–19), 10:00 local = 09:00Z (off-peak).
  const records = [
    // Yesterday (14 Jul) 17:00 local, 2 kWh → 40p energy + 50p standing = 90p.
    { interval_start: '2026-07-14T16:00:00Z', interval_end: '2026-07-14T16:30:00Z', consumption: 2 },
    // Today (15 Jul) off-peak 10:00 local, 1 kWh → 20p.
    { interval_start: '2026-07-15T09:00:00Z', interval_end: '2026-07-15T09:30:00Z', consumption: 1 },
    // Today peak 17:00 local, 1 kWh → 20p.
    { interval_start: '2026-07-15T16:00:00Z', interval_end: '2026-07-15T16:30:00Z', consumption: 1 },
  ];
  const { device, calls } = makeDevice({
    records, dayRates, standing,
    caps: ['octopus_cost_yesterday', 'octopus_cost_peak_today', 'octopus_cost_offpeak_today'],
  });

  await device.refreshDayBreakdown(records, dayRates, [], standing);

  assert.equal(calls.octopus_cost_yesterday, 0.9, 'yesterday = energy + standing');
  assert.equal(calls.octopus_cost_peak_today, 0.2, 'today 16–19 local priced as peak');
  assert.equal(calls.octopus_cost_offpeak_today, 0.2, 'today outside 16–19 priced as off-peak');
});
