'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { reconcile } = require('../.homeybuild/lib/dispatch/reconcile.js');

const EMPTY = { windows: [], anyActive: false, lastCompletedEnd: 0 };
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function planned(deviceId, startOffsetMin, endOffsetMin, kind = 'SMART') {
  return {
    deviceId,
    start: new Date(NOW + startOffsetMin * 60_000).toISOString(),
    end: new Date(NOW + endOffsetMin * 60_000).toISOString(),
    kind,
  };
}

test('a planned window that covers now becomes active and raises the started edge', () => {
  const r = reconcile(EMPTY, [planned('d1', -5, 25)], true, [], NOW);
  assert.equal(r.activeNow.length, 1);
  assert.equal(r.windows[0].state, 'active');
  assert.equal(r.windows[0].kind, 'SMART');
  assert.equal(r.windows[0].confidence, 'medium');
  assert.equal(r.started, true);
  assert.equal(r.anyActive, true);
});

test('a future planned window is planned, not active, and does not start', () => {
  const r = reconcile(EMPTY, [planned('d1', 60, 90)], true, [], NOW);
  assert.equal(r.windows[0].state, 'planned');
  assert.equal(r.activeNow.length, 0);
  assert.equal(r.started, false);
});

test('a BOOST window keeps its type and is never relabelled SMART', () => {
  const r = reconcile(EMPTY, [planned('d1', -5, 25, 'BOOST')], true, [], NOW);
  assert.equal(r.windows[0].kind, 'BOOST');
  assert.equal(JSON.stringify(r).includes('"discount"'), false);
});

test('an unknown dispatch type fails closed to unknown with low confidence', () => {
  const r = reconcile(EMPTY, [planned('d1', -5, 25, 'unknown')], true, [], NOW);
  assert.equal(r.windows[0].kind, 'unknown');
  assert.equal(r.windows[0].confidence, 'low');
});

test('a vanished future planned window is cancelled — only on a successful poll', () => {
  const prev = {
    windows: [{
      deviceId: 'd1', kind: 'SMART', start: new Date(NOW + 60 * 60_000).toISOString(),
      end: new Date(NOW + 90 * 60_000).toISOString(), state: 'planned', provenance: 'planned', confidence: 'medium', delta: null,
    }],
    anyActive: false,
    lastCompletedEnd: 0,
  };
  const r = reconcile(prev, [], true, [], NOW);
  assert.equal(r.cancelled.length, 1);
  assert.equal(r.cancelled[0].state, 'cancelled');
  assert.equal(r.windows.length, 0);
});

test('a failed planned poll retains prior windows and never cancels or ends', () => {
  const prev = {
    windows: [{
      deviceId: 'd1', kind: 'SMART', start: new Date(NOW - 5 * 60_000).toISOString(),
      end: new Date(NOW + 25 * 60_000).toISOString(), state: 'active', provenance: 'planned', confidence: 'medium', delta: null,
    }],
    anyActive: true,
    lastCompletedEnd: 0,
  };
  const r = reconcile(prev, [], false, null, NOW);
  assert.equal(r.stale, true);
  assert.equal(r.cancelled.length, 0);
  assert.equal(r.ended, false, 'no ended edge from a failed poll');
  assert.equal(r.anyActive, true, 'prior active state retained');
  assert.equal(r.windows.length, 1);
});

test('the ended edge fires when an active window genuinely disappears on a good poll', () => {
  const prev = {
    windows: [{
      deviceId: 'd1', kind: 'SMART', start: new Date(NOW - 5 * 60_000).toISOString(),
      end: new Date(NOW + 25 * 60_000).toISOString(), state: 'active', provenance: 'planned', confidence: 'medium', delta: null,
    }],
    anyActive: true,
    lastCompletedEnd: 0,
  };
  const r = reconcile(prev, [], true, [], NOW);
  assert.equal(r.ended, true);
  assert.equal(r.anyActive, false);
});

test('overlapping active windows on two devices raise a single aggregate started edge', () => {
  const r = reconcile(EMPTY, [planned('d1', -5, 25), planned('d2', -2, 28)], true, [], NOW);
  assert.equal(r.activeNow.length, 2);
  assert.equal(r.started, true);
});

test('malformed planned rows are dropped', () => {
  const r = reconcile(EMPTY, [
    { deviceId: 'd1', start: 'not-a-date', end: 'nope', kind: 'SMART' },
    { deviceId: 'd2', start: new Date(NOW + 60_000).toISOString(), end: new Date(NOW).toISOString(), kind: 'SMART' }, // end <= start
  ], true, [], NOW);
  assert.equal(r.windows.length, 0);
});

test('completed windows are reported once via a high-water mark', () => {
  const c = (h) => ({ start: new Date(NOW + h * 3600_000).toISOString(), end: new Date(NOW + h * 3600_000 + 1800_000).toISOString(), delta: null });
  const first = reconcile(EMPTY, [], true, [c(1), c(2)], NOW);
  assert.equal(first.newlyCompleted.length, 2);
  const second = reconcile(
    { windows: [], anyActive: false, lastCompletedEnd: first.lastCompletedEnd },
    [], true, [c(1), c(2), c(3)], NOW,
  );
  assert.equal(second.newlyCompleted.length, 1, 'only the newer window is reported');
});

test('interval membership is instant-based (DST-safe by construction)', () => {
  // A window spanning the UK spring-forward transition; "now" inside it in UTC.
  const start = '2026-03-29T00:30:00Z';
  const end = '2026-03-29T02:30:00Z';
  const now = Date.parse('2026-03-29T01:30:00Z');
  const r = reconcile(EMPTY, [{ deviceId: 'd1', start, end, kind: 'SMART' }], true, [], now);
  assert.equal(r.activeNow.length, 1);
});

test('a large stable completed history never re-fires an already-seen window', () => {
  // Newest-first API order, a big history.
  const rows = Array.from({ length: 200 }, (_, i) => ({
    start: new Date(NOW - i * 3600_000).toISOString(),
    end: new Date(NOW - i * 3600_000 + 1800_000).toISOString(),
    delta: null,
  }));
  const first = reconcile(EMPTY, [], true, rows, NOW);
  const second = reconcile(
    { windows: [], anyActive: false, lastCompletedEnd: first.lastCompletedEnd },
    [], true, rows, NOW,
  );
  assert.equal(second.newlyCompleted.length, 0, 'no window is re-fired regardless of history size');
});
