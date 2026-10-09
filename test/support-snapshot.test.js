'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');
const { supportSnapshot } = require('../lib/supportSnapshot');
const api = require('../api');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice');

Module._load = originalLoad;

const NOW = Date.parse('2026-10-09T12:00:00Z');
const stamp = new Date(NOW - 120000).toISOString();

function input(overrides = {}) {
  return {
    version: '1.0.39', meters: [], sessions: null, dispatch: null, driverReads: {}, ...overrides,
  };
}

test('support snapshot strictly allowlists fields and never copies raw identity, payload, SOC or text', () => {
  const secret = 'private-identifier-token';
  const plan = {
    decision: 'eligible_fallback',
    configured: true,
    preferredPrice: -1,
    maximumPrice: 25,
    fallback: true,
    remainingHours: 0.75,
    selectedHours: 1,
    explanation: secret,
    deadline: secret,
    slots: [secret],
    soc: 50,
  };
  const data = input({
    meters: [{
      kind: 'electricity',
      name: secret,
      id: secret,
      settings: { apiKey: secret },
      plan,
      freshnessRead: true,
      freshness: { problem: false, secret, sources: { prices: { state: 'stale', updatedAt: stamp, lastError: secret }, [secret]: {} } },
    }],
    sessions: {
      [secret]: {
        lastAttempt: stamp,
        lastError: secret,
        saving: {
          valid: 2, expired: 1, tracked: 3, suppressed: 0, overflow: 0,
        },
        unknown: secret,
      },
    },
    dispatch: {
      lastAttempt: stamp, accounts: 2, errors: 1, deviceId: secret, lastError: secret,
    },
  });
  const before = JSON.stringify(data);
  const snapshot = supportSnapshot(data, NOW);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-|apiKey|explanation|deadline|slots|soc|deviceId|lastError|settings/);
  assert.equal(snapshot.meters[0].sources.prices.ageMinutes, 2);
  assert.equal(snapshot.meters[0].plan.decision, 'eligible_fallback');
  assert.equal(snapshot.sessions.accounts[0].saving.suppressed, 0);
  assert.equal(snapshot.sessions.accounts[0].lastCheckFailed, true);
  assert.equal(snapshot.dispatch.errors, 1);
  assert.equal(JSON.stringify(data), before);
});

test('snapshot missing/malformed fields stay unknown, not zero or success-shaped', () => {
  const result = supportSnapshot(input({ version: 'private-name', meters: [{ kind: 'private-driver', plan: {}, freshness: null }] }), NOW);
  assert.equal(result.appVersion, null);
  assert.equal(result.dispatch, null);
  assert.equal(result.sessions, null);
  assert.equal(result.meters[0].freshnessRead, false);
  assert.equal(result.meters[0].problem, null);
  assert.equal(result.meters[0].sources.prices.state, 'unknown');
  assert.equal(result.meters[0].sources.prices.ageMinutes, null);
  assert.equal(result.meters[0].plan, null);
  for (const value of ['2', NaN, Infinity, -1, 1.5, 1000001]) {
    const view = supportSnapshot(input({ dispatch: { accounts: value } }), NOW);
    assert.equal(view.dispatch.accounts, null);
  }
});

test('snapshot rejects future/invalid source ages and arbitrary decisions/limits', () => {
  for (const updatedAt of ['private-stamp', new Date(NOW + 1).toISOString()]) {
    const view = supportSnapshot(input({ meters: [{ kind: 'electricity', freshness: { sources: { prices: { updatedAt, state: 'current' } } }, plan: { decision: 'private-decision', preferredPrice: 'private-price', selectedHours: Infinity } }] }), NOW);
    assert.equal(view.meters[0].sources.prices.state, 'unknown');
    assert.equal(view.meters[0].sources.prices.ageMinutes, null);
    assert.equal(view.meters[0].plan.decision, 'unknown');
    assert.equal(view.meters[0].plan.preferredPrice, null);
    assert.equal(view.meters[0].plan.selectedHours, null);
    assert.doesNotMatch(JSON.stringify(view), /private-/);
  }
});

test('snapshot is bounded and reports truncation rather than claiming complete coverage', () => {
  const view = supportSnapshot(input({ meters: Array.from({ length: 110 }, () => ({ kind: 'gas' })), sessions: Object.fromEntries(Array.from({ length: 110 }, (_, i) => [`private-${i}`, {}])) }), NOW);
  assert.equal(view.meters.length, 100);
  assert.equal(view.metersTruncated, true);
  assert.equal(view.sessions.accounts.length, 100);
  assert.equal(view.sessions.truncated, true);
  assert.doesNotMatch(JSON.stringify(view), /private-/);
});

