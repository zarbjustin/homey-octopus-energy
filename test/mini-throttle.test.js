'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { KrakenClient, KrakenApiError } = require('../.homeybuild/lib/KrakenClient');
const { LiveDemandSource } = require('../.homeybuild/lib/LiveDemandSource');
const { resetBudget, setBudgetClock, getBucket } = require('../.homeybuild/lib/KrakenBudget');

const NOW = Date.parse('2026-10-23T12:00:00Z');
const CREDS = { apiKey: 'synthetic-key', accountNumber: 'A-SYNTHETIC' };
const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers } });
const throttle = (errorCode = 'KT-CT-1199', message = 'Too many requests.') => ({ errors: [{ message, ...(errorCode ? { extensions: { errorCode } } : {}) }] });

test.beforeEach(() => {
  resetBudget(); setBudgetClock(() => Date.now());
});
test.afterEach(() => {
  resetBudget(); setBudgetClock(() => Date.now());
});

for (const [code, message] of [['KT-CT-1199', 'Provider rate allowance reached'], [null, 'Too many requests.'], [null, 'Rate limit exceeded']]) {
  test(`HTTP 200 throttling (${code || message}) opens shared cooldown without inline retry`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      requests += 1;
      if (JSON.parse(init.body).query.includes('obtainKrakenToken')) return json({ data: { obtainKrakenToken: { token: 'synthetic-token' } } });
      return json(throttle(code, message), { 'Retry-After': '300' });
    });
    const first = new KrakenClient(CREDS.apiKey, CREDS.accountNumber);
    await assert.rejects(first.getDemandReading('synthetic-mini'), (e) => e instanceof KrakenApiError && e.status === 429);
    assert.equal(requests, 2, 'one token + one demand request, no inline retry');
    assert.equal(getBucket(CREDS.accountNumber).retryAt, new Date(NOW + 300000).toISOString());
    const second = new KrakenClient(CREDS.apiKey, CREDS.accountNumber);
    await assert.rejects(second.getBalance(CREDS.accountNumber), /budget/i);
    assert.equal(requests, 2, 'other account consumers, including token acquisition, cannot bypass the gate');
  });
}

test('token acquisition throttling is classified before auth handling and never retried inline', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1; return json(throttle());
  });
  await assert.rejects(new KrakenClient(CREDS.apiKey, CREDS.accountNumber).getBalance(CREDS.accountNumber), { status: 429 });
  assert.equal(requests, 1);
  assert.equal(getBucket(CREDS.accountNumber).gated, true);
});

test('throttling during an authentication retry opens the same gate', async (t) => {
  let tokens = 0;
  let queries = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (JSON.parse(init.body).query.includes('obtainKrakenToken')) {
      tokens += 1;
      return json({ data: { obtainKrakenToken: { token: 'synthetic-token' } } });
    }
    queries += 1;
    return queries === 1 ? json({ errors: [{ message: 'Authentication failed', extensions: { errorCode: 'KT-CT-1124' } }] }) : json(throttle());
  });
  await assert.rejects(new KrakenClient(CREDS.apiKey, CREDS.accountNumber).getDemandReading('synthetic-mini'), { status: 429 });
  assert.equal(tokens, 2); assert.equal(queries, 2);
  assert.equal(getBucket(CREDS.accountNumber).gated, true);
});

test('an unrelated GraphQL field error stays a field error, not account throttling', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => (JSON.parse(init.body).query.includes('obtainKrakenToken')
    ? json({ data: { obtainKrakenToken: { token: 'synthetic-token' } } })
    : json(throttle('SYNTHETIC-ERROR', 'Unable to find device for given account.'))));
  await assert.rejects(new KrakenClient(CREDS.apiKey, CREDS.accountNumber).getDemandReading('synthetic-mini'), { name: 'KrakenFieldError' });
  assert.equal(getBucket(CREDS.accountNumber).gated, false);
});

test('partial GraphQL data cannot hide a throttle in a later error entry', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => (JSON.parse(init.body).query.includes('obtainKrakenToken')
    ? json({ data: { obtainKrakenToken: { token: 'synthetic-token' } } })
    : json({ data: { devices: [] }, errors: [{ message: 'Device status could not be fetched.' }, ...throttle().errors] })));
  await assert.rejects(new KrakenClient(CREDS.apiKey, CREDS.accountNumber).getDevices(CREDS.accountNumber), { status: 429 });
  assert.equal(getBucket(CREDS.accountNumber).gated, true);
});

