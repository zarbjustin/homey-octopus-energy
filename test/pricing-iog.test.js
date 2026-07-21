'use strict';

// Unit tests for the pure IOG pricing helpers extracted from OctopusMeterDevice
// (Phase 2 / S52 slice 3). These pin the trickiest pricing logic — the area
// behind the community 156860 IOG incidents — in isolation.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  iogUnitRatesToRates, synthesiseIogDayNightRates,
  isFlatUnitRates, distinctIncVatValues, iogFlatDayRate,
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

// --- Flat-series detection + configured-night-rate synthesis (community 156860,
//     "Darren": his IOG HalfHourly feed publishes ONLY the 28.86p day rate, so
//     everything priced flat. These pin the helpers that let the day/night rate
//     be restored from the user-configured night rate without regressing genuine
//     multi-band half-hourly accounts). --------------------------------------

test('distinctIncVatValues counts distinct inc-VAT bands and ignores float dust', () => {
  assert.deepEqual(
    distinctIncVatValues([
      { validFrom: 'a', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 },
      { validFrom: 'b', validTo: null, valueIncVat: 28.8600001, valuePreVat: 27.49 },
    ]).sort(),
    [28.86],
  );
  assert.equal(
    distinctIncVatValues([
      { validFrom: 'a', validTo: null, valueIncVat: 6.9, valuePreVat: 6.57 },
      { validFrom: 'b', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 },
    ]).length,
    2,
  );
});

test('isFlatUnitRates: a single-value IOG series is flat; a genuine two-band series is not; empty is not flat', () => {
  assert.equal(isFlatUnitRates([
    { validFrom: 'a', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 },
    { validFrom: 'b', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 },
  ]), true);
  assert.equal(isFlatUnitRates([
    { validFrom: 'a', validTo: null, valueIncVat: 6.9, valuePreVat: 6.57 },
    { validFrom: 'b', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 },
  ]), false);
  assert.equal(isFlatUnitRates([]), false); // no base to synthesise from → not "flat"
});

test('iogFlatDayRate returns the single base pair for a flat series, else null', () => {
  assert.deepEqual(
    iogFlatDayRate([{ validFrom: 'a', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 }]),
    { inc: 28.86, exc: 27.49 },
  );
  assert.equal(
    iogFlatDayRate([
      { validFrom: 'a', validTo: null, valueIncVat: 6.9, valuePreVat: 6.57 },
      { validFrom: 'b', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 },
    ]),
    null,
  );
});

test('synthesising from a flat day base + configured night rate yields the real two-band schedule', () => {
  // The exact composition the device performs for Darren: day = flat base
  // (28.86p), night = configured 6.90p across the guaranteed 23:30–05:30 window.
  const base = iogFlatDayRate([{ validFrom: 'a', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 }]);
  const from = Date.UTC(2026, 6, 21, 0, 0);
  const to = Date.UTC(2026, 6, 22, 0, 0);
  const isNight = (d) => { const h = d.getUTCHours() + d.getUTCMinutes() / 60; return h < 5.5 || h >= 23.5; };
  const rates = synthesiseIogDayNightRates(
    { dayRate: base.inc, nightRate: 6.9, preVatDayRate: base.exc, preVatNightRate: 6.57 },
    from, to, isNight,
  );
  const overnight = rateAt(rates, new Date('2026-07-21T02:00:00Z'));
  const midday = rateAt(rates, new Date('2026-07-21T12:00:00Z'));
  assert.equal(overnight.value_inc_vat, 6.9, 'overnight prices at the configured night rate');
  assert.equal(midday.value_inc_vat, 28.86, 'daytime keeps the flat base day rate');
  // Lowest != Highest across the day — the regression that made every tile 28.86p.
  const values = rates.map((r) => r.value_inc_vat);
  assert.notEqual(Math.min(...values), Math.max(...values));
});

// --- Automatic day/night reconstruction from typed unitRates (the schema-verified
//     path: IOG publishes the 6.90p cheap band as a distinct OFF_PEAK row next to
//     the STANDARD day row; reading rateType lets us price it with no user config). --

const { iogHouseholdBands, iogRateTypeSummary } = require('../.homeybuild/lib/pricing/iogSchedule.js');

