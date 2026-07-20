'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBillingPeriod } = require('../.homeybuild/lib/billing/period.js');
const { computeBillingSummary } = require('../.homeybuild/lib/billing/aggregate.js');

const TZ = 'Europe/London';

function rate(fromIso, toIso, p) {
  return { value_inc_vat: p, value_exc_vat: p, valid_from: fromIso, valid_to: toIso, payment_method: null };
}
function rec(startIso, kwh) {
  return { consumption: kwh, interval_start: startIso, interval_end: startIso };
}

// --- Period resolution -------------------------------------------------------

test('no billing day falls back to the calendar month with calendar provenance', () => {
  const period = resolveBillingPeriod(new Date('2026-01-20T10:00:00Z'), TZ);
  assert.equal(period.source, 'calendar');
  assert.equal(period.start, '2026-01-01T00:00:00.000Z');
  assert.equal(period.end, '2026-02-01T00:00:00.000Z');
});

test('a user billing day defines the period from the most recent occurrence', () => {
  const period = resolveBillingPeriod(new Date('2026-01-20T10:00:00Z'), TZ, 15);
  assert.equal(period.source, 'user');
  assert.equal(period.start, '2026-01-15T00:00:00.000Z');
  assert.equal(period.end, '2026-02-15T00:00:00.000Z');
});

test('before the billing day, the period is the previous occurrence', () => {
  const period = resolveBillingPeriod(new Date('2026-01-10T10:00:00Z'), TZ, 15);
  assert.equal(period.start, '2025-12-15T00:00:00.000Z');
  assert.equal(period.end, '2026-01-15T00:00:00.000Z');
});

test('billing day 31 clamps to the length of shorter months', () => {
  const period = resolveBillingPeriod(new Date('2026-03-01T10:00:00Z'), TZ, 31);
  // Most recent day-31 occurrence at least Feb -> clamped to 28 Feb 2026.
  assert.equal(period.start, '2026-02-28T00:00:00.000Z');
  // 31 Mar 2026 is in BST, so its local midnight is 23:00 UTC the prior day (DST-safe).
  assert.equal(period.end, '2026-03-30T23:00:00.000Z');
});

test('a British Summer Time period boundary is local midnight (DST-safe)', () => {
  // July is BST (UTC+1): local midnight is 23:00 UTC the previous day.
  const period = resolveBillingPeriod(new Date('2026-07-10T10:00:00Z'), TZ, 1);
  assert.equal(period.start, '2026-06-30T23:00:00.000Z');
  assert.equal(period.end, '2026-07-31T23:00:00.000Z');
});

// --- Aggregation -------------------------------------------------------------

const JAN = {
  period: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', source: 'user' },
  settledThrough: '2026-01-04T00:00:00.000Z',
  now: '2026-01-04T01:00:00.000Z',
  timeZone: TZ,
  incVat: true,
};

test('import-only summary sums energy plus one standing charge per local day', () => {
  const summary = computeBillingSummary({
    ...JAN,
    import: {
      records: [rec('2026-01-01T00:00:00Z', 10), rec('2026-01-02T00:00:00Z', 10), rec('2026-01-03T00:00:00Z', 10)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 20)],
      nightRates: [],
      standing: [rate('2025-01-01T00:00:00Z', null, 40)],
      isNight: () => false,
    },
  });
  assert.equal(summary.importKwh, 30);
  // 30 kWh * 20p = £6.00 energy + 3 days * 40p = £1.20 standing = £7.20.
  assert.equal(summary.importCost, 7.2);
  assert.equal(summary.standingCharge, 1.2);
  assert.equal(summary.exportValue, null);
  assert.equal(summary.exportKwh, null);
  assert.equal(summary.netPosition, 7.2);
});

