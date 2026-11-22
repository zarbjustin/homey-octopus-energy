'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { goPeriod } = require('../.homeybuild/lib/pricing/goOffPeak');

const load = Module._load;
Module._load = function mock(request, parent, main) {
  if (request === 'homey') return { Device: class Device {} };
  return load.call(this, request, parent, main);
};
const ElectricityDevice = require('../.homeybuild/drivers/electricity/device');

Module._load = load;

const rows = (boundaries) => boundaries.slice(1).map((end, i) => ({
  valid_from: boundaries[i],
  valid_to: end,
  value_inc_vat: i === 1 ? 9.4 : 34.53,
}));
const go = rows([
  '2026-10-24T04:30:00Z', '2026-10-24T23:30:00Z',
  '2026-10-25T05:30:00Z', '2026-10-26T00:30:00Z',
]);
const at = (iso) => Date.parse(iso);

test('standard Go honours UK clock change and exact published boundaries', () => {
  const evaluate = (instant, product = 'GO-FIX-TEST', rates = go) => goPeriod(product, rates, at(instant));
  assert.equal(evaluate('2026-10-24T23:29:59Z').offPeak, false);
  const night = evaluate('2026-10-24T23:30:00Z');
  assert.equal(night.offPeak, true);
  assert.equal(night.end - night.start, 6 * 3600_000);
  assert.equal(evaluate('2026-10-25T05:30:00Z').offPeak, false);
  assert.equal(evaluate('2026-10-25T02:00:00Z', 'INTELLI-GO-TEST'), null);
  assert.equal(evaluate('2026-10-25T02:00:00Z', 'GO-FIX-TEST', [go[1]]), null);
  assert.equal(evaluate('2026-10-25T02:00:00Z', 'GO-FIX-TEST', [...go, go[1]]), null);
});

test('Go condition rejects stale data, and refresh observations seed and emit once per adjacent boundary', () => {
  const device = Object.create(ElectricityDevice.prototype);
  let current = { start: 0, end: 1, offPeak: false };
  const events = [];
  device.currentGoPeriod = () => current;
  device.trigger = (id) => events.push(id);
  device.getDataFreshness = () => ({ sources: { prices: { state: 'stale' } } });
  assert.throws(() => device.isGoOffPeakActive(), /unavailable/);
  device.getDataFreshness = () => ({ sources: { prices: { state: 'current' } } });
  assert.equal(device.isGoOffPeakActive(), false);
  device.updateGoOffPeak();
  current = { start: 1, end: 2, offPeak: true };
  assert.equal(device.isGoOffPeakActive(), true);
  device.updateGoOffPeak();
  device.updateGoOffPeak();
  current = { start: 2, end: 3, offPeak: false };
  device.updateGoOffPeak();
  current = { start: 5, end: 6, offPeak: true };
  device.updateGoOffPeak();
  assert.deepEqual(events, ['go_off_peak_started', 'go_off_peak_ended']);
});
