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
  const devices = accounts.map(({ apiKey, accountNumber }) => ({
    getStoreValue: (key) => ({ apiKey, accountNumber }[key]),
  }));
  return {
    fired,
    error() {},
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
  await poller.poll();
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
});
