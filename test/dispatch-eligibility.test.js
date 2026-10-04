'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { App: class App {}, Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const App = require('../.homeybuild/app');
const { KrakenClient, KrakenApiError } = require('../.homeybuild/lib/KrakenClient');
const { deviceEligibility, dispatchFailure, DispatchSchemaError } = require('../.homeybuild/lib/dispatch/eligibility');
const { BudgetError } = require('../.homeybuild/lib/KrakenBudget');

Module._load = originalLoad;

const ev = (category = 'EV', controlState = 'IDLE') => ({
  deviceId: 'synthetic',
  typename: 'Synthetic',
  category,
  controlState,
  participating: false,
});

test('eligibility evidence distinguishes EV/charge point, unsupported category and unknown status', () => {
  for (const category of ['EV', 'CHARGE_POINT']) assert.equal(deviceEligibility([ev(category, null)]).state, 'eligible');
  assert.equal(deviceEligibility([ev('BATTERY')]).state, 'ineligible');
  assert.equal(deviceEligibility([ev('HEAT_PUMP')]).reason, 'unsupported-category');
  for (const category of ['unknown', 'other', 'BATTERY']) {
    assert.equal(deviceEligibility([ev(category, null)]).state, 'unknown');
  }
  assert.equal(deviceEligibility([]).state, 'unknown');
});

test('failures use typed status, never unsupported English-message heuristics', () => {
  for (const message of ['Unable to find device for given account.', 'Account is not enrolled', 'Unsupported field']) {
    const result = dispatchFailure(new Error(message));
    assert.equal(result.state, 'degraded');
    assert.equal(result.reason, 'provider-error');
    assert.doesNotMatch(JSON.stringify(result), /given account|not enrolled|Unsupported field/);
  }
  for (const [status, reason] of [[401, 'authentication'], [403, 'authentication'], [429, 'throttled'],
    [0, 'transient'], [503, 'transient']]) assert.equal(dispatchFailure(new KrakenApiError(status, 'hidden')).reason, reason);
  assert.equal(dispatchFailure(new BudgetError()).reason, 'throttled');
  assert.equal(dispatchFailure(new DispatchSchemaError()).reason, 'schema');
});

test('negative eligibility cache skips requests for 30 minutes and normal discovery recovers', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00Z') });
  let discovery = 0;
  let plans = 0;
  let devices = [ev('BATTERY')];
  t.mock.method(KrakenClient.prototype, 'getDevices', async () => {
    discovery += 1; return devices;
  });
  t.mock.method(KrakenClient.prototype, 'getFlexPlannedDispatches', async () => {
    plans += 1; return [];
  });
  const app = new App();
  for (let i = 0; i < 100; i += 1) {
    assert.deepEqual(await app.getFlexPlanned('key', 'account'), []);
    assert.equal(app.getDispatchEligibility('account').state, 'ineligible');
  }
  assert.equal(discovery, 1);
  assert.equal(plans, 0);
  devices = [ev()];
  t.mock.timers.tick(30 * 60_000);
  await app.getFlexPlanned('key', 'account');
  assert.equal(discovery, 2);
  assert.equal(plans, 1);
  assert.equal(app.getDispatchEligibility('account').state, 'eligible');
});

test('empty first legacy feed is unknown; verified legacy empty is authoritative', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00Z') });
  t.mock.method(KrakenClient.prototype, 'getDevices', async () => []);
  let feed = [];
  let calls = 0;
  t.mock.method(KrakenClient.prototype, 'getPlannedDispatches', async () => {
    calls += 1; return feed;
  });
  const app = new App();
  await app.getFlexPlanned('key', 'account');
  assert.equal(app.getDispatchEligibility('account').state, 'unknown');
  await app.getFlexPlanned('key', 'account');
  assert.equal(calls, 1);
  feed = [{ start: '2026-10-04T23:00Z', end: '2026-10-05T05:00Z' }];
  t.mock.timers.tick(30 * 60_000);
  await app.getFlexPlanned('key', 'account');
  assert.equal(app.getDispatchEligibility('account').reason, 'legacy-supported');
  feed = [];
  t.mock.timers.tick(60_000);
  await app.getFlexPlanned('key', 'account');
  assert.equal(app.getDispatchEligibility('account').state, 'eligible');
});

test('auth and long Retry-After pauses do not block another account and reset on rotated credentials', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00Z') });
  t.mock.method(KrakenClient.prototype, 'getDevices', async () => [ev()]);
  let calls = 0;
  let broken = true;
  t.mock.method(KrakenClient.prototype, 'getFlexPlannedDispatches', async function fetchPlan() {
    calls += 1;
    if (broken && this.apiKey === 'bad') throw new KrakenApiError(401, 'Auth');
    return [];
  });
  const app = new App();
  await assert.rejects(app.getFlexPlanned('bad', 'first'));
  t.mock.timers.tick(3600_000);
  await assert.rejects(app.getFlexPlanned('bad', 'first'), /paused/);
  assert.equal(calls, 1);
  await app.getFlexPlanned('good', 'second');
  assert.equal(app.getDispatchEligibility('second').state, 'eligible');
  assert.equal(app.getDispatchEligibility('first').reason, 'authentication');
  broken = false;
  await app.getFlexPlanned('rotated', 'first');
  assert.equal(app.getDispatchEligibility('first').state, 'eligible');
});

test('schema drift and malformed/partial lists throw rather than silently returning empty', async (t) => {
  const cases = [
    ['getDevices', { devices: null }], ['getDevices', { devices: [{ deviceType: 'EV' }] }],
    ['getFlexPlannedDispatches', { flexPlannedDispatches: null }],
    ['getFlexPlannedDispatches', { flexPlannedDispatches: [{ start: 'bad', end: 'bad' }] }],
    ['getCompletedDispatchWindows', {}], ['getPlannedDispatches', { plannedDispatches: null }],
  ];
  for (const [method, data] of cases) {
    const client = new KrakenClient('key', 'account');
    t.mock.method(client, 'query', async () => data);
    await assert.rejects(client[method]('synthetic'), DispatchSchemaError);
  }
});

test('unrelated partial GraphQL errors with intact device data remain fatal', async (t) => {
  const client = new KrakenClient('key', 'account');
  t.mock.method(client, 'getToken', async () => 'synthetic');
  t.mock.method(client, 'post', async () => ({ data: { devices: [] }, errors: [{ message: 'Account is not enrolled' }] }));
  await assert.rejects(client.getDevices('account'), /not enrolled/);
});
