'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { LiveDemandSource } = require('../.homeybuild/lib/LiveDemandSource');
const { KrakenClient } = require('../.homeybuild/lib/KrakenClient');
const {
  BudgetError, getBucket, resetBudget, setBudgetClock,
} = require('../.homeybuild/lib/KrakenBudget');
const { supportSnapshot } = require('../lib/supportSnapshot');
const api = require('../api');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {}, Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const OctopusApp = require('../.homeybuild/app');
const ElectricityDevice = require('../.homeybuild/drivers/electricity/device');

Module._load = originalLoad;

const NOW = Date.parse('2026-10-27T12:00:00Z');
const CREDS = { apiKey: 'synthetic-private-key', accountNumber: 'synthetic-private-account' };
test.beforeEach(() => {
  resetBudget(); setBudgetClock(() => Date.now());
});
test.afterEach(() => {
  resetBudget(); setBudgetClock(() => Date.now());
});

function harness() {
  let now = NOW;
  let discovery = 0;
  let demand = 0;
  const timers = new Map();
  const reports = [];
  const errors = [];
  const client = {
    getElectricityDeviceId: async () => {
      discovery += 1; return 'synthetic-private-mini';
    },
    getDemandReading: async () => {
      demand += 1; return { demand: 123, readAt: new Date(now).toISOString() };
    },
  };
  const source = new LiveDemandSource({
    getClient: () => client,
    setInterval: (fn) => {
      const id = timers.size + 1; timers.set(id, fn); return id;
    },
    clearInterval: (id) => timers.delete(id),
    now: () => now,
    onError: (...args) => errors.push(args),
    onDiagnostics: (d) => reports.push(d),
  }, 60);
  const reading = () => source.diagnostics().accounts[0];
  return {
    source,
    client,
    timers,
    reports,
    errors,
    reading,
    advance: (ms) => {
      now += ms;
    },
    requests: () => ({ discovery, demand }),
  };
}

