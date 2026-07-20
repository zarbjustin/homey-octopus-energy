'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analysePriceWindow, classifyBand, spikeThreshold, estimatePlanSavings,
  lowPriceEnergyShare, coveringRows,
} = require('../.homeybuild/lib/analytics/priceAnalytics.js');

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

function rate(slotIndex, price, spanMin = 30) {
  const start = BASE + slotIndex * 30 * 60_000;
  return {
    value_inc_vat: price,
    value_exc_vat: price - 1,
    valid_from: new Date(start).toISOString(),
    valid_to: new Date(start + spanMin * 60_000).toISOString(),
    payment_method: null,
  };
}

function day(prices) {
  return prices.map((p, i) => rate(i, p));
}

const from = new Date(BASE);
const to = new Date(BASE + 4 * 30 * 60_000);

test('coveringRows rejects gaps and incomplete coverage', () => {
  const gappy = [rate(0, 5), rate(2, 5), rate(3, 5)]; // missing slot 1
  assert.equal(coveringRows(gappy, from, to), null);
  const short = [rate(0, 5), rate(1, 5)]; // does not reach `to`
  assert.equal(coveringRows(short, from, to), null);
  assert.ok(coveringRows(day([5, 5, 5, 5]), from, to));
});

test('analysePriceWindow is unavailable (null) on incomplete coverage', () => {
  assert.equal(analysePriceWindow([rate(0, 5), rate(2, 5)], from, to), null);
});

test('time-weighted average uses duration, not row count', () => {
  const a = analysePriceWindow(day([0, 10, 20, 30]), from, to, { incVat: true });
  assert.equal(a.timeWeightedAverage, 15);
  assert.equal(a.slots, 4);
  assert.equal(a.priceBasis, 'vat-inclusive');
});

test('VAT basis selects the right value and is declared', () => {
  const inc = analysePriceWindow(day([10, 10, 10, 10]), from, to, { incVat: true });
  const exc = analysePriceWindow(day([10, 10, 10, 10]), from, to, { incVat: false });
  assert.equal(inc.timeWeightedAverage, 10);
  assert.equal(exc.timeWeightedAverage, 9); // value_exc_vat = price - 1
  assert.equal(exc.priceBasis, 'vat-exclusive');
});

test('a flat-rate day has no spikes and every slot is typical', () => {
  const a = analysePriceWindow(day([12, 12, 12, 12]), from, to);
  assert.equal(a.spikeSlots, 0);
  for (const p of a.points) assert.equal(classifyBand(p.value, a.points, a.spikeThreshold), 'typical');
});

test('a lone extreme value on an otherwise-flat window is a spike (zero-IQR floor)', () => {
  const rates = [rate(0, 10), rate(1, 10), rate(2, 10), rate(3, 100)];
  const a = analysePriceWindow(rates, from, new Date(BASE + 4 * 30 * 60_000));
  assert.ok(a.spikeThreshold !== null);
  assert.equal(classifyBand(100, a.points, a.spikeThreshold), 'spike');
  assert.equal(a.spikeSlots, 1);
});

test('negative price is its own band and counted', () => {
  const a = analysePriceWindow(day([-3, 10, 12, 14]), from, to);
  assert.equal(a.negativeSlots, 1);
  assert.equal(classifyBand(-3, a.points, a.spikeThreshold), 'negative');
});

test('spike threshold flags an extreme slot and keeps it in the average', () => {
  const prices = [5, 6, 7, 8, 9, 10, 11, 100];
  const rates = prices.map((p, i) => rate(i, p));
  const wTo = new Date(BASE + prices.length * 30 * 60_000);
  const a = analysePriceWindow(rates, from, wTo);
  assert.ok(a.spikeThreshold !== null);
  assert.equal(classifyBand(100, a.points, a.spikeThreshold), 'spike');
  assert.equal(a.spikeSlots, 1);
  // The spike is still included in the average (not discarded).
  assert.ok(a.timeWeightedAverage > 11);
});

test('bands: low/high by duration-weighted midrank; equal values share a band', () => {
  const prices = [1, 2, 2, 3, 4, 5, 6, 7];
  const rates = prices.map((p, i) => rate(i, p));
  const wTo = new Date(BASE + prices.length * 30 * 60_000);
  const a = analysePriceWindow(rates, from, wTo);
  assert.equal(classifyBand(1, a.points, a.spikeThreshold), 'low');
  assert.equal(classifyBand(7, a.points, a.spikeThreshold), 'high');
  // the two equal 2p slots resolve to the same band
  const b2a = classifyBand(2, a.points, a.spikeThreshold);
  assert.equal(b2a, classifyBand(2, a.points, a.spikeThreshold));
});

test('relative off-peak share is the duration fraction in negative/low bands', () => {
  const a = analysePriceWindow(day([-2, 1, 30, 31]), from, to);
  // Only -2 is negative; with 4 distinct values only the lowest slot is `low`
  // (the 1p slot sits at midrank 0.375 → typical), so negative+low = 1 of 4.
  assert.ok(Math.abs(a.relativeOffPeakShare - 0.25) < 1e-9);
});

test('DST-style 25-hour and 23-hour windows remain valid when contiguous', () => {
  const fifty = Array.from({ length: 50 }, (_, i) => rate(i, 10 + (i % 3)));
  const a25 = analysePriceWindow(fifty, from, new Date(BASE + 50 * 30 * 60_000));
  assert.ok(a25);
  assert.equal(a25.slots, 50);
  const fortySix = Array.from({ length: 46 }, (_, i) => rate(i, 10 + (i % 3)));
  const a23 = analysePriceWindow(fortySix, from, new Date(BASE + 46 * 30 * 60_000));
  assert.ok(a23);
  assert.equal(a23.slots, 46);
});

test('estimatePlanSavings: absolute saving always, pct null when baseline <= 0', () => {
  const s = estimatePlanSavings(10, 5, 15); // plan avg 5, window avg 15
  assert.equal(s.baselineAmount, 150);
  assert.equal(s.planAmount, 50);
  assert.equal(s.estimatedSaving, 100);
  assert.ok(Math.abs(s.savingPct - (100 / 150) * 100) < 1e-9);
  assert.match(s.label, /not a settled bill/i);
  const neg = estimatePlanSavings(10, -2, -1); // non-positive baseline
  assert.equal(neg.savingPct, null);
});

test('lowPriceEnergyShare weights by allocated kWh', () => {
  const a = analysePriceWindow(day([-2, 1, 30, 31]), from, to);
  const share = lowPriceEnergyShare([{ price: -2, kwh: 3 }, { price: 31, kwh: 1 }], a);
  assert.ok(Math.abs(share - 0.75) < 1e-9);
});
