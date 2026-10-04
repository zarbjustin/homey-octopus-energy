'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BackgroundRecovery } = require('../.homeybuild/lib/BackgroundRecovery');
const { OctopusApiError } = require('../.homeybuild/lib/OctopusClient');
const { BudgetError } = require('../.homeybuild/lib/KrakenBudget');

test('background cooldown progresses 5/10/20/30 minutes and resets on success', () => {
  const r = new BackgroundRecovery();
  let now = 1000;
  for (const minutes of [5, 10, 20, 30, 30]) {
    r.failure('prices', new OctopusApiError(0, 'Network failure'), now);
    const retryAt = now + minutes * 60_000;
    assert.equal(r.state('prices').retryAt, retryAt);
    assert.equal(r.allowed('prices', retryAt - 1), false);
    assert.equal(r.allowed('prices', retryAt), true);
    assert.equal(r.allowed('balance', now), true, 'failure is feature scoped');
    now = retryAt;
  }
  r.success('prices');
  r.failure('prices', new OctopusApiError(503, 'Down'), now);
  assert.equal(r.state('prices').retryAt - now, 5 * 60_000);
});

test('Retry-After can exceed cap; restart retains cooldown; credentials get fresh recovery', () => {
  const r = new BackgroundRecovery();
  r.failure('prices', new OctopusApiError(429, 'Limited', 3600_000), 1000);
  const restored = new BackgroundRecovery(JSON.parse(JSON.stringify(r.snapshot())));
  assert.equal(restored.allowed('prices', 1800_000), false);
  assert.equal(restored.allowed('prices', 3601_000), true);
  assert.equal(new BackgroundRecovery().allowed('prices', 1000), true);
});

test('auth blocks until credential reset; budget skip does not replace account-wide 429 gate', () => {
  for (const status of [401, 403]) {
    const r = new BackgroundRecovery();
    r.failure('balance', new OctopusApiError(status, 'Auth'), 1000);
    assert.equal(new BackgroundRecovery(r.snapshot()).allowed('balance', 1e12), false);
    assert.equal(r.state('balance').status, status);
  }
  const r = new BackgroundRecovery();
  r.failure('prices', new BudgetError(), 1000);
  assert.deepEqual(r.snapshot(), {});
  r.failure('prices', new Error('Malformed shape'), 1000);
  assert.deepEqual(r.snapshot(), {}, 'schema failures are not silently treated as transient/auth');
});

test('malformed persisted recovery is ignored and cannot block all acquisition', () => {
  const r = new BackgroundRecovery({ prices: { retryAt: 'forever', authBlocked: true } });
  assert.equal(r.allowed('prices'), true);
});
