'use strict';

// BL-30: the Kraken client pins authenticated GraphQL requests to the exact
// configured origins, so a stray/injected URL can never receive the bearer
// token. assertAllowedOrigin is private in TS but reachable in the compiled JS.

const test = require('node:test');
const assert = require('node:assert/strict');
const { KrakenClient } = require('../.homeybuild/lib/KrakenClient.js');

test('a default client allows only the production Kraken origins', () => {
  const client = new KrakenClient('api-key');
  assert.doesNotThrow(() => client.assertAllowedOrigin('https://api.octopus.energy/v1/graphql/'));
  assert.doesNotThrow(() => client.assertAllowedOrigin('https://api.backend.octopus.energy/v1/graphql/'));
  assert.throws(() => client.assertAllowedOrigin('https://evil.example.com/graphql'), /unexpected origin/);
  assert.throws(() => client.assertAllowedOrigin('http://api.octopus.energy/v1/graphql/'), /unexpected origin/); // scheme matters
});

test('a malformed request URL is refused', () => {
  const client = new KrakenClient('api-key');
  assert.throws(() => client.assertAllowedOrigin('not-a-url'), /malformed URL/);
  assert.throws(() => client.assertAllowedOrigin(''), /malformed URL/);
});

test('a client configured with custom endpoints allows exactly those origins', () => {
  const client = new KrakenClient(
    'api-key', 'A-ONE',
    'https://staging.example.com/graphql/',
    'https://backend.staging.example.com/graphql/',
  );
  assert.doesNotThrow(() => client.assertAllowedOrigin('https://staging.example.com/anything'));
  assert.doesNotThrow(() => client.assertAllowedOrigin('https://backend.staging.example.com/x'));
  assert.throws(() => client.assertAllowedOrigin('https://api.octopus.energy/v1/graphql/'), /unexpected origin/);
});
