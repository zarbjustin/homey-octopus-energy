'use strict';

// BL-23: dispatch read surface + the freshness fail-closed fix. A dispatch
// window is retained across a failed poll (no false cancel), so automations must
// NOT act on stale intent — these pin that dispatchStartsWithin/getNextDispatch
// fail closed unless the dispatch view is `current`.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');
Module._load = originalLoad;

function deviceWithView(view) {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.getDispatchView = () => view;
  return device;
}

function nextWindow(startIso, endIso) {
  return {
    activeNow: false,
    active: [],
    next: {
      kind: 'SMART', start: startIso, end: endIso, state: 'planned', confidence: 'medium',
    },
    recentFinalised: [],
    observedAt: new Date().toISOString(),
    freshness: 'current',
  };
}

test('dispatchStartsWithin is true when a fresh dispatch starts inside the window', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T23:00:00Z') });
  const device = deviceWithView(nextWindow('2026-07-21T23:30:00Z', '2026-07-22T05:30:00Z'));
  assert.equal(device.dispatchStartsWithin(60), true, 'starts in 30 min, within 60');
  assert.equal(device.dispatchStartsWithin(15), false, 'starts in 30 min, not within 15');
});

test('dispatchStartsWithin FAILS CLOSED when the dispatch data is stale', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T23:00:00Z') });
  const view = nextWindow('2026-07-21T23:30:00Z', '2026-07-22T05:30:00Z');
  view.freshness = 'stale';
  assert.equal(deviceWithView(view).dispatchStartsWithin(60), false, 'never act on stale intent');
});

test('dispatchStartsWithin is false with no next dispatch or no view', () => {
  assert.equal(deviceWithView(null).dispatchStartsWithin(60), false);
  const empty = {
    activeNow: false, active: [], next: null, recentFinalised: [], observedAt: null, freshness: 'unknown',
  };
  assert.equal(deviceWithView(empty).dispatchStartsWithin(60), false);
});

test('getNextDispatch returns tokens for a fresh next dispatch, null when stale', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-21T23:00:00Z') });
  const tokens = deviceWithView(nextWindow('2026-07-21T23:30:00Z', '2026-07-22T05:30:00Z')).getNextDispatch();
  assert.equal(tokens.type, 'SMART');
  assert.equal(tokens.confidence, 'medium');
  assert.equal(tokens.minutes_until, 30);
  assert.equal(tokens.start, '2026-07-21T23:30:00Z');

  const stale = nextWindow('2026-07-21T23:30:00Z', '2026-07-22T05:30:00Z');
  stale.freshness = 'stale';
  assert.equal(deviceWithView(stale).getNextDispatch(), null, 'stale → no tokens');
});
