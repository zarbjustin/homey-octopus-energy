'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AccountPoller } = require('../.homeybuild/lib/AccountPoller.js');
const { DispatchPoller } = require('../.homeybuild/lib/DispatchPoller.js');
const { SavingSessionsPoller } = require('../.homeybuild/lib/SavingSessionsPoller.js');
const { KrakenClient } = require('../.homeybuild/lib/KrakenClient.js');

function fakeApp(accounts) {
  const settings = new Map();
  const fired = [];
  const errors = [];
  const devices = accounts.map(({ apiKey, accountNumber }) => ({
    getStoreValue: (key) => ({ apiKey, accountNumber }[key]),
  }));
  return {
    fired,
    errors,
    error(...args) { errors.push(args); },
    getKrakenClient(apiKey, accountNumber) { return new KrakenClient(apiKey, accountNumber); },
    async getCachedDevices() { return []; },
    async getFlexPlanned(apiKey, accountNumber) {
      const legacy = await new KrakenClient(apiKey, accountNumber).getPlannedDispatches(accountNumber);
      return legacy.map((d) => ({ deviceId: 'account', start: d.start, end: d.end, kind: 'unknown' }));
    },
    async getCachedCompletedWindows(apiKey, accountNumber) {
      const list = await new KrakenClient(apiKey, accountNumber).getCompletedDispatches(accountNumber);
      return list.map((d) => ({ start: d.start, end: d.end, delta: null }));
    },
    homey: {
      drivers: {
        getDriver(id) {
          return { getDevices: () => (id === 'electricity' ? devices : []) };
        },
      },
      flow: { getTriggerCard: (id) => ({ trigger: async (tokens) => { fired.push({ id, tokens }); } }) },
      settings: { get: (key) => settings.get(key), set: (key, value) => settings.set(key, value) },
      notifications: { createNotification: async () => {} },
      clock: { getTimezone: () => 'Europe/London' },
      setInterval: () => 1,
      clearInterval() {},
    },
  };
}

class ProbePoller extends AccountPoller {
  getAccounts() { return this.accounts(); }
  async poll() {}
}

test('account pollers deduplicate devices while retaining distinct accounts', () => {
  const app = fakeApp([
    { apiKey: 'key-a', accountNumber: 'A-ONE' },
    { apiKey: 'key-a', accountNumber: 'A-ONE' },
    { apiKey: 'key-b', accountNumber: 'A-TWO' },
  ]);
  assert.deepEqual(new ProbePoller(app).getAccounts(), [
    { apiKey: 'key-a', accountNumber: 'A-ONE' },
    { apiKey: 'key-b', accountNumber: 'A-TWO' },
  ]);
});

test('completed dispatches continue firing after more than 50 historical entries', async (t) => {
  const app = fakeApp([{ apiKey: 'key-a', accountNumber: 'A-ONE' }]);
  let count = 60;
  t.mock.method(KrakenClient.prototype, 'getPlannedDispatches', async () => []);
  t.mock.method(KrakenClient.prototype, 'getCompletedDispatches', async () => Array.from({ length: count }, (_, i) => ({
    start: new Date(Date.UTC(2025, 0, 1, i)).toISOString(),
    end: new Date(Date.UTC(2025, 0, 1, i) + 30 * 60_000).toISOString(),
  })));
  const poller = new DispatchPoller(app);
  await poller.poll(); // first poll seeds completed history (no fire)
  count = 61;
  await poller.poll();
  assert.equal(app.fired.filter((event) => event.id === 'dispatch_completed').length, 1);
});

test('Saving Session state is isolated per account', async (t) => {
  const app = fakeApp([
    { apiKey: 'key-a', accountNumber: 'A-ONE' },
    { apiKey: 'key-b', accountNumber: 'A-TWO' },
  ]);
  const start = new Date(Date.now() + 3600_000).toISOString();
  const end = new Date(Date.now() + 2 * 3600_000).toISOString();
  t.mock.method(KrakenClient.prototype, 'getSavingSessions', async () => [{
    id: 'shared-id', startAt: start, endAt: end, rewardPerKwh: 100,
  }]);
  t.mock.method(KrakenClient.prototype, 'getFreeElectricitySessions', async () => []);
  await new SavingSessionsPoller(app).poll();
  const state = app.homey.settings.get('saving_sessions_state_v2');
  assert.deepEqual(Object.keys(state).sort(), ['A-ONE', 'A-TWO']);
  assert.deepEqual(state['A-ONE'].known, ['shared-id']);
  assert.deepEqual(state['A-TWO'].known, ['shared-id']);
  const diagnostics = app.homey.settings.get('saving_sessions_diagnostics_v1');
  assert.equal(diagnostics['A-ONE'].sessionCount, 1);
  assert.equal(diagnostics['A-ONE'].lastError, undefined);
});

test('Saving Session API failures are logged once and retained for diagnostics', async (t) => {
  const app = fakeApp([{ apiKey: 'key-a', accountNumber: 'A-ONE' }]);
  t.mock.method(KrakenClient.prototype, 'getSavingSessions', async () => {
    throw new Error('Saving Sessions field is unavailable');
  });
  const poller = new SavingSessionsPoller(app);
  await poller.poll();
  await poller.poll();

  assert.equal(app.errors.length, 1);
  const diagnostics = app.homey.settings.get('saving_sessions_diagnostics_v1');
  assert.match(diagnostics['A-ONE'].lastError, /field is unavailable/);
  assert.ok(diagnostics['A-ONE'].lastAttempt);
});

