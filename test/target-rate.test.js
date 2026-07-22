'use strict';

// Unit tests for the pure target-rate evaluator (lib/planning/targetRate.ts,
// Sprint S61 / BL-22). Pins the "cheapest N hours at/under a cap by a deadline"
// primitive: cap met/not-met as a first-class result, fail-closed on an
// incomplete horizon, activeNow for the condition, DST/negative-price safety.

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateTargetRate } = require('../.homeybuild/lib/planning/targetRate.js');

// Build contiguous half-hour rates starting at `startIso`, one per price.
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

test('picks the cheapest N half-hours under the cap and reports met + tokens', () => {
  // 6 slots from 01:00: 30, 10, 8, 6, 25, 28 p. Cheapest 3 under 20p = 10/8/6.
  const rates = series('2026-07-21T01:00:00Z', [30, 10, 8, 6, 25, 28]);
  const r = evaluateTargetRate(rates, {
    now: new Date('2026-07-21T01:00:00Z'),
    deadline: new Date('2026-07-21T04:00:00Z'),
    durationSlots: 3,
    maxPrice: 20,
  });
  assert.equal(r.available, true);
  assert.equal(r.met, true);
  assert.equal(r.reason, null);
  assert.equal(r.slots.length, 3);
  assert.deepEqual(r.slots.map((s) => s.price), [10, 8, 6], 'slots ascending by time');
  assert.equal(r.start, '2026-07-21T01:30:00.000Z');
  assert.equal(r.end, '2026-07-21T03:00:00.000Z');
  assert.equal(r.maxSlotPrice, 10);
  assert.equal(r.averagePrice, 8);
});

test('cap-not-met is a first-class result with the price you would have to accept', () => {
  const rates = series('2026-07-21T01:00:00Z', [30, 25, 28, 26]);
  const r = evaluateTargetRate(rates, {
    now: new Date('2026-07-21T01:00:00Z'),
    deadline: new Date('2026-07-21T03:00:00Z'),
    durationSlots: 3,
    maxPrice: 20,
  });
  assert.equal(r.available, true, 'there was enough data to evaluate');
  assert.equal(r.met, false, 'the 20p cap is not satisfiable for 3 slots');
  assert.equal(r.reason, 'cap-not-met');
  assert.equal(r.slots.length, 0);
  assert.equal(r.cheapestAvailablePrice, 28, 'the dearest of the cheapest 3 uncapped (25/26/28)');
});

test('fails closed when the published horizon cannot cover the window', () => {
  const rates = series('2026-07-21T01:00:00Z', [10, 9]); // only 2 slots published
  const r = evaluateTargetRate(rates, {
    now: new Date('2026-07-21T01:00:00Z'),
    deadline: new Date('2026-07-21T07:00:00Z'),
    durationSlots: 6,
  });
  assert.equal(r.available, false, 'not enough data → fail closed, never invent a slot');
  assert.equal(r.met, false);
  assert.equal(r.reason, 'insufficient-window');
  assert.equal(r.slots.length, 0);
});

test('no cap = cheapest N hours (met whenever the horizon covers it)', () => {
  const rates = series('2026-07-21T01:00:00Z', [30, 40, 20, 50]);
  const r = evaluateTargetRate(rates, {
    now: new Date('2026-07-21T01:00:00Z'),
    deadline: new Date('2026-07-21T03:00:00Z'),
    durationSlots: 2,
  });
  assert.equal(r.met, true);
  assert.deepEqual(r.slots.map((s) => s.price), [30, 20], 'cheapest two, ascending by time');
});

test('activeNow is true only when now is inside a chosen slot (backs the condition)', () => {
  const rates = series('2026-07-21T01:00:00Z', [30, 6, 8, 25]);
  const base = {
    deadline: new Date('2026-07-21T03:00:00Z'), durationSlots: 2, maxPrice: 20,
  };
  // Chosen slots: 01:30 (6p) and 02:00 (8p).
  const inside = evaluateTargetRate(rates, { ...base, now: new Date('2026-07-21T01:40:00Z') });
  assert.equal(inside.activeNow, true, 'now within the 01:30 slot');
  const outside = evaluateTargetRate(rates, { ...base, now: new Date('2026-07-21T01:00:00Z') });
  assert.equal(outside.activeNow, false, 'now within the 30p slot, not a chosen one');
});

test('negative prices are eligible under a positive cap', () => {
  const rates = series('2026-07-21T01:00:00Z', [-2, 5, 30]);
  const r = evaluateTargetRate(rates, {
    now: new Date('2026-07-21T01:00:00Z'),
    deadline: new Date('2026-07-21T02:30:00Z'),
    durationSlots: 2,
    maxPrice: 10,
  });
  assert.equal(r.met, true);
  assert.deepEqual(r.slots.map((s) => s.price), [-2, 5]);
});

test('invalid window (deadline not after now, or zero duration) is unavailable', () => {
  const rates = series('2026-07-21T01:00:00Z', [10, 9, 8]);
  const a = evaluateTargetRate(rates, {
    now: new Date('2026-07-21T02:00:00Z'), deadline: new Date('2026-07-21T01:00:00Z'), durationSlots: 2,
  });
  assert.equal(a.available, false);
  assert.equal(a.reason, 'invalid-window');
  const b = evaluateTargetRate(rates, {
    now: new Date('2026-07-21T01:00:00Z'), deadline: new Date('2026-07-21T03:00:00Z'), durationSlots: 0,
  });
  assert.equal(b.reason, 'invalid-window');
});
