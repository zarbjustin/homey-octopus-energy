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

test('IOG tariff cache: 6h reuse for a resolved value, exponential backoff for null', async (t) => {
  let calls = 0;
  const real = { tariffType: 'DayNightTariff', resolvedVia: 'exact', validTo: null, tariffCode: 'E-1R-IOG-X-C', productCode: 'IOG-X', dayRate: 30, nightRate: 8, preVatDayRate: 29, preVatNightRate: 7, evDevicePeakRate: null, evDeviceOffPeakRate: null, preVatEvDevicePeakRate: null, preVatEvDeviceOffPeakRate: null, standingCharge: 40 };
  t.mock.method(KrakenClient.prototype, 'getActiveIogTariff', async () => { calls += 1; return real; });
  const app = new OctopusEnergyApp();

  await app.getCachedIogTariff('key', 'A-ONE', 'E-1R-IOG-X-C', 'IOG-X');
  await app.getCachedIogTariff('key', 'A-ONE', 'E-1R-IOG-X-C', 'IOG-X');
  assert.equal(calls, 1, 'a resolved tariff is reused (6h TTL), not re-fetched every call');
});

test('IOG tariff cache backs off a persistent null (does not re-fetch every 30 min)', async (t) => {
  let calls = 0;
  t.mock.method(KrakenClient.prototype, 'getActiveIogTariff', async () => { calls += 1; return null; });
  const app = new OctopusEnergyApp();

  await app.getCachedIogTariff('key', 'A-TWO', 'E-1R-IOG-Y-C', 'IOG-Y'); // miss → 1 call, nullStreak 1
  await app.getCachedIogTariff('key', 'A-TWO', 'E-1R-IOG-Y-C', 'IOG-Y'); // within 30m backoff → cached null
  assert.equal(calls, 1, 'a persistent null is cached (backoff), not re-fetched immediately');
});

test('invalidateIogTariff drops only the IOG cache, not the whole account/budget', async (t) => {
  let calls = 0;
  const real = { tariffType: 'DayNightTariff', resolvedVia: 'exact', validTo: null, tariffCode: 'E-1R-IOG-Z-C', productCode: 'IOG-Z', dayRate: 30, nightRate: 8, preVatDayRate: 29, preVatNightRate: 7, evDevicePeakRate: null, evDeviceOffPeakRate: null, preVatEvDevicePeakRate: null, preVatEvDeviceOffPeakRate: null, standingCharge: 40 };
  t.mock.method(KrakenClient.prototype, 'getActiveIogTariff', async () => { calls += 1; return real; });
  const app = new OctopusEnergyApp();

  await app.getCachedIogTariff('key', 'A-3', 'E-1R-IOG-Z-C', 'IOG-Z');
  app.invalidateIogTariff('A-3');
  await app.getCachedIogTariff('key', 'A-3', 'E-1R-IOG-Z-C', 'IOG-Z');
  assert.equal(calls, 2, 'the entry is re-fetched after targeted invalidation');
});

test('repair propagates rotated credentials to sibling meters on the same account (BL-11)', async () => {
  const app = new OctopusEnergyApp();
  // Two sibling devices (electricity + gas) on account A-ONE with the OLD key,
  // plus one on a different account that must NOT be touched.
  const makeDevice = (id, store) => {
    const s = { ...store };
    return {
      id,
      getData: () => ({ id }),
      getStoreValue: (k) => s[k],
      setStoreValue: async (k, v) => { s[k] = v; },
      applied: null,
      applyCredentials: async (next) => { Object.assign(s, next); },
      store: s,
    };
  };
  const elec = makeDevice('elec-1', { apiKey: 'OLD', accountNumber: 'A-ONE', mpxn: '111', serial: 'e1', fuel: 'electricity' });
  const gas = makeDevice('gas-1', { apiKey: 'OLD', accountNumber: 'A-ONE', mpxn: '999', serial: 'g1', fuel: 'gas' });
  const other = makeDevice('elec-2', { apiKey: 'KEEP', accountNumber: 'A-TWO', mpxn: '222', serial: 'e2', fuel: 'electricity' });
  const drivers = {
    electricity: { getDevices: () => [elec, other] },
    gas: { getDevices: () => [gas] },
    export: { getDevices: () => [] },
  };
  app.homey = { drivers: { getDriver: (id) => { const d = drivers[id]; if (!d) throw new Error('no'); return d; } } };

  // Repair happened on elec-1 (excluded); propagate NEW key to siblings on A-ONE.
  await app.propagateRepairedCredentials('A-ONE', 'NEW', 'A-ONE', 'elec-1');

  assert.equal(gas.store.apiKey, 'NEW', 'the sibling gas meter gets the rotated key');
  assert.equal(gas.store.accountNumber, 'A-ONE');
  assert.equal(gas.store.serial, 'g1', 'the sibling keeps its own meter identity');
  assert.equal(other.store.apiKey, 'KEEP', 'a device on a different account is untouched');
  assert.equal(elec.store.apiKey, 'OLD', 'the repaired device itself is excluded (already updated by repair)');
});

const { getBucket, resetBudget } = require('../.homeybuild/lib/KrakenBudget.js');

test('invalidateAccountCaches does NOT reset the account Kraken budget/429 gate (S60 review fix)', () => {
  resetBudget();
  const app = new OctopusEnergyApp();
  app.liveDemand = undefined;
  const bucket = getBucket('A-BUDGET');
  for (let i = 0; i < 6; i += 1) bucket.acquire('live'); // drain to 0
  bucket.penalise(); // open a 429 gate
  app.invalidateAccountCaches('A-BUDGET');
  // Same bucket instance, still gated/drained — a key rotation must not wipe the
  // account-scoped rate-limit state.
  assert.strictEqual(getBucket('A-BUDGET'), bucket, 'the account bucket survives cache invalidation');
  assert.equal(bucket.gated, true, 'an active 429 gate is preserved');
});

test('repair propagation is skipped on an account-number change (siblings not stranded)', async () => {
  const app = new OctopusEnergyApp();
  const s = { apiKey: 'OLD', accountNumber: 'A-ONE', serial: 'g1' };
  const gas = {
    getData: () => ({ id: 'gas-1' }),
    getStoreValue: (k) => s[k],
    setStoreValue: async (k, v) => { s[k] = v; },
    store: s,
  };
  app.homey = { drivers: { getDriver: (id) => ({ getDevices: () => (id === 'gas' ? [gas] : []) }) } };

  // Repair moved the electricity meter to a DIFFERENT account: do not touch siblings.
  await app.propagateRepairedCredentials('A-ONE', 'NEW', 'A-TWO', 'elec-1');
  assert.equal(gas.store.apiKey, 'OLD', 'a sibling is NOT re-keyed when the account number changes');
  assert.equal(gas.store.accountNumber, 'A-ONE', 'and is NOT moved to the unvalidated new account');
});