test('iogHouseholdBands reconstructs day/night from STANDARD + OFF_PEAK rows', () => {
  const asOf = Date.parse('2026-07-21T12:00:00Z');
  const bands = iogHouseholdBands([
    { validFrom: '2026-07-21T00:00:00Z', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49, rateType: 'STANDARD' },
    { validFrom: '2026-07-21T00:00:00Z', validTo: null, valueIncVat: 6.9, valuePreVat: 6.57, rateType: 'OFF_PEAK' },
  ], asOf);
  assert.deepEqual(bands, {
    dayRate: 28.86, nightRate: 6.9, preVatDayRate: 27.49, preVatNightRate: 6.57,
  });
});

test('iogHouseholdBands returns null when only the STANDARD day rate is published', () => {
  assert.equal(iogHouseholdBands([
    { validFrom: '2026-07-21T00:00:00Z', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49, rateType: 'STANDARD' },
  ], Date.parse('2026-07-21T12:00:00Z')), null);
});

test('iogHouseholdBands ignores EV_DEVICE bands (they price the EV register, not the home)', () => {
  // Only an EV off-peak band present → no household night band → null (fall back).
  assert.equal(iogHouseholdBands([
    { validFrom: '2026-07-21T00:00:00Z', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49, rateType: 'STANDARD' },
    { validFrom: '2026-07-21T00:00:00Z', validTo: null, valueIncVat: 6.9, valuePreVat: 6.57, rateType: 'EV_DEVICE_OFF_PEAK' },
  ], Date.parse('2026-07-21T12:00:00Z')), null);
});

test('iogHouseholdBands picks the value effective now across a scheduled price change (never a future row)', () => {
  const rows = [
    // Current bands (validTo = the change date), plus FUTURE bands from 1 Aug.
    { validFrom: '2026-07-01T00:00:00Z', validTo: '2026-08-01T00:00:00Z', valueIncVat: 28.86, valuePreVat: 27.49, rateType: 'STANDARD' },
    { validFrom: '2026-07-01T00:00:00Z', validTo: '2026-08-01T00:00:00Z', valueIncVat: 6.9, valuePreVat: 6.57, rateType: 'OFF_PEAK' },
    { validFrom: '2026-08-01T00:00:00Z', validTo: null, valueIncVat: 31.0, valuePreVat: 29.52, rateType: 'STANDARD' },
    { validFrom: '2026-08-01T00:00:00Z', validTo: null, valueIncVat: 7.5, valuePreVat: 7.14, rateType: 'OFF_PEAK' },
  ];
  const bands = iogHouseholdBands(rows, Date.parse('2026-07-21T12:00:00Z'));
  assert.equal(bands.dayRate, 28.86, 'the currently-effective day rate is used, not the future one');
  assert.equal(bands.nightRate, 6.9, 'the currently-effective night rate is used, not the future one');
  // On/after the change date the new bands take effect.
  const after = iogHouseholdBands(rows, Date.parse('2026-08-02T12:00:00Z'));
  assert.equal(after.dayRate, 31.0);
  assert.equal(after.nightRate, 7.5);
});

test('iogHouseholdBands returns null when the only matching rows are future-dated', () => {
  assert.equal(iogHouseholdBands([
    { validFrom: '2026-08-01T00:00:00Z', validTo: null, valueIncVat: 31.0, valuePreVat: 29.52, rateType: 'STANDARD' },
    { validFrom: '2026-08-01T00:00:00Z', validTo: null, valueIncVat: 7.5, valuePreVat: 7.14, rateType: 'OFF_PEAK' },
  ], Date.parse('2026-07-21T12:00:00Z')), null);
});

test('iogRateTypeSummary reports the distinct rateType→value pairs for diagnostics', () => {
  assert.equal(iogRateTypeSummary([
    { validFrom: 'a', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49, rateType: 'STANDARD' },
    { validFrom: 'b', validTo: null, valueIncVat: 6.9, valuePreVat: 6.57, rateType: 'OFF_PEAK' },
  ]), 'STANDARD=28.86,OFF_PEAK=6.9');
  assert.equal(iogRateTypeSummary([
    { validFrom: 'a', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49, rateType: 'STANDARD' },
  ]), 'STANDARD=28.86');
  assert.equal(iogRateTypeSummary([{ validFrom: 'a', validTo: null, valueIncVat: 28.86, valuePreVat: 27.49 }]), 'none');
});
