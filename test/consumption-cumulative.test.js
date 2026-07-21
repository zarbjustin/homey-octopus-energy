'use strict';

// Unit tests for the single cumulative-meter writer extracted from
// OctopusMeterDevice (Phase 2 / S52 slice 4). These pin the monotonic-total
// arithmetic — the double-count / lost-delta risk (R-004 / BL-08) — in
// isolation, which was previously untested inside refreshConsumption.

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeCumulativeUpdate } = require('../.homeybuild/lib/consumption/cumulative.js');

const identity = (raw) => raw;

function rec(startIso, endIso, consumption) {
  return { interval_start: startIso, interval_end: endIso, consumption };
}

// Three contiguous half-hours.
const day = [
  rec('2026-07-21T00:00:00Z', '2026-07-21T00:30:00Z', 0.5),
  rec('2026-07-21T00:30:00Z', '2026-07-21T01:00:00Z', 0.7),
  rec('2026-07-21T01:00:00Z', '2026-07-21T01:30:00Z', 0.3),
];

test('first run (no cursor) sums every record and sets the cursor to the newest interval_end', () => {
  const update = computeCumulativeUpdate(day, null, 0, identity);
  assert.equal(update.cumulative, 1.5); // 0.5 + 0.7 + 0.3
  assert.equal(update.cursorIso, '2026-07-21T01:30:00Z');
});

test('prior cumulative is carried forward and added to', () => {
  const update = computeCumulativeUpdate(day, null, 10, identity);
  assert.equal(update.cumulative, 11.5);
});

test('an overlapping fetch window only adds records newer than the cursor (no double-count)', () => {
  // Cursor already at 00:30 -> only the 00:30-01:00 and 01:00-01:30 rows are new.
  const update = computeCumulativeUpdate(day, '2026-07-21T00:30:00Z', 100, identity);
  assert.equal(update.cumulative, 101); // 100 + 0.7 + 0.3
  assert.equal(update.cursorIso, '2026-07-21T01:30:00Z');
});

test('returns null when no record is newer than the cursor (nothing to add)', () => {
  const update = computeCumulativeUpdate(day, '2026-07-21T01:30:00Z', 50, identity);
  assert.equal(update, null);
});

test('returns null for an empty record set', () => {
  assert.equal(computeCumulativeUpdate([], null, 5, identity), null);
});

test('the cursor boundary is strict (interval_end must be AFTER the cursor)', () => {
  // Cursor exactly at 01:00 -> the 00:30-01:00 row (end == cursor) is NOT re-added.
  const update = computeCumulativeUpdate(day, '2026-07-21T01:00:00Z', 0, identity);
  assert.equal(update.cumulative, 0.3); // only the 01:00-01:30 row
});

test('the injected unit conversion scales the delta (e.g. gas m3 -> kWh)', () => {
  const toKwh = (m3) => m3 * 11.1;
  const update = computeCumulativeUpdate(
    [rec('2026-07-21T00:00:00Z', '2026-07-21T00:30:00Z', 1)], null, 0, toKwh,
  );
  assert.equal(update.cumulative, 11.1);
});

test('the running total is rounded to 3 dp to avoid float drift', () => {
  const update = computeCumulativeUpdate(
    [rec('2026-07-21T00:00:00Z', '2026-07-21T00:30:00Z', 0.1)], null, 0.2, identity,
  );
  assert.equal(update.cumulative, 0.3); // not 0.30000000000000004
});
