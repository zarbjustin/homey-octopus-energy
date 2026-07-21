'use strict';

// Regression tests for the IOG historical-cost fix (community 156860): the
// month/peak/off-peak/billing cost paths fetch tariff rates from the public
// REST feed, which is EMPTY for Intelligent Octopus Go, so every record priced
// at £0 (Darren saw "Off-peak cost today = £0"). costRatesForWindow falls back
// to the authoritative live series (this.rates) for single-register import
// meters so history prices consistently with the live "cost today" tile.

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

function rate(fromIso, toIso, inc) {
  return { value_inc_vat: inc, value_exc_vat: inc, valid_from: fromIso, valid_to: toIso, payment_method: null };
}

function bareDevice() {
  return Object.create(OctopusMeterDevice.prototype);
}

test('costRatesForWindow: single-register meter with an EMPTY REST feed falls back to the live series', () => {
  const device = bareDevice();
  device.rates = [rate('2026-07-21T00:00:00Z', null, 28.86)];
  const resolved = device.costRatesForWindow([], false);
  assert.equal(resolved, device.rates);
});

test('costRatesForWindow: a non-empty REST feed is used unchanged', () => {
  const device = bareDevice();
  device.rates = [rate('2026-07-21T00:00:00Z', null, 28.86)];
  const rest = [rate('2026-07-21T00:00:00Z', '2026-07-21T00:30:00Z', 15)];
  assert.equal(device.costRatesForWindow(rest, false), rest);
});

test('costRatesForWindow: two-register (Economy 7) meters are NEVER substituted', () => {
  const device = bareDevice();
  device.rates = [rate('2026-07-21T00:00:00Z', null, 28.86)];
  const resolved = device.costRatesForWindow([], true);
  assert.deepEqual(resolved, []); // keeps the empty REST result, does not borrow this.rates
});

test('costRatesForWindow: empty REST and empty live series is no worse than before (empty)', () => {
  const device = bareDevice();
  device.rates = [];
  assert.deepEqual(device.costRatesForWindow([], false), []);
});

// End-to-end: the peak/off-peak breakdown prices from the rates it is given, so
// with the fallback series (this.rates) off-peak cost is non-zero, but with the
// empty REST feed it is £0 — reproducing and then fixing Darren's symptom.
function breakdownDevice(captured) {
  const device = bareDevice();
  device.isTwoRegisterTariff = () => false;
  device.toEnergyUnit = (v) => v;
  device.vatInc = () => true;
  device.includeStandingChargeInCost = () => false;
  device.hasCapability = (c) => c === 'octopus_cost_peak_today' || c === 'octopus_cost_offpeak_today';
  device.setCapabilityValue = (name, value) => { captured[name] = value; return Promise.resolve(); };
  device.error = () => {};
  device.homey = { clock: { getTimezone: () => 'UTC' } };
  device.localMidnight = () => new Date('2026-07-21T00:00:00Z');
  return device;
}

const todaysRecords = [
  { interval_start: '2026-07-21T02:00:00Z', interval_end: '2026-07-21T02:30:00Z', consumption: 1 }, // off-peak (02:00)
  { interval_start: '2026-07-21T17:00:00Z', interval_end: '2026-07-21T17:30:00Z', consumption: 1 }, // peak (16-19)
];

test('refreshDayBreakdown with an EMPTY rate feed prices off-peak at £0 (the reported bug)', async () => {
  const captured = {};
  const device = breakdownDevice(captured);
  await device.refreshDayBreakdown(todaysRecords, [], [], []);
  assert.equal(captured.octopus_cost_offpeak_today, 0);
  assert.equal(captured.octopus_cost_peak_today, 0);
});

test('refreshDayBreakdown with the fallback live series prices off-peak from the real rate', async () => {
  const captured = {};
  const device = breakdownDevice(captured);
  const live = [rate('2026-07-20T00:00:00Z', '2026-07-22T00:00:00Z', 28.86)];
  await device.refreshDayBreakdown(todaysRecords, live, [], []);
  assert.equal(captured.octopus_cost_offpeak_today, 0.29); // 1 kWh @ 28.86p
  assert.equal(captured.octopus_cost_peak_today, 0.29);
});
