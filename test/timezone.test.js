'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  tzOffsetMs, zonedTime, localDateParts, daysInMonth,
  localMidnight, localMonthStart, daysInLocalMonth, elapsedLocalMonthDays,
} = require('../.homeybuild/lib/timezone.js');

const LONDON = 'Europe/London';

// Characterization/contract tests locking the DST-safe wall-clock behaviour that
// was extracted verbatim from OctopusMeterDevice (S52 decomposition, BL-06).

test('tzOffsetMs reflects GMT (0) in winter and BST (+1h) in summer', () => {
  assert.equal(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), LONDON), 0);
  assert.equal(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), LONDON), 3600_000);
});

test('zonedTime maps a local wall-clock time to the correct UTC instant across DST', () => {
  // Winter (GMT): local midnight == 00:00Z.
  assert.equal(zonedTime(2026, 1, 15, LONDON).toISOString(), '2026-01-15T00:00:00.000Z');
  // Summer (BST): local midnight == 23:00Z the previous day.
  assert.equal(zonedTime(2026, 7, 15, LONDON).toISOString(), '2026-07-14T23:00:00.000Z');
});

test('localMidnight steps whole local days and stays anchored to local midnight (DST-safe)', () => {
  const now = new Date('2026-07-15T09:30:00Z'); // BST
  assert.equal(localMidnight(LONDON, 0, now).toISOString(), '2026-07-14T23:00:00.000Z');
  assert.equal(localMidnight(LONDON, 1, now).toISOString(), '2026-07-15T23:00:00.000Z');
  // Across the autumn DST change (26 Oct 2025, BST->GMT), local midnights stay
  // anchored to local 00:00 on both sides of the transition (not naive +24h).
  const beforeChange = new Date('2025-10-25T12:00:00Z');
  const m0 = localMidnight(LONDON, 0, beforeChange); // 2025-10-25 local -> 2025-10-24T23:00Z (BST)
  const m2 = localMidnight(LONDON, 2, beforeChange); // 2025-10-27 local -> 2025-10-27T00:00Z (GMT)
  assert.equal(m0.toISOString(), '2025-10-24T23:00:00.000Z');
  assert.equal(m2.toISOString(), '2025-10-27T00:00:00.000Z');
});

test('localMonthStart returns the first of the current local month at local midnight', () => {
  assert.equal(localMonthStart(LONDON, new Date('2026-07-15T09:30:00Z')).toISOString(), '2026-06-30T23:00:00.000Z');
  assert.equal(localMonthStart(LONDON, new Date('2026-01-15T09:30:00Z')).toISOString(), '2026-01-01T00:00:00.000Z');
});

test('localDateParts and daysInMonth/daysInLocalMonth are correct', () => {
  assert.deepEqual(localDateParts(new Date('2026-07-15T09:30:00Z'), LONDON), {
    year: 2026, month: 7, day: 15, hour: 10, minute: 30, // BST = +1
  });
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInLocalMonth(new Date('2026-07-15T09:30:00Z'), LONDON), 31);
});

test('elapsedLocalMonthDays is a >=0.5 fractional day count for projections', () => {
  // 15th at 10:30 local => 14 whole days + 10.5/24 fraction.
  const v = elapsedLocalMonthDays(new Date('2026-07-15T09:30:00Z'), LONDON);
  assert.ok(Math.abs(v - (14 + (10 * 60 + 30) / 1440)) < 1e-9);
  // Floored at 0.5 at the very start of the month.
  assert.equal(elapsedLocalMonthDays(new Date('2026-07-01T00:00:00Z'), LONDON), 0.5);
});

test('billing/tz re-exports the canonical helpers (no behaviour drift)', () => {
  const billingTz = require('../.homeybuild/lib/billing/tz.js');
  assert.equal(billingTz.tzOffsetMs(new Date('2026-07-15T12:00:00Z'), LONDON), 3600_000);
  assert.equal(billingTz.zonedTime(2026, 7, 15, LONDON).toISOString(), '2026-07-14T23:00:00.000Z');
});
