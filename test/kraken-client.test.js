'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { KrakenClient } = require('../.homeybuild/lib/KrakenClient.js');

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Kraken Saving Sessions query normalises the live response shape', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const request = JSON.parse(init.body);
    requests.push({ url, ...request });
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({
      data: {
        savingSessions: {
          events: [{
            id: 123,
            startAt: '2026-01-01T17:00:00Z',
            endAt: '2026-01-01T18:00:00Z',
            rewardPerKwhInOctoPoints: '2400',
            eventType: 'TURN_DOWN',
            targetRegion: [{ regionId: 'A' }],
          }, {
            id: 456,
            startAt: '2026-01-02T17:00:00Z',
            endAt: '2026-01-02T18:00:00Z',
            rewardPerKwhInOctoPoints: 1800,
            eventType: 'TURN_DOWN',
            targetRegion: [{ regionId: 'B' }],
          }, {
            id: 789,
            startAt: '2026-01-03T12:00:00Z',
            endAt: '2026-01-03T13:00:00Z',
            rewardPerKwhInOctoPoints: 0,
            eventType: 'TURN_UP',
            targetRegion: [],
          }],
          account: {
            signedUpMeterPoint: { regionId: 'A' },
            joinedEvents: [{ eventId: 123 }],
          },
        },
      },
    });
  });

  const client = new KrakenClient('api-key');
  const sessions = await client.getSavingSessions('A-ONE');

  assert.deepEqual(sessions, [{
    id: '123',
    startAt: '2026-01-01T17:00:00Z',
    endAt: '2026-01-01T18:00:00Z',
    rewardPerKwh: 2400,
    joined: true,
    eventType: 'TURN_DOWN',
  }]);
  assert.equal(requests[1].url, 'https://api.backend.octopus.energy/v1/graphql/');
  assert.match(requests[1].query, /savingSessions\s*\{/);
  assert.match(requests[1].query, /account\(accountNumber: \$accountNumber\)/);
  assert.deepEqual(requests[1].variables, { accountNumber: 'A-ONE' });

  const powerUp = await client.getFreeElectricitySessions('A-ONE');
  assert.equal(powerUp.length, 1);
  assert.equal(powerUp[0].eventType, 'TURN_UP');
  assert.equal(requests.length, 2);
});

test('Kraken Saving Sessions surfaces GraphQL errors to poller diagnostics', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({ errors: [{ message: 'Cannot query field savingSessions' }] });
  });

  await assert.rejects(
    new KrakenClient('api-key').getSavingSessions('A-ONE'),
    /Cannot query field savingSessions/,
  );
});

test('Kraken Octoplus points uses the current account-number balance query', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({ data: { loyaltyPointsBalance: { loyaltyPoints: 510 } } });
  });

  const points = await new KrakenClient('api-key').getOctoplusPoints('A-ONE');

  assert.equal(points, 510);
  assert.match(requests[1].query, /loyaltyPointsBalance\(input: \{ accountNumber: \$accountNumber \}\)/);
  assert.doesNotMatch(requests[1].query, /loyaltyPointLedgers/);
});
