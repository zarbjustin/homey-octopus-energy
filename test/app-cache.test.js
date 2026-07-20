'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {}, Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const OctopusEnergyApp = require('../.homeybuild/app.js');
const { KrakenClient } = require('../.homeybuild/lib/KrakenClient.js');
Module._load = originalLoad;

test('account caches deduplicate balance and dispatch requests', async (t) => {
  let balanceCalls = 0;
  let plannedCalls = 0;
  let completedCalls = 0;
  t.mock.method(KrakenClient.prototype, 'getBalance', async () => { balanceCalls += 1; return 12; });
  t.mock.method(KrakenClient.prototype, 'getPlannedDispatches', async () => {
    plannedCalls += 1;
    return [{ start: '2026-01-01T00:00:00Z', end: '2026-01-01T00:30:00Z' }];
  });
  t.mock.method(KrakenClient.prototype, 'getCompletedDispatches', async () => {
    completedCalls += 1;
    return [];
  });
  const app = new OctopusEnergyApp();

  await Promise.all([
    app.getCachedBalance('key', 'A-ONE'),
    app.getCachedBalance('key', 'A-ONE'),
    app.getCachedPlannedDispatches('key', 'A-ONE'),
    app.getCachedPlannedDispatches('key', 'A-ONE'),
    app.getCachedCompletedDispatches('key', 'A-ONE'),
    app.getCachedCompletedDispatches('key', 'A-ONE'),
  ]);

  assert.equal(balanceCalls, 1);
  assert.equal(plannedCalls, 1);
  assert.equal(completedCalls, 1);
});

test('changing an account API key replaces its Kraken client and cached data', async () => {
  const app = new OctopusEnergyApp();
  const first = app.getKrakenClient('old-key', 'A-ONE');
  app.balanceCache.set('A-ONE', { value: 10, ts: Date.now() });
  const second = app.getKrakenClient('new-key', 'A-ONE');

  assert.notEqual(first, second);
  assert.equal(app.balanceCache.has('A-ONE'), false);
});

test('account value caches remain bounded', async (t) => {
  t.mock.method(KrakenClient.prototype, 'getBalance', async () => 0);
  const app = new OctopusEnergyApp();
  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await app.getCachedBalance(`key-${i}`, `A-${i}`);
  }
  assert.equal(app.balanceCache.size, 20);
  assert.equal(app.krakenClients.size, 20);
});

test('device list is cached, single-flighted, and cleared on credential change', async (t) => {
  let deviceCalls = 0;
  t.mock.method(KrakenClient.prototype, 'getDevices', async () => {
    deviceCalls += 1;
    return [{ deviceId: 'd1', typename: 'SmartFlexVehicle', category: 'EV', controlState: null, participating: false }];
  });
  const app = new OctopusEnergyApp();

  await Promise.all([
    app.getCachedDevices('key', 'A-ONE'),
    app.getCachedDevices('key', 'A-ONE'),
  ]);
  assert.equal(deviceCalls, 1, 'concurrent device lookups collapse to one call');

  app.invalidateAccountCaches('A-ONE');
  assert.equal(app.deviceCache.has('A-ONE'), false);
  assert.equal(app.flexPlannedCache.has('A-ONE'), false);
});

test('getFlexPlanned queries an idle-but-linked EV for its future dispatches', async (t) => {
  const queried = [];
  t.mock.method(KrakenClient.prototype, 'getDevices', async () => ([
    { deviceId: 'ev-1', typename: 'SmartFlexVehicle', category: 'EV', controlState: 'IDLE', participating: false },
  ]));
  t.mock.method(KrakenClient.prototype, 'getFlexPlannedDispatches', async (deviceId) => {
    queried.push(deviceId);
    return [{ deviceId, start: '2026-01-01T23:30:00Z', end: '2026-01-02T05:30:00Z', kind: 'SMART' }];
  });
  let legacyCalled = false;
  t.mock.method(KrakenClient.prototype, 'getPlannedDispatches', async () => { legacyCalled = true; return []; });
  const app = new OctopusEnergyApp();

  const planned = await app.getFlexPlanned('key', 'A-ONE');
  assert.deepEqual(queried, ['ev-1'], 'the idle EV is still queried');
  assert.equal(legacyCalled, false, 'legacy fallback is not used when a device exists');
  assert.equal(planned.length, 1);
});
