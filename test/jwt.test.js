'use strict';

// Unit tests for the pure JWT expiry reader (BL-30 API-client hardening). The
// Kraken token refresh schedules from the token's own `exp` claim instead of a
// fixed 1h guess; this reader must be robust to malformed/opaque tokens.

const test = require('node:test');
const assert = require('node:assert/strict');

const { jwtExpiryMs } = require('../.homeybuild/lib/jwt.js');

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeJwt(payload) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`;
}

test('jwtExpiryMs returns the exp claim in milliseconds', () => {
  const expSeconds = 1_800_000_000;
  assert.equal(jwtExpiryMs(makeJwt({ exp: expSeconds })), expSeconds * 1000);
});

test('jwtExpiryMs returns null for a token without three segments', () => {
  assert.equal(jwtExpiryMs('opaque-token'), null);
  assert.equal(jwtExpiryMs('two.parts'), null);
  assert.equal(jwtExpiryMs(''), null);
});

test('jwtExpiryMs returns null when the payload has no numeric exp', () => {
  assert.equal(jwtExpiryMs(makeJwt({ sub: 'user' })), null); // no exp
  assert.equal(jwtExpiryMs(makeJwt({ exp: 'soon' })), null); // non-numeric
  assert.equal(jwtExpiryMs(makeJwt({ exp: 0 })), null); // non-positive
  assert.equal(jwtExpiryMs(makeJwt({ exp: -5 })), null);
});

test('jwtExpiryMs returns null for undecodable base64 / non-JSON payloads', () => {
  assert.equal(jwtExpiryMs('a.!!!not-base64-json!!!.c'), null);
  assert.equal(jwtExpiryMs(`a.${Buffer.from('not json').toString('base64url')}.c`), null);
});
