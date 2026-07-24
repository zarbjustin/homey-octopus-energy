'use strict';

// BL-31 — calendar "today so far" tiles. Verifies the midnight->now window sums
// only today's settled records (never yesterday's), that the cost includes one
// standing charge like the rolling tile, and that a day with no settled records
// yet reads null ("not settled yet") rather than a misleading 0.

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

function rec(iso, consumption) {
  return { interval_start: iso, interval_end: iso, consumption };
}

function makeDevice() {
  const caps = {};
  const device = Object.create(OctopusMeterDevice.prototype);
  device.error = () => {};
  device.hasCapability = () => true;
  device.setCapabilityValue = async (c, v) => {
    caps[c] = v;
  };
  device.toEnergyUnit = (x) => x;
  device.vatInc = () => true;
  device.includeStandingChargeInCost = () => true;
  device.rates = [];
  device.nightRates = [];
  device.standingRates = [{
    value_inc_vat: 50, value_exc_vat: 47, valid_from: '2000-01-01T00:00:00Z', valid_to: null,
  }];
  device.rateForRecord = () => ({
    value_inc_vat: 20, value_exc_vat: 19, valid_from: '2000-01-01T00:00:00Z', valid_to: null,
  });
  // Local midnight = 23:00Z the previous day (e.g. BST).
  device.localMidnight = () => new Date('2026-07-21T23:00:00Z');
  return { device, caps };
}

test('today-so-far sums only records after local midnight and adds one standing charge', async () => {
  const { device, caps } = makeDevice();
  const now = new Date('2026-07-22T01:00:00Z');
  const sorted = [
    rec('2026-07-21T20:00:00Z', 5), // before local midnight -> excluded
    rec('2026-07-21T23:30:00Z', 2), // today
    rec('2026-07-22T00:00:00Z', 3), // today
    rec('2026-07-22T02:00:00Z', 9), // in the future relative to now -> excluded
  ];
  await device.refreshTodaySoFar(sorted, now);
  assert.equal(caps.octopus_usage_today_so_far, 5, 'usage = 2 + 3 (today only)');
  // cost = (2 + 3) kWh * 20p + 50p standing = 150p = £1.50
  assert.equal(caps.octopus_cost_today_so_far, 1.5);
});

test('today-so-far reads null (not 0) when no settled data exists for today yet', async () => {
  const { device, caps } = makeDevice();
  const now = new Date('2026-07-22T01:00:00Z');
  const sorted = [rec('2026-07-21T20:00:00Z', 5), rec('2026-07-21T22:00:00Z', 4)]; // all before midnight
  await device.refreshTodaySoFar(sorted, now);
  assert.equal(caps.octopus_usage_today_so_far, null, 'usage is unknown, not a false 0');
  assert.equal(caps.octopus_cost_today_so_far, null, 'cost is unknown, not a false 0');
});
