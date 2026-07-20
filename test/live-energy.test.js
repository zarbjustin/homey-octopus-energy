'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {}, Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');
const { DispatchPoller } = require('../.homeybuild/lib/DispatchPoller.js');
Module._load = originalLoad;

function liveDevice(reading) {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ accountNumber: 'A-ONE' });
  device.homey = { app: { getLiveDemand: () => reading } };
  return device;
}

test('getLiveDemandView derives import from a positive signed net reading', () => {
  const view = liveDevice({ value: 1500, state: 'current', readAt: '2026-07-20T00:00:00Z', source: 'graphql' }).getLiveDemandView();
  assert.equal(view.netW, 1500);
  assert.equal(view.importW, 1500);
  assert.equal(view.exportW, 0);
  assert.equal(view.state, 'current');
});

test('getLiveDemandView derives export from a negative signed net reading', () => {
  const view = liveDevice({ value: -900, state: 'current', readAt: '2026-07-20T00:00:00Z', source: 'graphql' }).getLiveDemandView();
  assert.equal(view.exportW, 900);
  assert.equal(view.importW, 0);
});

test('getLiveDemandView returns nulls (never zero) when the reading is unavailable', () => {
  const view = liveDevice(null).getLiveDemandView();
  assert.equal(view.netW, null);
  assert.equal(view.importW, null);
  assert.equal(view.exportW, null);
  assert.equal(view.state, 'unknown');
});

test('dispatch account view is deviceId-free and clock-accurate', () => {
  const poller = new DispatchPoller({});
  const now = Date.now();
  poller.states.set('A-ONE', {
    windows: [{
      deviceId: 'secret-device-id', kind: 'SMART',
      start: new Date(now - 60_000).toISOString(), end: new Date(now + 1_800_000).toISOString(),
      state: 'active', provenance: 'planned', confidence: 'medium', delta: null,
    }],
    anyActive: true,
    lastCompletedEnd: 0,
  });
  poller.recentCompleted.set('A-ONE', [{ start: '2026-07-19T23:30:00Z', end: '2026-07-20T05:30:00Z', delta: 3.2 }]);

  const view = poller.getAccountView('A-ONE');
  assert.equal(view.activeNow, true);
  assert.equal(view.active.length, 1);
  assert.equal(view.active[0].kind, 'SMART');
  assert.equal(view.recentFinalised.length, 1);
  assert.equal(JSON.stringify(view).includes('secret-device-id'), false, 'no device id leaks into the view');
  assert.equal(JSON.stringify(view).includes('deviceId'), false);
});

test('a window retained across a failed poll is not shown as active once it has ended', () => {
  const poller = new DispatchPoller({});
  const now = Date.now();
  poller.states.set('A-ONE', {
    windows: [{
      deviceId: 'd', kind: 'SMART',
      start: new Date(now - 7_200_000).toISOString(), end: new Date(now - 3_600_000).toISOString(),
      state: 'active', provenance: 'planned', confidence: 'medium', delta: null,
    }],
    anyActive: true, // stale retained flag from a failed poll
    lastCompletedEnd: 0,
  });
  const view = poller.getAccountView('A-ONE');
  assert.equal(view.activeNow, false, 'an ended window is never presented as active');
  assert.equal(view.next, null);
});