test('support endpoint isolates read failures, never exposes their messages or falls back to raw objects', async () => {
  const unavailable = () => {
    throw new Error('private-token');
  };
  const result = await api.getSupportSnapshot({ homey: { manifest: { version: '1.0.39' }, drivers: { getDriver: unavailable }, settings: { get: unavailable } } });
  assert.equal(result.meters.length, 0);
  assert.ok(result.driverReads.every((d) => d.available === false));
  assert.equal(result.sessions, null);
  assert.equal(result.dispatch, null);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

for (const state of ['cold', 'current', 'stale', 'failure']) {
  test(`support endpoint ${state}: repeated real cached device getters perform no outbound calls or writes`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const device = Object.create(OctopusMeterDevice.prototype);
    const forbidden = () => {
      throw new Error('Unexpected identity, credentials, provider read or write');
    };
    device.homey = {
      settings: { get: () => null, set: forbidden },
      clock: { getTimezone: () => 'Europe/London' },
      app: { getDispatchView: () => null },
    };
    device.getSetting = () => 30;
    device.getData = () => ({ id: 'private-meter-id' }); // opaque local freshness lookup only
    device.getName = forbidden;
    device.getSettings = forbidden;
    device.getStoreValue = () => null;
    device.setStoreValue = forbidden;
    device.hasCapability = () => false;
    device.getCapabilityValue = () => null;
    device.refresh = forbidden;
    device.client = new Proxy({}, { get: forbidden });
    device.kraken = new Proxy({}, { get: forbidden });
    device.diagnosticUpdates = state === 'cold' ? {} : {
      prices: { lastSuccess: new Date(NOW - (state === 'current' ? 120000 : 7200000)).toISOString(), lastError: state === 'failure' ? 'private-error' : undefined },
    };
    const homey = {
      manifest: { version: '1.0.39' },
      drivers: { getDriver: (kind) => ({ getDevices: () => (kind === 'electricity' ? [device] : []) }) },
      settings: { get: () => null, set: forbidden },
    };
    for (let i = 0; i < 20; i++) {
      const snapshot = await api.getSupportSnapshot({ homey });
      assert.equal(snapshot.meters[0].freshnessRead, true);
      const expected = {
        cold: 'unknown', current: 'current', stale: 'stale', failure: 'stale',
      }[state];
      assert.equal(snapshot.meters[0].sources.prices.state, expected);
      assert.equal(snapshot.meters[0].plan.configured, false);
      assert.doesNotMatch(JSON.stringify(snapshot), /private-/);
    }
  });
}

function settingsUi() {
  const nodes = new Map();
  const handlers = {};
  const getElementById = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        disabled: id !== 'support-generate',
        hidden: true,
        value: '',
        textContent: '',
        addEventListener: (event, callback) => {
          handlers[`${id}:${event}`] = callback;
        },
      });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById, body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
    Blob,
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
    setTimeout: (fn) => fn(),
  });
  const script = fs.readFileSync('settings/index.html', 'utf8').match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);
  return { context, nodes, handlers };
}

test('support preview/download is user initiated, read-only, clears retained previews on failed retry', () => {
  const { context, nodes, handlers } = settingsUi();
  let requests = 0;
  let callback;
  context.onHomeyReady({
    get: (_key, done) => done(null, null),
    set: () => assert.fail('Unexpected settings write'),
    ready() {},
    api: (method, route, body, done) => {
      assert.equal(method, 'GET'); assert.equal(route, '/support/snapshot'); assert.equal(body, null);
      requests += 1; callback = done;
    },
  });
  assert.equal(requests, 0, 'opening settings must not generate a snapshot');
  handlers['support-generate:click']();
  assert.equal(requests, 1);
  assert.equal(nodes.get('support-generate').disabled, true);
  callback(null, supportSnapshot(input(), NOW));
  assert.equal(nodes.get('support-download').disabled, false);
  assert.match(nodes.get('support-preview').value, /schemaVersion/);
  handlers['support-download:click']();
  assert.equal(requests, 1, 'downloading must not collect diagnostics again');
  handlers['support-clear:click']();
  assert.equal(nodes.get('support-preview').value, '');
  assert.equal(nodes.get('support-download').disabled, true);
  handlers['support-generate:click']();
  callback(new Error('private-error-body'));
  assert.equal(nodes.get('support-download').disabled, true);
  assert.doesNotMatch(nodes.get('support-status').textContent, /private-/);
  assert.equal(nodes.get('support-generate').disabled, false);
});

test('snapshot manifest route stays authenticated, GET-only and matches the shipped handler', () => {
  const route = require('../.homeycompose/app.json').api.getSupportSnapshot;
  assert.deepEqual(route, { method: 'GET', path: '/support/snapshot', public: false });
  assert.deepEqual(require('../app.json').api.getSupportSnapshot, route);
  assert.equal(typeof api.getSupportSnapshot, 'function');
});