test('Mini cooldown preserves last reading/time, bounds polls, isolates accounts and recovers without toggles', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(Math, 'random', () => 0.5);
  let queries = 0;
  let limited = false;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (JSON.parse(init.body).query.includes('obtainKrakenToken')) return json({ data: { obtainKrakenToken: { token: 'synthetic-token' } } });
    queries += 1;
    return limited ? json(throttle(), { 'Retry-After': new Date(Date.now() + 300000).toUTCString() })
      : json({ data: { smartMeterTelemetry: [{ demand: 700, readAt: new Date(Date.now()).toISOString() }] } });
  });
  const client = new KrakenClient(CREDS.apiKey, CREDS.accountNumber);
  client.getElectricityDeviceId = async () => 'synthetic-mini';
  const intervals = [];
  const readings = [];
  const source = new LiveDemandSource({
    getClient: () => client,
    setInterval: (fn) => {
      intervals.push(fn); return fn;
    },
    clearInterval() {},
    now: Date.now,
    onError() {},
  }, 60);
  source.subscribe(CREDS, 'synthetic-one', (r) => readings.push(r));
  source.subscribe(CREDS, 'synthetic-two', () => {});
  await source.pollAccount(CREDS.accountNumber);
  assert.equal(intervals.length, 1);
  assert.equal(queries, 1);
  limited = true;
  t.mock.timers.tick(60000);
  await Promise.all([source.pollAccount(CREDS.accountNumber), source.pollAccount(CREDS.accountNumber)]);
  assert.equal(queries, 2);
  assert.equal(source.getStatus(CREDS.accountNumber).reason, 'rate-limited');
  assert.deepEqual(source.getLiveDemand(CREDS.accountNumber), {
    value: 700, readAt: new Date(NOW).toISOString(), source: 'graphql', state: 'stale',
  });
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(60000);
    // eslint-disable-next-line no-await-in-loop
    await source.pollAccount(CREDS.accountNumber);
  }
  assert.equal(queries, 2, 'no demand requests inside provider cooldown');
  assert.equal(getBucket('A-SYNTHETIC-OTHER').acquire('live'), true);
  limited = false;
  t.mock.timers.tick(60000);
  await source.pollAccount(CREDS.accountNumber);
  assert.equal(queries, 3);
  assert.deepEqual(source.getStatus(CREDS.accountNumber), { reason: 'current', retryAt: null });
  assert.equal(source.getLiveDemand(CREDS.accountNumber).readAt, new Date(Date.now()).toISOString());
  assert.equal(getBucket(CREDS.accountNumber).snapshot().penalties, 0);
  assert.ok(readings.some((r) => r.state === 'stale'));
  source.stopAll();
});

test('repeated GraphQL throttle escalates cooldown rather than being rewarded as HTTP success', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(globalThis, 'fetch', async (_url, init) => (JSON.parse(init.body).query.includes('obtainKrakenToken')
    ? json({ data: { obtainKrakenToken: { token: 'synthetic-token' } } }) : json(throttle())));
  const client = new KrakenClient(CREDS.apiKey, CREDS.accountNumber);
  for (const delay of [30000, 60000, 120000, 240000, 480000, 900000, 900000]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(client.getDemandReading('synthetic-mini'), { status: 429 });
    assert.equal(Date.parse(getBucket(CREDS.accountNumber).retryAt) - Date.now(), delay);
    // A penalised bucket is drained; the first token also needs 40s to refill.
    t.mock.timers.tick(Math.max(delay, 40000));
  }
});

test('cached Mini status/reading getters never fetch and age retained readings without rewriting their time', async () => {
  let now = NOW;
  let reads = 0;
  const source = new LiveDemandSource({
    getClient: () => ({
      getElectricityDeviceId: async () => 'synthetic-mini',
      getDemandReading: async () => {
        reads += 1; return { demand: 0, readAt: new Date(NOW).toISOString() };
      },
    }),
    setInterval: () => 1,
    clearInterval() {},
    now: () => now,
    onError() {},
  }, 60);
  source.subscribe(CREDS, 'synthetic-one', () => {});
  await source.pollAccount(CREDS.accountNumber);
  now += 600000;
  for (let i = 0; i < 30; i++) {
    assert.equal(source.getLiveDemand(CREDS.accountNumber).state, 'stale');
    assert.equal(source.getLiveDemand(CREDS.accountNumber).readAt, new Date(NOW).toISOString());
    assert.equal(source.getStatus(CREDS.accountNumber).reason, 'stale');
  }
  assert.equal(reads, 1);
  source.stopAll();
});

test('toggling live power, cadence changes and credential invalidation cannot reset a shared cooldown', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  let discovery = 0;
  const source = new LiveDemandSource({
    getClient: () => ({
      getElectricityDeviceId: async () => {
        discovery += 1; return 'synthetic-mini';
      },
    }),
    setInterval: () => 1,
    clearInterval() {},
    now: () => Date.now(),
    onError() {},
  });
  getBucket(CREDS.accountNumber).penalise(300000);
  source.subscribe(CREDS, 'synthetic-one', () => {});
  await source.pollAccount(CREDS.accountNumber);
  source.unsubscribe(CREDS.accountNumber, 'synthetic-one');
  source.subscribe(CREDS, 'synthetic-one', () => {});
  source.setCadenceSeconds(60);
  source.invalidate(CREDS.accountNumber);
  await source.pollAccount(CREDS.accountNumber);
  assert.equal(discovery, 0);
  assert.equal(source.getLiveDemand(CREDS.accountNumber).state, 'unknown');
  assert.deepEqual(source.getStatus(CREDS.accountNumber), { reason: 'rate-limited', retryAt: new Date(NOW + 300000).toISOString() });
  source.stopAll();
});

test('Summary explains rate limiting with or without a prior sample and ignores arbitrary error text', () => {
  const script = fs.readFileSync('widgets/summary/public/index.html', 'utf8').match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({});
  vm.runInContext(script, context);
  for (const netW of [null, 0, 700]) {
    const html = context.liveHtml({
      live: {
        netW, importW: netW, state: netW === null ? 'unknown' : 'stale', readAt: new Date(NOW).toISOString(), status: { reason: 'rate-limited', retryAt: '<private>', error: '<private>' },
      },
    });
    assert.match(html, /Octopus rate-limited live power/);
    assert.match(html, /retry automatically/);
    assert.match(html, netW === null ? /No data/ : /Stale ·/);
    assert.doesNotMatch(html, /<private>|Live ·/);
  }
});