test('Economy 7 uses the night rate for night intervals', () => {
  const summary = computeBillingSummary({
    ...JAN,
    import: {
      records: [rec('2026-01-01T02:00:00Z', 10), rec('2026-01-01T14:00:00Z', 10)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 30)],
      nightRates: [rate('2025-01-01T00:00:00Z', null, 10)],
      standing: [],
      isNight: (iso) => new Date(iso).getUTCHours() < 7,
    },
  });
  // 10 kWh @ 10p (night) + 10 kWh @ 30p (day) = £1 + £3 = £4.00.
  assert.equal(summary.importCost, 4);
});

test('export value is subtracted for net, and is null (not £0) without an export tariff', () => {
  const withExport = computeBillingSummary({
    ...JAN,
    import: {
      records: [rec('2026-01-01T00:00:00Z', 10)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 20)],
      nightRates: [],
      standing: [],
      isNight: () => false,
    },
    export: {
      records: [rec('2026-01-01T00:00:00Z', 5)],
      rates: [rate('2025-01-01T00:00:00Z', null, 15)],
    },
  });
  // import £2.00 - export 5kWh*15p=£0.75 = £1.25.
  assert.equal(withExport.exportValue, 0.75);
  assert.equal(withExport.netPosition, 1.25);

  const noExport = computeBillingSummary({
    ...JAN,
    import: {
      records: [rec('2026-01-01T00:00:00Z', 10)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 20)],
      nightRates: [],
      standing: [],
      isNight: () => false,
    },
  });
  assert.equal(noExport.exportValue, null);
  assert.equal(noExport.netPosition, 2);
});

// --- Projection + confidence -------------------------------------------------

test('projection is a run-rate estimate and low confidence early in the period', () => {
  const summary = computeBillingSummary({
    ...JAN,
    import: {
      records: [rec('2026-01-01T00:00:00Z', 10), rec('2026-01-02T00:00:00Z', 10), rec('2026-01-03T00:00:00Z', 10)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 20)],
      nightRates: [],
      standing: [],
      isNight: () => false,
    },
  });
  // net £6.00 over 3 settled days -> ~£2/day * 31 days ~ £62.
  assert.ok(summary.projectedNet > 60 && summary.projectedNet < 64);
  assert.equal(summary.actualConfidence, 'low'); // only ~3/31 of the period elapsed
  assert.equal(summary.projectionConfidence, 'low');
});

test('projection is withheld with fewer than two settled days', () => {
  const summary = computeBillingSummary({
    period: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', source: 'user' },
    settledThrough: '2026-01-01T12:00:00.000Z',
    now: '2026-01-01T13:00:00.000Z',
    timeZone: TZ,
    incVat: true,
    import: {
      records: [rec('2026-01-01T00:00:00Z', 5)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 20)],
      nightRates: [],
      standing: [],
      isNight: () => false,
    },
  });
  assert.equal(summary.projectedNet, null);
  assert.ok(summary.reasons.some((r) => /Not enough settled data/.test(r)));
});

test('the calendar fallback lowers confidence and explains why', () => {
  const summary = computeBillingSummary({
    period: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', source: 'calendar' },
    settledThrough: '2026-01-25T00:00:00.000Z',
    now: '2026-01-25T01:00:00.000Z',
    timeZone: TZ,
    incVat: true,
    import: {
      records: [rec('2026-01-01T00:00:00Z', 10)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 20)],
      nightRates: [],
      standing: [],
      isNight: () => false,
    },
  });
  assert.notEqual(summary.actualConfidence, 'high');
  assert.ok(summary.reasons.some((r) => /Billing day not set/.test(r)));
});

test('the summary is a pure recomputation — identical inputs give identical output (restart-safe)', () => {
  const input = {
    ...JAN,
    import: {
      records: [rec('2026-01-01T00:00:00Z', 10), rec('2026-01-02T00:00:00Z', 12)],
      dayRates: [rate('2025-01-01T00:00:00Z', null, 20)],
      nightRates: [],
      standing: [rate('2025-01-01T00:00:00Z', null, 40)],
      isNight: () => false,
    },
  };
  assert.deepEqual(computeBillingSummary(input), computeBillingSummary(input));
});
