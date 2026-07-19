'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LiveDemandSource } = require('../.homeybuild/lib/LiveDemandSource.js');

function harness({ deviceId = 'synthetic-mini', demand = 500, readAt = null } = {}) {
  const clock = { t: 1_000_000 };
  const calls = { discover: 0, demand: 0, setInterval: 0, clearInterval: 0 };
  const timers = new Map();
  let nextTimer = 1;
  const client = {
    getElectricityDeviceId: async () => { calls.discover += 1; return deviceId; },
    getDemandReading: async () => {
      calls.demand += 1;
      return { demand, readAt: readAt ?? new Date(clock.t).toISOString() };
    },
  };
  const deps = {
    getClient: () => client,
    setInterval: (fn) => { calls.setInterval += 1; const id = nextTimer++; timers.set(id, fn); return id; },
    clearInterval: (id) => { calls.clearInterval += 1; timers.delete(id); },
    now: () => clock.t,
    onError: () => {},
  };
  const source = new LiveDemandSource(deps, 120);
  return { source, clock, calls, client, timers, deps };
}

const CREDS = { apiKey: 'k', accountNumber: 'A-ONE' };

test('the first subscriber starts one poll loop; extra subscribers share it', async () => {
  const h = harness();
  const seenA = [];
  const seenB = [];
  h.source.subscribe(CREDS, 'dev-a', (r) => seenA.push(r));
  h.source.subscribe(CREDS, 'dev-b', (r) => seenB.push(r));
  await h.source.pollAccount('A-ONE');

  assert.equal(h.calls.setInterval, 1, 'exactly one timer for the account');
  assert.equal(h.calls.discover, 1, 'device id resolved once');
  assert.ok(seenA.some((r) => r.state === 'current' && r.value === 500));
  assert.ok(seenB.some((r) => r.state === 'current' && r.value === 500));
});

test('concurrent polls are single-flighted into one demand fetch', async () => {
  const h = harness();
  h.source.subscribe(CREDS, 'dev-a', () => {});
  await Promise.all([h.source.pollAccount('A-ONE'), h.source.pollAccount('A-ONE')]);
  // subscribe already kicked one poll; the two awaited calls collapse into it.
  assert.equal(h.calls.demand, 1);
});

test('the last unsubscribe stops the poll loop', async () => {
  const h = harness();
  h.source.subscribe(CREDS, 'dev-a', () => {});
  h.source.subscribe(CREDS, 'dev-b', () => {});
  h.source.unsubscribe('A-ONE', 'dev-a');
  assert.equal(h.calls.clearInterval, 0, 'still polling with one subscriber left');
  h.source.unsubscribe('A-ONE', 'dev-b');
  assert.equal(h.calls.clearInterval, 1, 'timer cleared when the last subscriber leaves');
  assert.equal(h.source.getLiveDemand('A-ONE'), null);
});

test('a failed refresh yields a stale reading that retains the last value', async () => {
  const h = harness();
  const seen = [];
  h.source.subscribe(CREDS, 'dev-a', (r) => seen.push(r));
  await h.source.pollAccount('A-ONE');
  // Now make the demand fetch fail.
  h.client.getDemandReading = async () => { throw new Error('boom'); };
  await h.source.pollAccount('A-ONE');
  const last = seen[seen.length - 1];
  assert.equal(last.state, 'stale');
  assert.equal(last.value, 500, 'last good value is retained, not cleared');
});

test('an old sample is reported as stale, never current', async () => {
  const h = harness({ readAt: new Date(0).toISOString() }); // ancient sample
  const seen = [];
  h.source.subscribe(CREDS, 'dev-a', (r) => seen.push(r));
  await h.source.pollAccount('A-ONE');
  const last = seen[seen.length - 1];
  assert.equal(last.state, 'stale');
});

test('an account with no Home Mini reports unknown and backs off discovery', async () => {
  const h = harness({ deviceId: null });
  const seen = [];
  h.source.subscribe(CREDS, 'dev-a', (r) => seen.push(r));
  await h.source.pollAccount('A-ONE');
  assert.equal(seen[seen.length - 1].state, 'unknown');
  // A second immediate poll must not re-query discovery (backoff active).
  await h.source.pollAccount('A-ONE');
  assert.equal(h.calls.discover, 1);
  assert.equal(h.calls.demand, 0);
});

test('changing cadence reschedules an active loop', async () => {
  const h = harness();
  h.source.subscribe(CREDS, 'dev-a', () => {});
  h.source.setCadenceSeconds(60);
  assert.equal(h.calls.clearInterval, 1);
  assert.equal(h.calls.setInterval, 2, 'timer replaced with the new cadence');
});

test('stopAll clears every loop', async () => {
  const h = harness();
  h.source.subscribe(CREDS, 'dev-a', () => {});
  h.source.subscribe({ apiKey: 'k', accountNumber: 'A-TWO' }, 'dev-b', () => {});
  h.source.stopAll();
  assert.equal(h.calls.clearInterval, 2);
  assert.equal(h.source.activeAccounts(), 0);
});
