'use strict';

// Unit tests for the pure rate-window planning helpers extracted from
// OctopusMeterDevice (Phase 2 / S52 slice 5): rate horizon, upcoming extremes
// (tonight tokens) and the cheapest-percentile condition. Previously untested
// in isolation inside the god-object.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeRatesHorizon, computeUpcomingExtremes, isWithinCheapestPercentile,
} = require('../.homeybuild/lib/planning/window.js');

function rate(fromIso, toIso, inc, exc = inc) {
  return {
    value_inc_vat: inc,
    value_exc_vat: exc,
    valid_from: fromIso,
    valid_to: toIso,
    payment_method: null,
  };
}

test('computeRatesHorizon returns the furthest valid_to', () => {
  const rates = [
    rate('2026-07-21T00:00:00Z', '2026-07-21T00:30:00Z', 10),
    rate('2026-07-21T00:30:00Z', '2026-07-21T01:00:00Z', 12),
  ];
  assert.equal(computeRatesHorizon(rates), Date.parse('2026-07-21T01:00:00Z'));
});

test('computeRatesHorizon treats an open-ended row as a 30-minute slot', () => {
  const rates = [rate('2026-07-21T00:00:00Z', null, 10)];
  assert.equal(computeRatesHorizon(rates), Date.parse('2026-07-21T00:00:00Z') + 1800_000);
});

test('computeRatesHorizon is 0 for no rates', () => {
  assert.equal(computeRatesHorizon([]), 0);
});

test('computeUpcomingExtremes picks the cheapest and most expensive rows still ahead', () => {
  const now = Date.parse('2026-07-21T00:15:00Z');
  const rates = [
    rate('2026-07-20T23:30:00Z', '2026-07-21T00:00:00Z', 5), // already ended -> excluded
    rate('2026-07-21T00:00:00Z', '2026-07-21T00:30:00Z', 20),
    rate('2026-07-21T00:30:00Z', '2026-07-21T01:00:00Z', 8),
    rate('2026-07-21T01:00:00Z', '2026-07-21T01:30:00Z', 31),
  ];
  const ext = computeUpcomingExtremes(rates, now, true);
  assert.equal(ext.cheapest, 8);
  assert.equal(ext.cheapestStartIso, '2026-07-21T00:30:00Z');
  assert.equal(ext.expensive, 31);
});

test('computeUpcomingExtremes keeps an open-ended row and honours VAT selection', () => {
  const now = Date.parse('2026-07-21T00:00:00Z');
  const rates = [rate('2026-07-21T00:00:00Z', null, 24, 20)];
  assert.equal(computeUpcomingExtremes(rates, now, true).cheapest, 24); // inc VAT
  assert.equal(computeUpcomingExtremes(rates, now, false).cheapest, 20); // exc VAT
});

test('computeUpcomingExtremes returns null when nothing lies ahead', () => {
  const now = Date.parse('2026-07-21T02:00:00Z');
  const rates = [rate('2026-07-21T00:00:00Z', '2026-07-21T00:30:00Z', 10)];
  assert.equal(computeUpcomingExtremes(rates, now, true), null);
});

test('isWithinCheapestPercentile ranks the current price against the window', () => {
  // Four slots: 5, 10, 15, 20. Current = 5 is the cheapest (25th percentile).
  const window = [
    rate('a', 'b', 5), rate('b', 'c', 10), rate('c', 'd', 15), rate('d', 'e', 20),
  ];
  assert.equal(isWithinCheapestPercentile(window, rate('a', 'b', 5), true, 25), true);
  assert.equal(isWithinCheapestPercentile(window, rate('a', 'b', 5), true, 24), false);
  // Current = 20 is the most expensive: rank 4/4 = 100%.
  assert.equal(isWithinCheapestPercentile(window, rate('d', 'e', 20), true, 100), true);
  assert.equal(isWithinCheapestPercentile(window, rate('d', 'e', 20), true, 99), false);
});

test('isWithinCheapestPercentile clamps percent and rejects an empty window', () => {
  const window = [rate('a', 'b', 5), rate('b', 'c', 10)];
  assert.equal(isWithinCheapestPercentile(window, rate('a', 'b', 5), true, 999), true);
  assert.equal(isWithinCheapestPercentile(window, rate('a', 'b', 5), true, -5), false);
  assert.equal(isWithinCheapestPercentile([], rate('a', 'b', 5), true, 100), false);
});
