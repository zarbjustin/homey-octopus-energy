'use strict';

// Device-level tests for the BL-22 target-rate wiring (condition/trigger/action
// backends on OctopusMeterDevice). Verifies the rising-edge trigger fires once
// at a window's start, the condition tracks activeNow, and the action returns a
// branchable token contract (target_met even when the cap can't be met).

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

function series(startIso, pricesIncVat) {
  const start = Date.parse(startIso);
  return pricesIncVat.map((p, i) => ({
    value_inc_vat: p,
    value_exc_vat: Number((p / 1.05).toFixed(4)),
    valid_from: new Date(start + i * 30 * 60_000).toISOString(),
    valid_to: new Date(start + (i + 1) * 30 * 60_000).toISOString(),
    payment_method: null,
  }));
}

function makeDevice(rates) {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.vatInc = () => true;
  device.rates = rates;
  device.nextLocalTime = () => new Date('2026-07-21T05:00:00Z'); // fixed deadline
  return device;
}

// Chosen (cheapest 2 <= 20p) = 01:30 (6p) + 02:00 (8p), a contiguous block.
const RATES = series('2026-07-21T01:00:00Z', [30, 6, 8, 25]);

test('isInTargetRateWindow is true inside a chosen slot, false otherwise', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T01:40:00Z') });
  assert.equal(makeDevice(RATES).isInTargetRateWindow(1, '05:00', 20), true);
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T01:10:00Z') });
  assert.equal(makeDevice(RATES).isInTargetRateWindow(1, '05:00', 20), false, '01:00 slot (30p) is not chosen');
});

test('targetRateStartedNow fires once at the block start, not on subsequent slots', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T01:30:00Z') });
  assert.equal(makeDevice(RATES).targetRateStartedNow(1, '05:00', 20), true, 'rising edge at 01:30');
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T02:00:00Z') });
  assert.equal(makeDevice(RATES).targetRateStartedNow(1, '05:00', 20), false, 'still active but not a new edge');
});

test('getTargetRatePlan returns branchable tokens when the cap is met', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T01:00:00Z') });
  const plan = makeDevice(RATES).getTargetRatePlan(1, '05:00', 20);
  assert.equal(plan.target_met, true);
  assert.equal(plan.slots, 2);
  assert.equal(plan.start, '2026-07-21T01:30:00.000Z');
  assert.equal(plan.end, '2026-07-21T02:30:00.000Z');
  assert.equal(plan.average_price, 7);
  assert.equal(plan.max_slot_price, 8);
});

test('getTargetRatePlan returns target_met=false + cheapest_available when the cap is too tight', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T01:00:00Z') });
  const dear = series('2026-07-21T01:00:00Z', [30, 25, 28, 26]);
  const plan = makeDevice(dear).getTargetRatePlan(1.5, '05:00', 20); // 3 slots, cap 20
  assert.equal(plan.target_met, false, 'a Flow can branch on this instead of failing');
  assert.equal(plan.slots, 0);
  assert.equal(plan.cheapest_available, 28);
});

test('getTargetRatePlan returns null (action fails) when no rates are available', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T01:00:00Z') });
  assert.equal(makeDevice([]).getTargetRatePlan(1, '05:00', 0), null);
});
