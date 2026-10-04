'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice');
const { OctopusApiError } = require('../.homeybuild/lib/OctopusClient');

Module._load = originalLoad;

function deviceFixture() {
  const device = new OctopusMeterDevice();
  const stored = {};
  const outbound = [];
  const fail = (kind) => async () => {
    outbound.push(kind); throw new Error('Forbidden render acquisition');
  };
  device.homey = {
    settings: { get: () => undefined, set() {} },
    clock: { getTimezone: () => 'Europe/London' },
    app: { getLiveDemand: () => null, getDispatchView: () => null },
  };
  device.store = () => ({
    apiKey: 'key',
    accountNumber: 'account',
    fuel: 'electricity',
    mpxn: 'meter',
    serial: 'serial',
    productCode: 'AGILE',
    tariffCode: 'E-1R-AGILE-A',
  });
  device.getData = () => ({ id: 'selected' });
  device.getName = () => 'Selected meter';
  device.getSetting = () => undefined;
  device.getSettings = () => ({ vat: 'inc', cheap_threshold: 10, expensive_threshold: 30 });
  device.getStoreValue = (k) => stored[k];
  device.setStoreValue = async (k, v) => {
    stored[k] = v;
  };
  device.hasCapability = () => false;
  device.getCapabilityValue = () => null;
  device.carbonForecastForWeighting = () => [];
  device.isGreenestNow = () => false;
  device.refresh = fail('refresh');
  device.client = { consumption: fail('REST'), standardUnitRates: fail('REST') };
  device.kraken = { getActiveIogTariff: fail('GraphQL') };
  device.error = () => {};
  device.log = () => {};
  return { device, outbound };
}

for (const state of ['cold', 'current', 'stale', 'failure']) {
  test(`all seven widget APIs: ${state} reads and a simulated hour make zero outbound calls`, async (t) => {
    const now = Date.parse('2026-10-04T12:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    const { device, outbound } = deviceFixture();
    if (state !== 'cold') {
      const ts = state === 'current' ? now : now - 4 * 3600_000;
      device.dailyUsageCache = { ts, days: 7, value: [{ date: '2026-10-03', kWh: 2 }] };
      device.lastHealthyRefreshAt = ts;
      device.rates = [{
        valid_from: new Date(ts).toISOString(),
        valid_to: new Date(ts + 1800_000).toISOString(),
        value_inc_vat: 20,
        value_exc_vat: 19,
        payment_method: null,
      }];
    }
    if (state === 'failure') device.backgroundRecovery().failure('prices', new OctopusApiError(503, 'Down'), now);
    const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
    for (const name of ['agile', 'price', 'summary', 'timeline', 'carbon', 'export', 'optimiser']) {
      const api = require(`../widgets/${name}/api.js`);
      await Promise.all(Array.from({ length: 100 }, (_, i) => api.getData({
        homey,
        query: { id: 'selected', cheapest: i % 24, palette: 'high_contrast' },
      })));
      for (let minute = 0; minute < 60; minute += 1) {
        t.mock.timers.tick(60_000);
        await api.getData({ homey, query: { id: 'selected' } });
      }
    }
    await device.getFreshAgileDayData(); // compatibility alias must also be safe
    assert.deepEqual(outbound, []);
    const summary = await require('../widgets/summary/api').getData({ homey, query: { id: 'selected' } });
    assert.equal(summary.presentation.dailyUsage.state, state === 'cold' ? 'unknown' : 'stale');
    if (state === 'cold') assert.equal(summary.breakdown, null);
  });
}

test('background history runs at most once per three hours, not per render or normal refresh', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00Z') });
  const { device } = deviceFixture();
  let rest = 0;
  device.client.consumption = async () => {
    rest += 1; return [];
  };
  for (let minute = 0; minute < 180; minute += 5) {
    await device.runReporting('Widget history', 'daily_usage', () => device.getSettledDailyUsage(7, true));
    t.mock.timers.tick(5 * 60_000);
  }
  assert.equal(rest, 1);
  await device.runReporting('Widget history', 'daily_usage', () => device.getSettledDailyUsage(7, true));
  assert.equal(rest, 2);
});

test('background reporting cooldown and recovery work without any widget interaction', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00Z') });
  const { device } = deviceFixture();
  let rest = 0;
  let failing = true;
  device.client.consumption = async () => {
    rest += 1;
    if (failing) throw new OctopusApiError(503, 'Down');
    return [];
  };
  const refresh = () => device.runReporting('Widget history', 'daily_usage', () => device.getSettledDailyUsage(7, true));
  await Promise.all([refresh()]);
  for (let i = 0; i < 4; i += 1) {
    t.mock.timers.tick(60_000); await refresh();
  }
  assert.equal(rest, 1);
  failing = false;
  t.mock.timers.tick(60_000);
  await refresh();
  assert.equal(rest, 2);
  assert.equal(device.getPresentationFreshness().dailyUsage.state, 'current');
  assert.deepEqual(device.backgroundRecovery().snapshot(), {});
});

test('multiple selected meters remain distinct; stale IDs never select another', async () => {
  const first = deviceFixture().device;
  const second = deviceFixture().device;
  second.getData = () => ({ id: 'second' });
  second.getName = () => 'Second meter';
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [first, second] }) } };
  for (const name of ['agile', 'price', 'summary', 'timeline', 'carbon', 'export', 'optimiser']) {
    const api = require(`../widgets/${name}/api`);
    assert.equal((await api.getData({ homey, query: { id: 'second' } })).name, 'Second meter');
    assert.match((await api.getData({ homey, query: { id: 'removed' } })).error, /selected/i);
  }
});

test('background refresh single-flights concurrent scheduled opportunities', async () => {
  const { device } = deviceFixture();
  // Restore the actual refresh lock (the widget fixture intentionally forbids it).
  device.refresh = OctopusMeterDevice.prototype.refresh;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let acquisitions = 0;
  device.runRefresh = async () => {
    acquisitions += 1; await gate;
  };
  const first = device.refresh();
  const second = device.refresh();
  assert.equal(acquisitions, 1);
  release();
  await Promise.all([first, second]);
});

test('credential rotation clears failed presentation state without resetting the account budget', async () => {
  const { device } = deviceFixture();
  device.backgroundRecovery().failure('prices', new OctopusApiError(401, 'Auth'));
  device.dailyUsageCache = { ts: Date.now(), days: 7, value: [] };
  device.buildClients = () => {};
  await device.reloadCredentials('new-key');
  assert.deepEqual(device.backgroundRecovery().snapshot(), {});
  assert.equal(device.getCachedSettledDailyUsage(), null);
  assert.equal(device.getCachedEffectiveRateView(), null);
});
