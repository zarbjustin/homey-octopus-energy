'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resetBudget } = require('../.homeybuild/lib/KrakenBudget.js');

// The Kraken request budget is a module-global registry; isolate each test.
test.beforeEach(() => resetBudget());

const { KrakenClient } = require('../.homeybuild/lib/KrakenClient.js');

function fixture(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'kraken', `${name}.json`),
    'utf8',
  ));
}

test('Kraken fixtures are synthetic and contain no credential-shaped data', () => {
  const directory = path.join(__dirname, 'fixtures', 'kraken');
  for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.json'))) {
    const text = fs.readFileSync(path.join(directory, name), 'utf8');
    assert.doesNotMatch(text, /sk_live|Bearer\s|Authorization|API[-_ ]?key/i, name);
    assert.doesNotMatch(text, /"accountNumber"|"mpan"|"mprn"|"serialNumber"/i, name);
    for (const match of text.matchAll(/"(?:deviceId|integrationDeviceId|id)"\s*:\s*"([^"]+)"/g)) {
      assert.match(match[1], /^synthetic-/, `${name}: identifier must be visibly synthetic`);
    }
  }
});

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

test('active IOG tariff uses the matching day/night account agreement', async (t) => {
  const requests = [];
  const response = fixture('active-day-night-tariff');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  const tariff = await new KrakenClient('api-key').getActiveIogTariff(
    'A-ONE',
    'E-1R-IOG-SYNTHETIC-26-01-01-C',
    'IOG-SYNTHETIC-26-01-01',
  );

  assert.deepEqual(tariff, {
    tariffType: 'DayNightTariff',
    tariffCode: 'E-1R-IOG-SYNTHETIC-26-01-01-C',
    productCode: 'IOG-SYNTHETIC-26-01-01',
    displayName: 'Synthetic Intelligent Go',
    dayRate: 31.5,
    nightRate: 8,
    preVatDayRate: 30,
    preVatNightRate: 7.619,
    evDevicePeakRate: null,
    evDeviceOffPeakRate: null,
    preVatEvDevicePeakRate: null,
    preVatEvDeviceOffPeakRate: null,
    standingCharge: 49.2,
  });
  assert.match(requests[1].query, /electricityAgreements\(active: true\)/);
  assert.match(requests[1].query, /\.\.\. on DayNightTariff/);
  assert.match(requests[1].query, /\.\.\. on FourRateEvTariff/);
});

test('active IOG tariff accepts the matching four-rate EV agreement', async (t) => {
  const response = fixture('active-four-rate-ev-tariff');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  const tariff = await new KrakenClient('api-key').getActiveIogTariff(
    'A-ONE',
    'E-1R-IOG-FOUR-SYNTHETIC-26-01-01-C',
    'IOG-FOUR-SYNTHETIC-26-01-01',
  );

  assert.deepEqual(tariff, {
    tariffType: 'FourRateEvTariff',
    tariffCode: 'E-1R-IOG-FOUR-SYNTHETIC-26-01-01-C',
    productCode: 'IOG-FOUR-SYNTHETIC-26-01-01',
    displayName: 'Synthetic Four Rate Intelligent Go',
    dayRate: 31.5,
    nightRate: 8,
    evDevicePeakRate: 31.5,
    evDeviceOffPeakRate: 8,
    preVatDayRate: 30,
    preVatNightRate: 7.619,
    preVatEvDevicePeakRate: 30,
    preVatEvDeviceOffPeakRate: 7.619,
    standingCharge: 49.2,
  });
});

test('active IOG tariff fails closed for a different agreement', async (t) => {
  const response = fixture('active-day-night-tariff');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  const tariff = await new KrakenClient('api-key').getActiveIogTariff(
    'A-ONE',
    'E-1R-IOG-DIFFERENT-26-01-01-C',
    'IOG-SYNTHETIC-26-01-01',
  );

  assert.equal(tariff, null);
});

test('active IOG tariff fails closed for a product mismatch or null rate', async (t) => {
  const response = fixture('active-four-rate-ev-tariff');
  response.data.account.electricityAgreements[0].tariff.evDeviceOffPeakRate = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  const client = new KrakenClient('api-key');
  assert.equal(await client.getActiveIogTariff(
    'A-ONE',
    'E-1R-IOG-FOUR-SYNTHETIC-26-01-01-C',
    'IOG-OTHER-SYNTHETIC-26-01-01',
  ), null);
  assert.equal(await client.getActiveIogTariff(
    'A-ONE',
    'E-1R-IOG-FOUR-SYNTHETIC-26-01-01-C',
    'IOG-FOUR-SYNTHETIC-26-01-01',
  ), null);
});

