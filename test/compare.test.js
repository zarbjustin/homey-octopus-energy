'use strict';

const test = require('node:test');
const assert = require('node:assert');

const cmp = require('../.homeybuild/lib/compare.js');

function rate(from, to, inc) {
  return {
    value_inc_vat: inc, value_exc_vat: inc, valid_from: from, valid_to: to, payment_method: null,
  };
}

const RATES = [
  rate('2024-01-01T00:00:00Z', '2024-01-01T00:30:00Z', 10),
  rate('2024-01-01T00:30:00Z', '2024-01-01T01:00:00Z', 20),
];

const RECORDS = [
  { consumption: 1, interval_start: '2024-01-01T00:00:00Z', interval_end: '2024-01-01T00:30:00Z' },
  { consumption: 2, interval_start: '2024-01-01T00:30:00Z', interval_end: '2024-01-01T01:00:00Z' },
];

test('consumptionCostPence multiplies kWh by the matching unit rate', () => {
  // 1 kWh * 10p + 2 kWh * 20p = 50p
  assert.strictEqual(cmp.consumptionCostPence(RECORDS, RATES), 50);
});

test('estimateAnnualCost annualises window cost incl. standing charge', () => {
  // daysSpanned = 1; window pence = 50 (consumption) + 30 (standing) = 80p/day
  // annual = 80 * 365 / 100 = £292
  const annual = cmp.estimateAnnualCost(RECORDS, RATES, 30);
  assert.strictEqual(annual, 292);
});

test('daysSpanned is at least 1', () => {
  assert.strictEqual(cmp.daysSpanned([]), 1);
  assert.strictEqual(cmp.daysSpanned(RECORDS), 1);
});
