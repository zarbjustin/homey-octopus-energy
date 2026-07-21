'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets, maskAccount } = require('../.homeybuild/lib/redact.js');

test('redactSecrets replaces every provided secret, collapses whitespace, caps length', () => {
  const msg = redactSecrets(new Error('failed for sk_live_abc using A-1234\n\nretry'), ['sk_live_abc', 'A-1234']);
  assert.equal(msg, 'failed for [redacted] using [redacted] retry');
  assert.doesNotMatch(msg, /sk_live_abc|A-1234/);
  // undefined/empty secrets are ignored; non-Error input is stringified.
  assert.equal(redactSecrets('plain', [undefined, '']), 'plain');
  assert.ok(redactSecrets(new Error('x'.repeat(500)), []).length === 240);
});

test('maskAccount never exposes the full number and is safe for short/empty input', () => {
  assert.equal(maskAccount('A-1234ABCD'), 'A-***CD');
  assert.equal(maskAccount(''), 'account');
  assert.equal(maskAccount('AB'), 'account');
});
