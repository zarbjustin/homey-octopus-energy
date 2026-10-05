'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OctopusClient } = require('../.homeybuild/lib/OctopusClient.js');
const { KrakenClient } = require('../.homeybuild/lib/KrakenClient.js');
const { CarbonClient } = require('../.homeybuild/lib/carbon.js');
const { resetBudget, setBudgetClock, getBucket } = require('../.homeybuild/lib/KrakenBudget.js');

test.beforeEach(() => resetBudget());

test('Kraken forwards the provider Retry-After to the shared account gate without an inline retry', async (t) => {
  const clock = { now: Date.now() };
  setBudgetClock(() => clock.now);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return { ok: false, status: 429, headers: { get: () => '120' } };
  });
  const client = new KrakenClient('synthetic-key', 'synthetic-account');
  await assert.rejects(client.post({}, 'query {}', {}, undefined, 'core'), (err) => err.status === 429 && err.retryAfterMs === 120_000);
  clock.now += 60_000;
  assert.equal(getBucket(client.accountKey).acquire('core'), false);
  assert.equal(calls, 1);
});

test('REST timeout includes a stalled response body and releases the coalescing lock', async () => {
  let calls = 0;
  let signal;
  const client = new OctopusClient({
    apiKey: 'synthetic-key',
    timeoutMs: 5,
    maxRetries: 1,
    fetchImpl: async (_url, init) => {
      calls += 1;
      signal = init.signal;
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    },
  });
  const request = client.get('/synthetic/');
  let guard;
  try {
    await assert.rejects(Promise.race([
      request,
      new Promise((_resolve, reject) => {
        guard = setTimeout(() => reject(new Error('Body was not bounded')), 100);
      }),
    ]), /could not be completed/);
    assert.equal(signal.aborted, true);
    assert.equal(client.getInflight.size, 0);
    assert.equal(client.getCache.size, 0);
    assert.equal(calls, 1);
  } finally {
    clearTimeout(guard);
  }
});

test('Kraken rejects redirects and never includes an upstream HTTP body in errors', async (t) => {
  for (const status of [302, 307, 400]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      calls += 1;
      assert.equal(init.redirect, 'manual');
      return {
        ok: false,
        status,
        text: async () => {
          throw new Error('Private response body must not be consumed');
        },
      };
    });
    await assert.rejects(new KrakenClient('synthetic-key').post({}, 'query {}', {}, undefined, 'core'), (err) => {
      assert.equal(err.status, status);
      assert.doesNotMatch(err.message, /Private response/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('Kraken missing balances fail closed; real zero and negative balances remain valid', async () => {
  for (const balance of [null, undefined, '', false, '10', NaN, Infinity]) {
    const client = new KrakenClient('synthetic-key');
    client.query = async () => ({ account: { balance } });
    await assert.rejects(client.getBalance('synthetic-account'), /balance is unavailable/);
  }
  for (const [balance, expected] of [[0, 0], [-123, -1.23], [250, 2.5]]) {
    const client = new KrakenClient('synthetic-key');
    client.query = async () => ({ account: { balance } });
    assert.equal(await client.getBalance('synthetic-account'), expected);
  }
});

test('Kraken and carbon also bound stalled JSON bodies without caching success', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => realSetTimeout(fn, ms >= 500 ? 5 : ms, ...args));
  let calls = 0;
  const signals = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls += 1;
    signals.push(init.signal);
    return { ok: true, status: 200, json: () => new Promise(() => {}) };
  });
  for (const operation of [
    () => new KrakenClient('synthetic-key').post({}, 'query {}', {}, undefined, 'core'),
    () => new CarbonClient().getCurrent(),
  ]) {
    let guard;
    try {
      await assert.rejects(Promise.race([
        operation(),
        new Promise((_resolve, reject) => {
          guard = realSetTimeout(() => reject(new Error('Body was not bounded')), 100);
        }),
      ]), /timed out|network request failed/);
    } finally {
      clearTimeout(guard);
    }
  }
  assert.equal(calls, 6, 'bounded three attempts per provider, no extra acquisition');
  assert.ok(signals.every((signal) => signal.aborted));
});
