'use strict';

// BL-30: the Kraken token refresh schedules from the JWT `exp` claim (minus a
// safety skew) rather than a fixed 1h guess. These tests drive getToken() with
// mocked token responses and assert the refetch behaviour follows the claim.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resetBudget } = require('../.homeybuild/lib/KrakenBudget.js');
const { KrakenClient } = require('../.homeybuild/lib/KrakenClient.js');

test.beforeEach(() => resetBudget());

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeJwt(expSeconds) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ exp: expSeconds })}.sig`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function mockToken(t, tokenFactory) {
  const counter = { fetches: 0 };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      counter.fetches += 1;
      return jsonResponse({ data: { obtainKrakenToken: { token: tokenFactory() } } });
    }
    return jsonResponse({ data: {} });
  });
  return counter;
}

test('a short-lived JWT is still briefly cached — proportional skew prevents refresh thrashing', async (t) => {
  const counter = mockToken(t, () => makeJwt(nowSeconds() + 60)); // 60s ahead
  const client = new KrakenClient('api-key');
  await client.getToken();
  await client.getToken();
  // Cached for ~half its remaining life (proportional skew), so no re-fetch.
  assert.equal(counter.fetches, 1);
});

test('a long-lived JWT is cached across calls (exp is far in the future)', async (t) => {
  const counter = mockToken(t, () => makeJwt(nowSeconds() + 3600)); // 1h ahead
  const client = new KrakenClient('api-key');
  await client.getToken();
  await client.getToken();
  assert.equal(counter.fetches, 1);
});

test('an opaque (non-JWT) token falls back to the ~1h heuristic and is cached', async (t) => {
  const counter = mockToken(t, () => 'opaque-token');
  const client = new KrakenClient('api-key');
  await client.getToken();
  await client.getToken();
  assert.equal(counter.fetches, 1);
});
