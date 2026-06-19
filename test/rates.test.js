'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Tests run against the compiled output (npm test runs tsc first).
const r = require('../.homeybuild/lib/rates.js');

function rate(from, to, inc, exc = inc) {
  return {
    value_inc_vat: inc,
    value_exc_vat: exc,
    valid_from: from,
    valid_to: to,
    payment_method: null,
  };
}

const SAMPLE = [
  rate('2024-01-01T00:00:00Z', '2024-01-01T00:30:00Z', 20),
  rate('2024-01-01T00:30:00Z', '2024-01-01T01:00:00Z', 5),
  rate('2024-01-01T01:00:00Z', '2024-01-01T01:30:00Z', 30),
  rate('2024-01-01T01:30:00Z', '2024-01-01T02:00:00Z', -2),
];

test('productCodeFromTariff strips fuel prefix and region suffix', () => {
  assert.strictEqual(r.productCodeFromTariff('E-1R-AGILE-FLEX-22-11-25-C'), 'AGILE-FLEX-22-11-25');
  assert.strictEqual(r.productCodeFromTariff('G-1R-VAR-22-11-01-A'), 'VAR-22-11-01');
  assert.strictEqual(r.productCodeFromTariff('E-2R-GO-VAR-22-10-14-J'), 'GO-VAR-22-10-14');
});

test('regionFromTariff extracts the GSP letter', () => {
  assert.strictEqual(r.regionFromTariff('E-1R-AGILE-FLEX-22-11-25-C'), 'C');
  assert.strictEqual(r.regionFromTariff('G-1R-VAR-22-11-01-A'), 'A');
  assert.strictEqual(r.regionFromTariff('NO-REGION'), null);
});

test('rateAt finds the rate covering an instant', () => {
  const at = new Date('2024-01-01T00:45:00Z');
  assert.strictEqual(r.rateAt(SAMPLE, at).value_inc_vat, 5);
  // Boundary is inclusive of valid_from, exclusive of valid_to.
  assert.strictEqual(r.rateAt(SAMPLE, new Date('2024-01-01T01:00:00Z')).value_inc_vat, 30);
  assert.strictEqual(r.rateAt(SAMPLE, new Date('2023-12-31T23:00:00Z')), null);
});

test('cheapestRate returns the lowest price (including negative)', () => {
  assert.strictEqual(r.cheapestRate(SAMPLE).value_inc_vat, -2);
});

test('cheapestWindow finds the cheapest contiguous block', () => {
  const win = r.cheapestWindow(SAMPLE, 2);
  assert.strictEqual(win.length, 2);
  // 30 + (-2) = 28 vs 20+5=25 vs 5+30=35 -> cheapest pair is 20,5 (=25)
  assert.strictEqual(win[0].value_inc_vat, 20);
  assert.strictEqual(win[1].value_inc_vat, 5);
  assert.strictEqual(r.cheapestWindow(SAMPLE, 10), null);
});

test('isCheapestSlotNow compares the current slot to the forward window', () => {
  // At 00:30 the slot is 5p; the only cheaper future slot is -2p later -> not cheapest.
  assert.strictEqual(r.isCheapestSlotNow(SAMPLE, new Date('2024-01-01T00:45:00Z')), false);
  // At 01:30 the slot is -2p and it's the last/cheapest -> cheapest.
  assert.strictEqual(r.isCheapestSlotNow(SAMPLE, new Date('2024-01-01T01:45:00Z')), true);
});

test('priceLevel classifies plunge/cheap/normal/expensive', () => {
  const th = { cheap: 10, expensive: 30 };
  assert.strictEqual(r.priceLevel(-1, th), 'plunge');
  assert.strictEqual(r.priceLevel(8, th), 'cheap');
  assert.strictEqual(r.priceLevel(20, th), 'normal');
  assert.strictEqual(r.priceLevel(35, th), 'expensive');
});

test('consumptionBetween sums records within a day window', () => {
  const records = [
    { consumption: 0.5, interval_start: '2024-01-01T00:00:00Z', interval_end: '2024-01-01T00:30:00Z' },
    { consumption: 1.0, interval_start: '2024-01-01T00:30:00Z', interval_end: '2024-01-01T01:00:00Z' },
    { consumption: 2.0, interval_start: '2024-01-02T00:00:00Z', interval_end: '2024-01-02T00:30:00Z' },
  ];
  const total = r.consumptionBetween(
    records,
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-02T00:00:00Z'),
  );
  assert.strictEqual(total, 1.5);
});