test('no-device discovery and its quiet 30-minute backoff have distinct cached evidence', async () => {
  const h = harness();
  let discoveries = 0;
  h.client.getElectricityDeviceId = async () => {
    discoveries += 1; return null;
  };
  h.source.subscribe(CREDS, 'synthetic-private-subscriber', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  h.advance(60000);
  await h.source.pollAccount(CREDS.accountNumber);
  const d = h.reading();
  assert.equal(d.discovery, 'not-found'); assert.equal(d.reason, 'no-device');
  assert.equal(d.counters.discoveryAttempts, 1); assert.equal(d.counters.discoveryBackoffSkips, 1);
  assert.equal(d.lastDemandAt, null); assert.equal(d.lastSuccessAt, null);
  assert.equal(d.nextDiscoveryAt, new Date(NOW + 1800000).toISOString());
  assert.equal(discoveries, 1); assert.equal(h.requests().demand, 0);
  h.advance(1800000);
  await h.source.pollAccount(CREDS.accountNumber);
  assert.equal(discoveries, 2);
});

test('empty telemetry retains the last reading/time but records an unsuccessful response', async () => {
  const h = harness();
  h.source.subscribe(CREDS, 'synthetic-one', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  h.advance(60000);
  h.client.getDemandReading = async () => ({ demand: null, readAt: null, outcome: 'empty' });
  await h.source.pollAccount(CREDS.accountNumber);
  const d = h.reading();
  assert.equal(d.reason, 'empty-telemetry'); assert.equal(d.counters.emptyReadings, 1);
  assert.equal(d.lastResponseAt, new Date(NOW + 60000).toISOString());
  assert.equal(d.lastSuccessAt, new Date(NOW).toISOString());
  assert.equal(h.source.getLiveDemand(CREDS.accountNumber).value, 123);
  assert.equal(d.readingAt, new Date(NOW).toISOString()); assert.equal(d.readingState, 'stale');
});

test('source copies cached response evidence without extra polling or leaking mutations', async () => {
  const h = harness();
  const evidence = { discoveryCandidates: 2, responseRows: 3 };
  h.client.getMiniResponseEvidence = () => ({ ...evidence });
  h.source.subscribe(CREDS, 'synthetic-meter', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  const snapshot = h.reading();
  assert.equal(snapshot.responseEvidence.responseRows, 3);
  snapshot.responseEvidence.responseRows = 999;
  assert.equal(h.reading().responseEvidence.responseRows, 3);
});

test('a local budget skip is distinct from a provider error and does not fabricate a response', async () => {
  const h = harness();
  h.client.getElectricityDeviceId = async () => {
    throw new BudgetError('synthetic-private-error');
  };
  h.source.subscribe(CREDS, 'synthetic-one', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  const d = h.reading();
  assert.equal(d.reason, 'budget-limited'); assert.equal(d.lastErrorKind, 'budget');
  assert.equal(d.counters.budgetSkips, 1); assert.equal(d.counters.providerErrors, 0);
  assert.equal(d.lastDemandAt, null); assert.equal(d.lastResponseAt, null);
  assert.equal(h.errors.length, 0);
});

test('a shared cooldown skips discovery and telemetry and reports its resume gate', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const h = harness();
  getBucket(CREDS.accountNumber).penalise(300000);
  h.source.subscribe(CREDS, 'synthetic-one', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  const d = h.reading();
  assert.equal(d.reason, 'rate-limited'); assert.equal(d.counters.cooldownSkips, 1);
  assert.equal(d.cooldownUntil, new Date(NOW + 300000).toISOString());
  assert.deepEqual(h.requests(), { discovery: 0, demand: 0 });
});

for (const readAt of [null, 'synthetic-private-time', new Date(NOW + 1).toISOString()]) {
  test(`missing/invalid/future sample time is not replaced with receipt time (${readAt === null ? 'null' : 'invalid'})`, async () => {
    const h = harness();
    h.client.getDemandReading = async () => ({ demand: 0, readAt });
    h.source.subscribe(CREDS, 'synthetic-one', () => {});
    await h.source.pollAccount(CREDS.accountNumber);
    assert.equal(h.reading().reason, 'invalid-timestamp');
    assert.equal(h.reading().lastSuccessAt, null); assert.equal(h.reading().counters.invalidReadings, 1);
    assert.equal(h.source.getLiveDemand(CREDS.accountNumber).value, null);
    assert.doesNotMatch(JSON.stringify(h.source.diagnostics()), /synthetic-private/);
  });
}

test('an old sample is distinct from a successful fresh zero-watt sample', async () => {
  const h = harness();
  h.client.getDemandReading = async () => ({ demand: 0, readAt: new Date(NOW - 600000).toISOString() });
  h.source.subscribe(CREDS, 'synthetic-one', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  assert.equal(h.reading().counters.staleReadings, 1); assert.equal(h.reading().lastSuccessAt, null);
  h.client.getDemandReading = async () => ({ demand: 0, readAt: new Date(NOW).toISOString() });
  await h.source.pollAccount(CREDS.accountNumber);
  assert.equal(h.reading().counters.currentReadings, 1); assert.equal(h.reading().lastSuccessAt, new Date(NOW).toISOString());
  assert.equal(h.source.getLiveDemand(CREDS.accountNumber).value, 0);
});

test('in-flight quiet stalls are observable without overlapping requests or extra timers', async () => {
  const h = harness();
  let release;
  h.client.getElectricityDeviceId = () => new Promise((resolve) => {
    release = resolve;
  });
  h.source.subscribe(CREDS, 'synthetic-one', () => {});
  const first = h.source.pollAccount(CREDS.accountNumber);
  h.advance(300000);
  const second = h.source.pollAccount(CREDS.accountNumber);
  assert.equal(h.reading().inFlight, true); assert.equal(h.reading().counters.discoveryAttempts, 1);
  assert.equal(h.reading().counters.coalesced, 2); assert.equal(h.timers.size, 1);
  assert.equal(h.reports.at(-1).accounts[0].inFlight, true);
  release('synthetic-private-mini');
  await Promise.all([first, second]);
  assert.equal(h.reading().inFlight, false); assert.equal(h.requests().demand, 1);
});

test('diagnostic reads do not poll, mutate evidence, log, expose values or exceed the account bound', async () => {
  const h = harness();
  h.source.subscribe(CREDS, 'synthetic-private-subscriber', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  const before = h.requests();
  const logs = h.reports.length;
  const original = h.source.diagnostics();
  for (let i = 0; i < 50; i++) {
    const d = h.source.diagnostics();
    d.accounts[0].counters.demandAttempts = 999;
    assert.doesNotMatch(JSON.stringify(d), /synthetic-private|apiKey|deviceId|123/);
  }
  assert.deepEqual(h.requests(), before); assert.equal(h.reports.length, logs);
  assert.deepEqual(h.source.diagnostics(), original);
  for (let i = 0; i < 6; i++) h.source.subscribe({ ...CREDS, accountNumber: `synthetic-private-${i}` }, `synthetic-private-${i}`, () => {});
  assert.equal(h.source.diagnostics().accounts.length, 5); assert.equal(h.source.diagnostics().truncated, true);
  h.source.stopAll();
});

test('a credential invalidation fences old telemetry and subscriber exceptions cannot kill polling', async () => {
  const h = harness();
  let release;
  h.client.getDemandReading = () => new Promise((resolve) => {
    release = resolve;
  });
  h.source.subscribe(CREDS, 'synthetic-one', () => {
    throw new Error('synthetic-private-listener');
  });
  const pending = h.source.pollAccount(CREDS.accountNumber);
  await Promise.resolve();
  h.source.invalidate(CREDS.accountNumber);
  release({ demand: 999, readAt: new Date(NOW).toISOString() });
  await pending;
  assert.equal(h.reading().lastSuccessAt, null); assert.equal(h.source.getLiveDemand(CREDS.accountNumber).value, null);
  h.client.getDemandReading = async () => ({ demand: 123, readAt: new Date(NOW).toISOString() });
  await h.source.pollAccount(CREDS.accountNumber);
  assert.equal(h.reading().counters.currentReadings, 1); assert.equal(h.reading().counters.subscriberErrors, 2);
  assert.doesNotMatch(JSON.stringify(h.errors), /synthetic-private/);
});

test('routine diagnostic emission is capped at one per five minutes on the existing loop', async () => {
  const h = harness();
  h.source.subscribe(CREDS, 'synthetic-one', () => {});
  await h.source.pollAccount(CREDS.accountNumber);
  const initial = h.reports.length;
  for (let i = 0; i < 4; i++) {
    h.advance(60000);
    // eslint-disable-next-line no-await-in-loop
    await h.source.pollAccount(CREDS.accountNumber);
  }
  assert.equal(h.reports.length, initial);
  h.advance(60000);
  await h.source.pollAccount(CREDS.accountNumber);
  assert.equal(h.reports.length, initial + 1);
  assert.equal(h.timers.size, 1);
});

test('Kraken rejects null/blank/non-numeric demand without turning it into zero', async (t) => {
  let raw = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const query = JSON.parse(init.body).query;
    const data = query.includes('obtainKrakenToken') ? { obtainKrakenToken: { token: 'synthetic-token' } }
      : { smartMeterTelemetry: { demand: raw, readAt: new Date(NOW).toISOString() } };
    return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
  });
  const client = new KrakenClient('synthetic-key', 'synthetic-account');
  for (const value of [null, '', ' ', false, 'invalid']) {
    resetBudget(); raw = value;
    // eslint-disable-next-line no-await-in-loop
    const sample = await client.getDemandReading('synthetic-mini');
    assert.equal(sample.demand, null); assert.equal(sample.outcome, 'invalid-demand');
  }
  resetBudget(); raw = 0;
  assert.equal((await client.getDemandReading('synthetic-mini')).demand, 0);
});

test('support snapshot independently allowlists Mini source and delivery metadata', async () => {
  const secret = 'synthetic-private';
  const malicious = {
    observedAt: new Date(NOW).toISOString(),
    cadenceSeconds: 60,
    activeAccounts: 1,
    raw: secret,
    accounts: [{
      account: secret, reason: secret, discovery: 'found', readingState: 'unknown', power: 123, lastDemandAt: secret, counters: { demandAttempts: 2, raw: secret },
    }],
  };
  const result = supportSnapshot({
    version: '1.0.41',
    driverReads: {},
    mini: malicious,
    meters: [{
      kind: 'electricity',
      miniDelivery: {
        enabled: true, subscribed: false, capabilityPresent: true, raw: secret, receivedAt: secret,
      },
    }],
  }, NOW);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|power|123/);
  assert.equal(result.mini.accounts[0].reason, 'unknown'); assert.equal(result.mini.accounts[0].lastDemandAt, null);
  assert.equal(result.mini.accounts[0].counters.demandAttempts, 2);
  assert.equal(result.meters[0].miniDelivery.enabled, true); assert.equal(result.meters[0].miniDelivery.subscribed, false);
  const endpoint = await api.getSupportSnapshot({
    homey: {
      manifest: { version: '1.0.41' }, drivers: { getDriver: () => ({ getDevices: () => [] }) }, settings: { get: () => null }, app: { getMiniDiagnostics: () => malicious },
    },
  });
  assert.equal(endpoint.mini.accounts[0].discovery, 'found'); assert.doesNotMatch(JSON.stringify(endpoint), /synthetic-private/);
});

test('app wires bounded Mini snapshots into Homey diagnostics and cached support readback', async () => {
  const logs = [];
  const app = new OctopusApp();
  app.homey = { settings: { get: () => 60, on() {} }, setInterval: () => 1, clearInterval() {} };
  app.log = (...args) => logs.push(args);
  app.error = () => {};
  app.getKrakenClient = () => ({ getElectricityDeviceId: async () => null });
  app.startLiveDemand();
  app.subscribeLiveDemand(CREDS, 'synthetic-one', () => {});
  await app.liveDemand.pollAccount(CREDS.accountNumber);
  assert.equal(app.getMiniDiagnostics().accounts[0].reason, 'no-device');
  assert.match(JSON.stringify(logs), /Mini diagnostics \(identifier-free\)/);
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-private/);
  app.liveDemand.stopAll();
});

test('meter delivery distinguishes enabled-but-unsubscribed from received and written callbacks', async () => {
  const device = Object.create(ElectricityDevice.prototype);
  device.miniWriteFailures = 0;
  device.liveSubscribedAccount = null;
  device.getSetting = () => true; device.hasCapability = () => true;
  device.store = () => CREDS; device.getData = () => ({ id: 'synthetic-private-meter' });
  let callback;
  device.homey = {
    app: {
      subscribeLiveDemand: (_c, _id, cb) => {
        callback = cb;
      },
      unsubscribeLiveDemand() {},
      isLiveDemandSubscribed: () => true,
    },
  };
  device.setCapabilityValue = async () => {
    throw new Error('synthetic-private-error');
  };
  device.error = () => {};
  assert.equal(device.getMiniDiagnostics().subscribed, false);
  await device.enableLivePower();
  callback({ value: 10, state: 'current', readAt: new Date(NOW).toISOString() });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(device.getMiniDiagnostics().writeFailures, 1); assert.equal(device.getMiniDiagnostics().writtenAt, null);
  device.setCapabilityValue = async () => {};
  callback({ value: 0, state: 'current', readAt: new Date(NOW).toISOString() });
  await Promise.resolve();
  assert.ok(device.getMiniDiagnostics().writtenAt); assert.equal(device.getMiniDiagnostics().subscribed, true);
  assert.doesNotMatch(JSON.stringify(device.getMiniDiagnostics()), /synthetic-private|value|power/);
});
