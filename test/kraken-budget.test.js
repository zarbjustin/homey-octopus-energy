'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TokenBucket, getBucket, resetBudget, setBudgetClock, budgetDiagnostics,
} = require('../.homeybuild/lib/KrakenBudget.js');

test.beforeEach(() => resetBudget());

test('a fresh bucket admits a burst up to capacity, then throttles non-core', () => {
  const clock = { t: 0 };
  const bucket = new TokenBucket(() => clock.t);
  let admitted = 0;
  for (let i = 0; i < 10; i += 1) if (bucket.acquire('live')) admitted += 1;
  assert.equal(admitted, 6, 'burst capacity is 6');
  assert.equal(bucket.acquire('best'), false, 'no tokens left for best-effort');
});

test('tokens refill at ~90/hour (1 per 40s)', () => {
  const clock = { t: 0 };
  const bucket = new TokenBucket(() => clock.t);
  for (let i = 0; i < 6; i += 1) bucket.acquire('live'); // drain
  assert.equal(bucket.acquire('live'), false);
  clock.t += 40_000; // 40s -> ~1 token
  assert.equal(bucket.acquire('live'), true);
  assert.equal(bucket.acquire('live'), false);
});

test('core requests are never blocked by an empty bucket', () => {
  const clock = { t: 0 };
  const bucket = new TokenBucket(() => clock.t);
  for (let i = 0; i < 6; i += 1) bucket.acquire('live'); // drain
  assert.equal(bucket.acquire('live'), false);
  assert.equal(bucket.acquire('core'), true, 'core proceeds even at zero tokens');
});

test('a 429 penalty gates the account (including core) until the backoff elapses', (t) => {
  t.mock.method(Math, 'random', () => 0); // deterministic jitter => 0.8 factor
  const clock = { t: 0 };
  const bucket = new TokenBucket(() => clock.t);
  bucket.penalise(); // base 30s * 0.8 = 24s gate
  assert.equal(bucket.gated, true);
  assert.equal(bucket.acquire('core'), false, 'gate blocks even core');
  assert.equal(bucket.acquire('live'), false);
  clock.t += 25_000;
  assert.equal(bucket.gated, false);
  assert.equal(bucket.acquire('core'), true);
});

test('an in-flight success does not lift an active 429 gate', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const clock = { t: 0 };
  const bucket = new TokenBucket(() => clock.t);
  bucket.penalise(); // 24s gate
  bucket.reward(); // an earlier in-flight request completing must not clear it
  assert.equal(bucket.gated, true, 'gate survives an in-flight success');
  clock.t += 25_000;
  assert.equal(bucket.gated, false, 'gate lifts only after the backoff elapses');
});

test('backoff escalates on repeated penalties and resets after a clean success', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const clock = { t: 0 };
  const bucket = new TokenBucket(() => clock.t);
  bucket.penalise(); // 1st: 30s * 0.8 = 24s
  clock.t += 25_000;
  bucket.penalise(); // 2nd: 60s * 0.8 = 48s
  assert.equal(bucket.gated, true);
  clock.t += 30_000;
  assert.equal(bucket.gated, true, 'still gated at 30s into a 48s window');
  clock.t += 20_000; // now past the 48s window
  assert.equal(bucket.gated, false);
  bucket.reward(); // clean success once ungated resets escalation
  bucket.penalise(); // back to 1st level (24s), not 3rd
  assert.equal(bucket.gated, true);
  clock.t += 25_000;
  assert.equal(bucket.gated, false);
});

test('core debt is bounded so it cannot starve live/best indefinitely', () => {
  const bucket = new TokenBucket(() => 0);
  for (let i = 0; i < 100; i += 1) bucket.acquire('core');
  assert.equal(bucket.snapshot().tokens, -6, 'debt is floored at -capacity');
});

test('buckets are isolated per account key', () => {
  setBudgetClock(() => 0);
  const a = getBucket('A-ONE');
  const b = getBucket('A-TWO');
  for (let i = 0; i < 6; i += 1) a.acquire('live');
  assert.equal(a.acquire('live'), false, 'account A exhausted');
  assert.equal(b.acquire('live'), true, 'account B is unaffected');
  assert.equal(getBucket('A-ONE'), a, 'same key returns the same bucket');
});

test('budgetDiagnostics reports aggregate, identifier-free state', (t) => {
  t.mock.method(Math, 'random', () => 0);
  setBudgetClock(() => 0);
  getBucket('A-ONE');
  getBucket('A-TWO').penalise();
  const diag = budgetDiagnostics();
  assert.equal(diag.accounts, 2);
  assert.equal(diag.gated, 1);
  assert.equal(typeof diag.minTokens, 'number');
  assert.equal(JSON.stringify(diag).includes('A-ONE'), false, 'no account identifiers leak');
});
