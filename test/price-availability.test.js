'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePriceAvailability, evaluatePriceBand } = require('../lib/planning/priceAvailability');
const { evaluateBoundedSlots } = require('../lib/planning/priceAvailability');

const from = Date.parse('2026-10-25T00:00:00Z');
const row = (offset, price) => ({
  valid_from: new Date(from + offset * 1800000).toISOString(),
  valid_to: new Date(from + (offset + 1) * 1800000).toISOString(),
  value_inc_vat: price,
});
const options = {
  from, to: from + 5400000, threshold: 0, fresh: true,
};

test('every qualifying slot is retained; below is strict and zero is literal', () => {
  const result = evaluatePriceAvailability([row(0, -2), row(1, 0), row(2, -1)], options);
  assert.equal(result.status, 'some');
  assert.deepEqual(result.slots.map((slot) => slot.price), [-2, -1]);
});

test('none requires fresh complete unambiguous coverage', () => {
  const rows = [row(0, 10), row(1, 20), row(2, 30)];
  assert.equal(evaluatePriceAvailability(rows, options).status, 'none');
  for (const invalid of [[], [rows[0], rows[2]], [...rows, rows[1]], [row(0, null), ...rows.slice(1)]]) {
    assert.equal(evaluatePriceAvailability(invalid, options).status, 'unknown');
  }
  assert.equal(evaluatePriceAvailability(rows, { ...options, fresh: false }).status, 'unknown');
});

test('partial endpoints count only remaining duration across UK autumn clock change', () => {
  const result = evaluatePriceAvailability([row(0, -1), row(1, -1), row(2, -1)], {
    ...options, from: from + 600000, to: from + 4800000,
  });
  assert.equal(result.status, 'some');
  assert.equal(result.slots.reduce((sum, slot) => sum + slot.end - slot.start, 0), 4200000);
});

test('Flow bands share widget boundaries but reject missing prices and invalid configuration', () => {
  const thresholds = { greenMax: 10, yellowMax: 20, orangeMax: 30 };
  assert.equal(evaluatePriceBand(20, thresholds), 'yellow');
  assert.equal(evaluatePriceBand(-1, thresholds), 'negative');
  assert.equal(evaluatePriceBand(null, thresholds), 'unknown');
  assert.equal(evaluatePriceBand(1, {}), 'unknown');
  assert.equal(evaluatePriceBand(1, { ...thresholds, greenMax: 25 }), 'unknown');
});

test('bounded duration prefers cheap slots and supplements only when opted in', () => {
  const rows = [row(0, 8), row(1, 15), row(2, 30)];
  const opts = {
    ...options, threshold: 10, duration: 0.75, fallback: true, maximum: 20,
  };
  const result = evaluateBoundedSlots(rows, opts);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.slots.map((slot) => slot.price), [8, 15]);
  assert.equal(result.slots[1].end - result.slots[1].start, 900000);
  assert.equal(evaluateBoundedSlots(rows, { ...opts, fallback: false }).status, 'insufficient');
  assert.equal(evaluateBoundedSlots(rows, { ...opts, duration: 2 }).status, 'insufficient');
  assert.equal(evaluateBoundedSlots(rows, { ...opts, maximum: 0 }).status, 'unknown');
});

test('bounded zero/negative caps, exact equality and ties retain literal deterministic policy', () => {
  const rows = [row(0, -2), row(1, 0), row(2, 0)];
  const opts = {
    ...options, threshold: -1, duration: 1, fallback: true, maximum: 0,
  };
  const result = evaluateBoundedSlots(rows, opts);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.slots.map((slot) => slot.start), [from, from + 1800000]);
  assert.deepEqual(result.slots.map((slot) => slot.fallback), [false, true]);
  assert.equal(evaluateBoundedSlots(rows, { ...opts, maximum: -1 }).status, 'insufficient');
  assert.equal(evaluateBoundedSlots(rows, { ...opts, threshold: NaN }).status, 'unknown');
});