test('Saving Session diagnostics redact the API key from errors', async (t) => {
  const app = fakeApp([{ apiKey: 'secret-key', accountNumber: 'A-ONE' }]);
  t.mock.method(KrakenClient.prototype, 'getSavingSessions', async () => {
    throw new Error('Request failed for secret-key');
  });
  await new SavingSessionsPoller(app).poll();

  const diagnostics = app.homey.settings.get('saving_sessions_diagnostics_v1');
  assert.equal(diagnostics['A-ONE'].lastError, 'Request failed for [redacted]');
});

test('dispatch failures are logged once and redacted', async (t) => {
  const app = fakeApp([{ apiKey: 'secret-key', accountNumber: 'A-ONE' }]);
  t.mock.method(KrakenClient.prototype, 'getPlannedDispatches', async () => {
    throw new Error('Dispatch request failed for secret-key');
  });
  t.mock.method(KrakenClient.prototype, 'getCompletedDispatches', async () => []);
  const poller = new DispatchPoller(app);
  await poller.poll();
  await poller.poll();

  assert.equal(app.errors.length, 1, 'the same failure is logged once');
  const logged = app.errors[0].join(' ');
  assert.match(logged, /\[redacted\]/);
  assert.doesNotMatch(logged, /secret-key/);
  const diagnostics = app.homey.settings.get('dispatch_diagnostics_v2');
  assert.equal(typeof diagnostics.accounts, 'number');
  assert.equal(JSON.stringify(diagnostics).includes('A-ONE'), false, 'v2 diagnostics carry no account identifiers');
});

test('dispatch_changed fires on a reschedule and dispatch_cancelled on removal (Sprint 44)', async () => {
  const app = fakeApp([{ apiKey: 'key-a', accountNumber: 'A-ONE' }]);
  const now = Date.now();
  const win = (startMin, endMin, kind = 'SMART') => ({
    deviceId: 'dev-1',
    start: new Date(now + startMin * 60_000).toISOString(),
    end: new Date(now + endMin * 60_000).toISOString(),
    kind,
  });
  let planned = [win(120, 360)];
  app.getFlexPlanned = async () => planned;
  app.getCachedCompletedWindows = async () => [];
  const poller = new DispatchPoller(app);

  await poller.poll(); // seed: announces next = W1
  planned = [win(120, 420)]; // same start, later end => reschedule
  await poller.poll();
  planned = []; // removed => cancelled
  await poller.poll();

  const changed = app.fired.find((e) => e.id === 'dispatch_changed');
  const cancelled = app.fired.find((e) => e.id === 'dispatch_cancelled');
  assert.ok(changed, 'dispatch_changed should fire on reschedule');
  assert.equal(changed.tokens.type, 'SMART');
  assert.ok(cancelled, 'dispatch_cancelled should fire on removal');
  assert.equal(cancelled.tokens.type, 'SMART');
});

test('a failed dispatch poll never fires cancelled or changed (Sprint 44)', async () => {
  const app = fakeApp([{ apiKey: 'key-a', accountNumber: 'A-ONE' }]);
  const now = Date.now();
  const planned = [{
    deviceId: 'dev-1',
    start: new Date(now + 120 * 60_000).toISOString(),
    end: new Date(now + 360 * 60_000).toISOString(),
    kind: 'SMART',
  }];
  let fail = false;
  app.getFlexPlanned = async () => { if (fail) throw new Error('boom'); return planned; };
  app.getCachedCompletedWindows = async () => [];
  const poller = new DispatchPoller(app);

  await poller.poll(); // seed
  fail = true;
  await poller.poll(); // stale poll: retains prior state, fabricates nothing

  const ids = app.fired.map((e) => e.id);
  assert.ok(!ids.includes('dispatch_cancelled'), 'no cancellation from a failed poll');
  assert.ok(!ids.includes('dispatch_changed'), 'no reschedule from a failed poll');
});

test('a failed first poll does not later fabricate dispatch_started (Sprint 44)', async () => {
  const app = fakeApp([{ apiKey: 'key-a', accountNumber: 'A-ONE' }]);
  const now = Date.now();
  const active = [{
    deviceId: 'dev-1',
    start: new Date(now - 5 * 60_000).toISOString(),
    end: new Date(now + 25 * 60_000).toISOString(),
    kind: 'SMART',
  }];
  let fail = true;
  app.getFlexPlanned = async () => { if (fail) throw new Error('boom'); return active; };
  app.getCachedCompletedWindows = async () => [];
  const poller = new DispatchPoller(app);

  await poller.poll(); // first poll FAILS: retains nothing, must not seed
  fail = false;
  await poller.poll(); // first SUCCESSFUL poll observes an already-active dispatch

  const started = app.fired.filter((e) => e.id === 'dispatch_started');
  assert.equal(started.length, 0, 'no started edge from the first successful observation');
});
