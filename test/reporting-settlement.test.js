'use strict';

// Unit tests for contiguousSettledThrough (lib/reporting/settlement.ts), the
// Sprint S60 fix for the settled-through boundary. The old code used
// max(interval_end), which jumps past a gap and overstates settlement.

const test = require('node:test');
const assert = require('node:assert/strict');

const { contiguousSettledThrough } = require('../.homeybuild/lib/reporting/settlement.js');

function rec(start, end, consumption = 1) {
  return { interval_start: start, interval_end: end, consumption };
}

test('contiguous records settle through the final interval_end', () => {
  const records = [
    rec('2026-07-01T00:00:00Z', '2026-07-01T00:30:00Z'),
    rec('2026-07-01T00:30:00Z', '2026-07-01T01:00:00Z'),
    rec('2026-07-01T01:00:00Z', '2026-07-01T01:30:00Z'),
  ];
  assert.equal(contiguousSettledThrough(records), '2026-07-01T01:30:00.000Z');
});

test('a gap stops the settled boundary BEFORE the later island (the bug fix)', () => {
  const records = [
    rec('2026-07-01T00:00:00Z', '2026-07-01T00:30:00Z'),
    rec('2026-07-01T00:30:00Z', '2026-07-01T01:00:00Z'),
    // gap 01:00–05:00
    rec('2026-07-01T05:00:00Z', '2026-07-01T05:30:00Z'),
  ];
  assert.equal(
    contiguousSettledThrough(records), '2026-07-01T01:00:00.000Z',
    'settled-through is the end of the contiguous run, not the max interval_end',
  );
});

test('unsorted input is handled (sorted by start first)', () => {
  const records = [
    rec('2026-07-01T01:00:00Z', '2026-07-01T01:30:00Z'),
    rec('2026-07-01T00:00:00Z', '2026-07-01T00:30:00Z'),
    rec('2026-07-01T00:30:00Z', '2026-07-01T01:00:00Z'),
  ];
  assert.equal(contiguousSettledThrough(records), '2026-07-01T01:30:00.000Z');
});

test('overlapping records extend the boundary to the furthest end', () => {
  const records = [
    rec('2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z'),
    rec('2026-07-01T00:30:00Z', '2026-07-01T01:30:00Z'), // overlaps, extends
  ];
  assert.equal(contiguousSettledThrough(records), '2026-07-01T01:30:00.000Z');
});

test('empty / unparseable input returns null', () => {
  assert.equal(contiguousSettledThrough([]), null);
  assert.equal(contiguousSettledThrough([rec('not-a-date', 'also-bad')]), null);
});
