'use strict';

// Unit tests for the pure IOG pricing helpers extracted from OctopusMeterDevice
// (Phase 2 / S52 slice 3). These pin the trickiest pricing logic — the area
// behind the community 156860 IOG incidents — in isolation.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  iogUnitRatesToRates, synthesiseIogDayNightRates,
} = require('../.homeybuild/lib/pricing/iogSchedule.js');
const { isRecoverablePriceGapError } = require('../.homeybuild/lib/pricing/priceGap.js');
const { rateAt } = require('../.homeybuild/lib/rates.js');

test('iogUnitRatesToRates maps HalfHourly agreement rows to the Rate shape', () => {
  const rows = iogUnitRatesToRates([
    { validFrom: '2026-07-21T00:00:00Z', validTo: '2026-07-21T05:30:00Z', valueIncVat: 7, valuePreVat: 6.67 },
    { validFrom: '2026-07-21T05:30:00Z', validTo: null, valueIncVat: 28.96, valuePreVat: 27.58 },
  ]);
  assert.deepEqual(rows[0], {
    value_inc_vat: 7,
    value_exc_vat: 6.67,
    valid_from: '2026-07-21T00:00:00Z',
    valid_to: '2026-07-21T05:30:00Z',
    payment_method: null,
  });
  assert.equal(rows[1].valid_to, null); // open-ended row preserved
});

test('iogUnitRatesToRates preserves rows whose validity spans across today (the blank-price case)', () => {
  // A long-span row starting before "now" still resolves via rateAt.
  const rows = iogUnitRatesToRates([
    { validFrom: '2026-07-20T05:30:00Z', validTo: '2026-07-22T05:30:00Z', valueIncVat: 28.96, valuePreVat: 27.58 },
  ]);
  const current = rateAt(rows, new Date('2026-07-21T12:00:00Z'));
  assert.ok(current);
  assert.equal(current.value_inc_vat, 28.96);
});

test('synthesiseIogDayNightRates builds half-hour slots picking the band per slot start', () => {
  const tariff = { dayRate: 28.96, nightRate: 7, preVatDayRate: 27.58, preVatNightRate: 6.67 };
  const from = Date.UTC(2026, 6, 21, 0, 0);
  const to = Date.UTC(2026, 6, 21, 3, 0); // 3 hours -> 6 slots
  // Night before 01:00Z, day after.
  const isNight = (d) => d.getUTCHours() < 1;
  const rates = synthesiseIogDayNightRates(tariff, from, to, isNight);

  assert.equal(rates.length, 6);
  assert.equal(rates[0].value_inc_vat, 7); // 00:00 night
  assert.equal(rates[0].value_exc_vat, 6.67);
  assert.equal(rates[1].value_inc_vat, 7); // 00:30 night
  assert.equal(rates[2].value_inc_vat, 28.96); // 01:00 day
  assert.equal(rates[5].value_inc_vat, 28.96);
  // Contiguous half-hour spans.
  assert.equal(rates[0].valid_from, new Date(from).toISOString());
  assert.equal(rates[0].valid_to, new Date(from + 30 * 60_000).toISOString());
  assert.equal(rates[1].valid_from, rates[0].valid_to);
});

test('synthesiseIogDayNightRates covers the instant with rateAt (day and night)', () => {
  const tariff = { dayRate: 28.96, nightRate: 7, preVatDayRate: 27.58, preVatNightRate: 6.67 };
  const from = Date.UTC(2026, 6, 21, 0, 0);
  const to = Date.UTC(2026, 6, 22, 0, 0);
  const isNight = (d) => { const h = d.getUTCHours() + d.getUTCMinutes() / 60; return h < 5.5 || h >= 23.5; };
  const rates = synthesiseIogDayNightRates(tariff, from, to, isNight);

  assert.equal(rateAt(rates, new Date('2026-07-21T02:00:00Z')).value_inc_vat, 7); // overnight
  assert.equal(rateAt(rates, new Date('2026-07-21T12:00:00Z')).value_inc_vat, 28.96); // midday
});

test('isRecoverablePriceGapError matches the "no rate covering now" shapes and rejects hard errors', () => {
  assert.equal(isRecoverablePriceGapError(new Error('Octopus returned no rate covering the current time.')), true);
  assert.equal(isRecoverablePriceGapError(new Error('no current day/night register rate')), true);
  assert.equal(isRecoverablePriceGapError(new Error('Request failed with status 404')), true);
  assert.equal(isRecoverablePriceGapError(new Error('Not Found')), true);
  assert.equal(isRecoverablePriceGapError('no rate'), true); // non-Error input

  assert.equal(isRecoverablePriceGapError(new Error('401 Unauthorized - invalid api key')), false);
  assert.equal(isRecoverablePriceGapError(new Error('fetch failed')), false);
  assert.equal(isRecoverablePriceGapError(null), false);
  assert.equal(isRecoverablePriceGapError(undefined), false);
});
