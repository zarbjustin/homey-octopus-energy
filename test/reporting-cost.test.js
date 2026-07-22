'use strict';

// Unit tests for the pure reporting cost helpers (lib/reporting/cost.ts),
// extracted from OctopusMeterDevice in Sprint S60 (BL-07 tail). These pin the
// money maths in isolation so BL-18's SettledInsightsService can reuse them.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rateForRecord, consumptionCostPence, windowCostPence, standingChargePence, peakOffPeakCostPence,
} = require('../.homeybuild/lib/reporting/cost.js');

function rate(inc, from = '2026-07-01T00:00:00Z', to = null) {
  return { value_inc_vat: inc, value_exc_vat: Number((inc / 1.05).toFixed(4)), valid_from: from, valid_to: to, payment_method: null };
}
const identity = (n) => n;
const never = () => false;
const always = () => true;

test('rateForRecord uses the day series for a single-register tariff', () => {
  const day = [rate(20)];
  const night = [rate(8)];
  const r = rateForRecord('2026-07-10T02:00:00Z', day, night, { twoRegister: false, isNight: always });
  assert.equal(r.value_inc_vat, 20, 'single-register never uses the night register');
});

test('rateForRecord uses the night series only when two-register AND night AND night rates exist', () => {
  const day = [rate(20)];
  const night = [rate(8)];
  const iso = '2026-07-10T02:00:00Z';
  assert.equal(rateForRecord(iso, day, night, { twoRegister: true, isNight: always }).value_inc_vat, 8);
  assert.equal(rateForRecord(iso, day, night, { twoRegister: true, isNight: never }).value_inc_vat, 20);
  assert.equal(rateForRecord(iso, day, [], { twoRegister: true, isNight: always }).value_inc_vat, 20, 'no night rows → day');
});

test('consumptionCostPence sums energy cost at the inc-VAT rate', () => {
  const records = [
    { interval_start: '2026-07-10T10:00:00Z', interval_end: '2026-07-10T10:30:00Z', consumption: 1 },
    { interval_start: '2026-07-10T10:30:00Z', interval_end: '2026-07-10T11:00:00Z', consumption: 2 },
  ];
  const pence = consumptionCostPence(records, [rate(20)], [], { incVat: true, twoRegister: false, isNight: never, toEnergy: identity });
  assert.equal(pence, 60, '3 kWh × 20p');
});

test('consumptionCostPence honours the VAT flag (exc-VAT)', () => {
  const records = [{ interval_start: '2026-07-10T10:00:00Z', interval_end: '2026-07-10T10:30:00Z', consumption: 1 }];
  const pence = consumptionCostPence(records, [rate(21)], [], { incVat: false, twoRegister: false, isNight: never, toEnergy: identity });
  assert.equal(pence, 20, '21p inc → 20p exc at 5% VAT');
});

test('windowCostPence includes only records whose start is in [start, end)', () => {
  const records = [
    { interval_start: '2026-07-09T23:30:00Z', interval_end: '2026-07-10T00:00:00Z', consumption: 5 }, // before
    { interval_start: '2026-07-10T00:00:00Z', interval_end: '2026-07-10T00:30:00Z', consumption: 1 }, // in
    { interval_start: '2026-07-11T00:00:00Z', interval_end: '2026-07-11T00:30:00Z', consumption: 9 }, // at end → excluded
  ];
  const start = Date.parse('2026-07-10T00:00:00Z');
  const end = Date.parse('2026-07-11T00:00:00Z');
  const pence = windowCostPence(records, start, end, [rate(20)], [], { incVat: true, twoRegister: false, isNight: never, toEnergy: identity });
  assert.equal(pence, 20, 'only the in-window 1 kWh record counts');
});

test('standingChargePence sums the rate active at each sample instant', () => {
  const standing = [rate(50)];
  const noons = [new Date('2026-07-01T12:00:00Z'), new Date('2026-07-02T12:00:00Z'), new Date('2026-07-03T12:00:00Z')];
  assert.equal(standingChargePence(standing, noons, true), 150, '3 days × 50p');
  assert.equal(standingChargePence(standing, [], true), 0, 'no days → 0');
});

test('peakOffPeakCostPence splits at/after the window start by the isPeak predicate', () => {
  const records = [
    { interval_start: '2026-07-15T05:00:00Z', interval_end: '2026-07-15T05:30:00Z', consumption: 4 }, // before start → ignored
    { interval_start: '2026-07-15T16:00:00Z', interval_end: '2026-07-15T16:30:00Z', consumption: 1 }, // peak
    { interval_start: '2026-07-15T09:00:00Z', interval_end: '2026-07-15T09:30:00Z', consumption: 1 }, // off
  ];
  const since = Date.parse('2026-07-15T06:00:00Z');
  const isPeak = (iso) => new Date(iso).getUTCHours() >= 16 && new Date(iso).getUTCHours() < 19;
  const { peak, off } = peakOffPeakCostPence(records, since, [rate(20)], [], { incVat: true, twoRegister: false, isNight: never, toEnergy: identity }, isPeak);
  assert.equal(peak, 20, 'the 16:00 record is peak');
  assert.equal(off, 20, 'the 09:00 record is off-peak; the pre-start record is excluded');
});