test('active IOG tariff rejects an agreement that is not yet valid', async (t) => {
  const response = fixture('active-day-night-tariff');
  response.data.account.electricityAgreements[0].validFrom = '2099-01-01T00:00:00Z';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  assert.equal(await new KrakenClient('api-key').getActiveIogTariff(
    'A-ONE',
    'E-1R-IOG-SYNTHETIC-26-01-01-C',
    'IOG-SYNTHETIC-26-01-01',
  ), null);
});

test('Home Mini discovery and telemetry use sanitized contract fixtures', async (t) => {
  const discovery = fixture('home-mini-discovery');
  const telemetry = fixture('home-mini-telemetry');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    if (request.query.includes('SmartDevices')) return jsonResponse(discovery);
    return jsonResponse(telemetry);
  });
  const client = new KrakenClient('api-key');

  const deviceId = await client.getElectricityDeviceId('A-ONE');
  const demand = await client.getDemand(deviceId);

  assert.equal(deviceId, 'synthetic-mini-device');
  assert.equal(demand, -215);
});

test('account dispatch contracts normalize rows and discard incomplete periods', async (t) => {
  const response = fixture('dispatches');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });
  const client = new KrakenClient('api-key');

  assert.deepEqual(await client.getPlannedDispatches('A-ONE'), [{
    start: '2026-01-01T23:00:00Z',
    end: '2026-01-02T00:00:00Z',
  }]);
  assert.deepEqual(await client.getCompletedDispatches('A-ONE'), [{
    start: '2026-01-01T10:00:00Z',
    end: '2026-01-01T10:30:00Z',
  }]);
});

test('Octoplus points returns null (unsupported) when Kraken answers Unauthorized', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    calls += 1;
    return jsonResponse({ errors: [{ message: 'Unauthorized.' }] });
  });

  const points = await new KrakenClient('api-key').getOctoplusPoints('A-ONE');

  assert.equal(points, null);
  // A field-level authorisation rejection must not trigger a token-refresh retry.
  assert.equal(calls, 1);
});

test('Octoplus points re-throws genuinely transient failures instead of hiding them', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return new Response('upstream down', { status: 503 });
  });

  await assert.rejects(
    new KrakenClient('api-key').getOctoplusPoints('A-ONE'),
    /Transient Kraken error 503/,
  );
});

test('isUnsupportedFieldError classifies authorisation vs transient errors', () => {
  assert.equal(KrakenClient.isUnsupportedFieldError(new Error('Unauthorized.')), true);
  assert.equal(KrakenClient.isUnsupportedFieldError(new Error('Forbidden')), true);
  assert.equal(KrakenClient.isUnsupportedFieldError(new Error('Account is not enrolled')), true);
  assert.equal(KrakenClient.isUnsupportedFieldError(new Error('Transient Kraken error 500')), false);
  assert.equal(KrakenClient.isUnsupportedFieldError(new Error('fetch failed')), false);
});

test('a 429 opens the account backoff gate without hammering (no inline retry)', async (t) => {
  let balanceFetches = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    balanceFetches += 1;
    return new Response('rate limited', { status: 429 });
  });

  await assert.rejects(new KrakenClient('api-key', 'A-ONE').getBalance('A-ONE'), /429/);
  assert.equal(balanceFetches, 1, 'the 429 request is not retried inline');
});

test('an exhausted budget skips a best-effort call instead of fetching', async (t) => {
  const { getBucket } = require('../.homeybuild/lib/KrakenBudget.js');
  const bucket = getBucket('A-ONE');
  for (let i = 0; i < 6; i += 1) bucket.acquire('live'); // drain the burst
  let pointsFetches = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    pointsFetches += 1;
    return jsonResponse({ data: { loyaltyPointsBalance: { loyaltyPoints: 5 } } });
  });

  await assert.rejects(new KrakenClient('api-key', 'A-ONE').getOctoplusPoints('A-ONE'), /budget/i);
  assert.equal(pointsFetches, 0, 'the best-effort query never reaches the network');
});
