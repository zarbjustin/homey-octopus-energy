'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const ElectricityDevice = require('../.homeybuild/drivers/electricity/device.js');
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');
Module._load = originalLoad;

function makeDevice({ account = 'A-ONE' } = {}) {
  const caps = new Set();
  const app = { subscriptions: [], unsubscriptions: [], lastCb: null };
  app.subscribeLiveDemand = (creds, id, cb) => { app.subscriptions.push({ creds, id }); app.lastCb = cb; };
  app.unsubscribeLiveDemand = (accountNumber, id) => { app.unsubscriptions.push({ accountNumber, id }); };
  const setValues = [];
  const timers = [];
  const device = Object.create(ElectricityDevice.prototype);
  device.store = () => ({ apiKey: 'k', accountNumber: account });
  device.getData = () => ({ id: 'dev-1' });
  device.getSetting = () => true;
  device.hasCapability = (c) => caps.has(c);
  device.addCapability = async (c) => { caps.add(c); };
  device.removeCapability = async (c) => { caps.delete(c); };
  device.setCapabilityValue = async (c, v) => { setValues.push([c, v]); };
  device.error = () => {};
  device.homey = { app, setInterval: () => { timers.push(1); return 1; }, clearInterval: () => {} };
  return {
    device, caps, app, setValues, timers,
  };
}

test('enabling live power adds measure_power and subscribes to the shared source', async () => {
  const h = makeDevice();
  await h.device.enableLivePower();
  assert.ok(h.caps.has('measure_power'));
  assert.equal(h.app.subscriptions.length, 1);
  assert.deepEqual(h.app.subscriptions[0].creds, { apiKey: 'k', accountNumber: 'A-ONE' });
  assert.equal(h.app.subscriptions[0].id, 'dev-1');
  assert.equal(h.device.liveSubscribedAccount, 'A-ONE');
  assert.equal(h.timers.length, 0, 'no per-device 30s interval is created');
});

test('only a current reading is written to measure_power; stale is ignored', async () => {
  const h = makeDevice();
  await h.device.enableLivePower();
  h.app.lastCb({ value: 1234, readAt: null, source: 'graphql', state: 'current' });
  h.app.lastCb({ value: 9999, readAt: null, source: 'graphql', state: 'stale' });
  h.app.lastCb({ value: null, readAt: null, source: 'graphql', state: 'unknown' });
  assert.deepEqual(h.setValues, [['measure_power', 1234]]);
});

test('disabling live power unsubscribes and removes measure_power', async () => {
  const h = makeDevice();
  await h.device.enableLivePower();
  await h.device.disableLivePower();
  assert.equal(h.app.unsubscriptions.length, 1);
  assert.deepEqual(h.app.unsubscriptions[0], { accountNumber: 'A-ONE', id: 'dev-1' });
  assert.equal(h.caps.has('measure_power'), false);
  assert.equal(h.device.liveSubscribedAccount, null);
});

test('onUninit releases the subscription but keeps the capability', async (t) => {
  t.mock.method(OctopusMeterDevice.prototype, 'onUninit', async () => {});
  const h = makeDevice();
  await h.device.enableLivePower();
  await h.device.onUninit();
  assert.equal(h.app.unsubscriptions.length, 1);
  assert.ok(h.caps.has('measure_power'), 'capability retained across app shutdown');
});

test('repair re-points the live subscription to a new account', async () => {
  const h = makeDevice({ account: 'A-ONE' });
  await h.device.enableLivePower();
  // Simulate a credential change to a different account, then repair.
  h.device.store = () => ({ apiKey: 'k2', accountNumber: 'A-TWO' });
  await h.device.onCredentialsApplied();
  assert.deepEqual(h.app.unsubscriptions[0], { accountNumber: 'A-ONE', id: 'dev-1' });
  assert.equal(h.device.liveSubscribedAccount, 'A-TWO');
  assert.equal(h.app.subscriptions[h.app.subscriptions.length - 1].creds.accountNumber, 'A-TWO');
});

test('octopus_dispatching mirrors the reconciled dispatch view and spends no legacy Kraken call', async () => {
  const h = makeDevice();
  h.caps.add('octopus_dispatching');
  let dispatchViewCalls = 0;
  let activeNow = true;
  let legacyCalls = 0;
  h.app.getDispatchView = (account) => {
    dispatchViewCalls += 1;
    assert.equal(account, 'A-ONE');
    return { activeNow, active: [], next: null, recentFinalised: [] };
  };
  // The legacy per-device dispatch path must no longer be used.
  h.app.getCachedPlannedDispatches = async () => { legacyCalls += 1; return []; };
  h.device.kraken = { getPlannedDispatches: async () => { legacyCalls += 1; return []; } };

  await h.device.refreshDispatching();
  assert.deepEqual(h.setValues.at(-1), ['octopus_dispatching', true], 'active view → capability true');

  activeNow = false;
  await h.device.refreshDispatching();
  assert.deepEqual(h.setValues.at(-1), ['octopus_dispatching', false], 'inactive view → capability false');

  assert.equal(legacyCalls, 0, 'the legacy account-scoped dispatch query is never called');
  assert.equal(dispatchViewCalls, 2, 'the capability reads the reconciled dispatch view');
});

test('octopus_dispatching fails closed to false when no reconciled view exists yet', async () => {
  const h = makeDevice();
  h.caps.add('octopus_dispatching');
  h.app.getDispatchView = () => null;
  await h.device.refreshDispatching();
  assert.deepEqual(h.setValues.at(-1), ['octopus_dispatching', false]);
});
