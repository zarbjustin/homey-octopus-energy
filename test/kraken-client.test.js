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
    resolvedVia: 'exact',
    tariffCode: 'E-1R-IOG-SYNTHETIC-26-01-01-C',
    productCode: 'IOG-SYNTHETIC-26-01-01',
    validTo: null,
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
    resolvedVia: 'exact',
    tariffCode: 'E-1R-IOG-FOUR-SYNTHETIC-26-01-01-C',
    productCode: 'IOG-FOUR-SYNTHETIC-26-01-01',
    validTo: null,
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

test('active IOG tariff recovers via fallback when the stored code is stale (the fix)', async (t) => {
  const response = fixture('active-day-night-tariff');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  // The stored code is stale (the very reason REST returns no rows), but the
  // account has one active DayNight IOG agreement — it must resolve via fallback.
  const diags = [];
  const tariff = await new KrakenClient('api-key').getActiveIogTariff(
    'A-ONE',
    'E-1R-IOG-DIFFERENT-26-01-01-C',
    'IOG-SYNTHETIC-26-01-01',
    (d) => diags.push(d),
  );

  assert.ok(tariff, 'a stale stored code still resolves the household schedule');
  assert.equal(tariff.resolvedVia, 'fallback');
  assert.equal(tariff.tariffCode, 'E-1R-IOG-SYNTHETIC-26-01-01-C'); // the real code
  assert.equal(tariff.dayRate, 31.5);
  assert.deepEqual(diags[0], {
    activeAgreementCount: 1, dayNightCount: 1, fourRateCount: 0,
    exactMatchFound: false, fallbackUsed: true,
  });
});

test('active IOG tariff never selects an export/outgoing agreement', async (t) => {
  const response = {
    data: {
      account: {
        electricityAgreements: [
          {
            validFrom: '2026-01-01T00:00:00Z',
            validTo: null,
            tariff: {
              __typename: 'DayNightTariff',
              tariffCode: 'E-1R-OUTGOING-FIX-26-01-01-C',
              productCode: 'OUTGOING-FIX-26-01-01',
              displayName: 'Outgoing Export',
              dayRate: 15, nightRate: 15, preVatDayRate: 14, preVatNightRate: 14,
              standingCharge: 0,
            },
          },
          {
            validFrom: '2026-01-01T00:00:00Z',
            validTo: null,
            tariff: {
              __typename: 'DayNightTariff',
              tariffCode: 'E-1R-IOG-SYNTHETIC-26-01-01-C',
              productCode: 'IOG-SYNTHETIC-26-01-01',
              displayName: 'Import IOG',
              dayRate: 31.5, nightRate: 8, preVatDayRate: 30, preVatNightRate: 7.619,
              standingCharge: 49.2,
            },
          },
        ],
      },
    },
  };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  const tariff = await new KrakenClient('api-key').getActiveIogTariff(
    'A-ONE', 'E-1R-IOG-STALE-26-01-01-C', 'IOG-STALE-26-01-01',
  );
  assert.ok(tariff);
  assert.equal(tariff.tariffCode, 'E-1R-IOG-SYNTHETIC-26-01-01-C'); // the import one, never the export
});

test('active IOG tariff fails closed when there is no active agreement', async (t) => {
  const response = { data: { account: { electricityAgreements: [] } } };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse(response);
  });

  assert.equal(await new KrakenClient('api-key').getActiveIogTariff(
    'A-ONE', 'E-1R-IOG-ANY-26-01-01-C', 'IOG-ANY-26-01-01',
  ), null);
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

test('getDevices normalises the smart-flex device list', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({
      data: {
        devices: [
          { __typename: 'SmartFlexChargePoint', id: 'synthetic-cp', deviceType: 'CHARGE_POINTS', status: { currentState: 'SMART_CONTROL_IN_PROGRESS' } },
          { __typename: 'SmartFlexBattery', deviceType: 'BATTERIES' },
        ],
      },
    });
  });

  const devices = await new KrakenClient('api-key', 'A-ONE').getDevices('A-ONE');
  assert.equal(devices.length, 1, 'a device with no id is dropped');
  assert.equal(devices[0].category, 'CHARGE_POINT');
  assert.equal(devices[0].participating, true);
});

test('getFlexPlannedDispatches parses SMART/BOOST and drops malformed rows', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({
      data: {
        flexPlannedDispatches: [
          { start: '2026-01-01T14:00:00Z', end: '2026-01-01T14:30:00Z', type: 'SMART' },
          { start: '2026-01-01T15:00:00Z', end: '2026-01-01T15:30:00Z', type: 'BOOST' },
          { start: null, end: '2026-01-01T16:00:00Z', type: 'SMART' },
        ],
      },
    });
  });

  const planned = await new KrakenClient('api-key', 'A-ONE').getFlexPlannedDispatches('synthetic-cp');
  assert.equal(planned.length, 2);
  assert.deepEqual(planned.map((p) => p.kind), ['SMART', 'BOOST']);
  assert.equal(planned[0].deviceId, 'synthetic-cp');
});

test('getCompletedDispatchWindows parses the optional kWh delta', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({
      data: {
        completedDispatches: [
          { start: '2026-01-01T10:00:00Z', end: '2026-01-01T10:30:00Z', delta: '3.2' },
          { start: '2026-01-01T11:00:00Z', end: '2026-01-01T11:30:00Z' },
        ],
      },
    });
  });

  const windows = await new KrakenClient('api-key', 'A-ONE').getCompletedDispatchWindows('A-ONE');
  assert.equal(windows.length, 2);
  assert.equal(windows[0].delta, 3.2);
  assert.equal(windows[1].delta, null);
});

test('active IOG tariff excludes a co-existing non-IOG (Economy 7) DayNight agreement', async (t) => {
  const response = { data: { account: { electricityAgreements: [
    { validFrom: '2026-01-01T00:00:00Z', validTo: null, tariff: {
      __typename: 'DayNightTariff', tariffCode: 'E-1R-E7-FIX-26-01-01-C', productCode: 'E-7-FIX-26-01-01',
      displayName: 'Economy 7', dayRate: 40, nightRate: 20, preVatDayRate: 38, preVatNightRate: 19, standingCharge: 50 } },
    { validFrom: '2026-01-01T00:00:00Z', validTo: null, tariff: {
      __typename: 'DayNightTariff', tariffCode: 'E-1R-IOG-SYNTHETIC-26-01-01-C', productCode: 'IOG-SYNTHETIC-26-01-01',
      displayName: 'IOG', dayRate: 31.5, nightRate: 8, preVatDayRate: 30, preVatNightRate: 7.619, standingCharge: 49.2 } },
  ] } } };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    return jsonResponse(response);
  });

  const tariff = await new KrakenClient('api-key').getActiveIogTariff('A-ONE', 'E-1R-IOG-STALE-26-01-01-C', 'IOG-STALE-26-01-01');
  assert.ok(tariff);
  assert.equal(tariff.tariffCode, 'E-1R-IOG-SYNTHETIC-26-01-01-C', 'the IOG agreement, never the Economy 7 one');
});

test('active IOG tariff fails closed when two distinct IOG agreements are ambiguous', async (t) => {
  const response = { data: { account: { electricityAgreements: [
    { validFrom: '2026-02-01T00:00:00Z', validTo: null, tariff: {
      __typename: 'DayNightTariff', tariffCode: 'E-1R-IOG-A-26-01-01-C', productCode: 'IOG-A-26-01-01',
      displayName: 'IOG A', dayRate: 31, nightRate: 8, preVatDayRate: 30, preVatNightRate: 7, standingCharge: 49 } },
    { validFrom: '2026-01-01T00:00:00Z', validTo: null, tariff: {
      __typename: 'DayNightTariff', tariffCode: 'E-1R-IOG-B-26-01-01-C', productCode: 'IOG-B-26-01-01',
      displayName: 'IOG B', dayRate: 32, nightRate: 9, preVatDayRate: 31, preVatNightRate: 8, standingCharge: 49 } },
  ] } } };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    return jsonResponse(response);
  });

  const tariff = await new KrakenClient('api-key').getActiveIogTariff('A-ONE', 'E-1R-IOG-STALE-26-01-01-C', 'IOG-STALE-26-01-01');
  assert.equal(tariff, null, 'two distinct IOG agreements are ambiguous → fail closed, never guess');
});

test('active IOG tariff fails closed for a malformed EXACT agreement (no fallback substitution)', async (t) => {
  const response = { data: { account: { electricityAgreements: [
    { validFrom: '2026-01-01T00:00:00Z', validTo: null, tariff: {
      __typename: 'DayNightTariff', tariffCode: 'E-1R-IOG-EXACT-26-01-01-C', productCode: 'IOG-EXACT-26-01-01',
      displayName: 'IOG exact (broken)', dayRate: null, nightRate: 8, preVatDayRate: 30, preVatNightRate: 7, standingCharge: 49 } },
    { validFrom: '2026-01-01T00:00:00Z', validTo: null, tariff: {
      __typename: 'DayNightTariff', tariffCode: 'E-1R-IOG-OTHER-26-01-01-C', productCode: 'IOG-OTHER-26-01-01',
      displayName: 'IOG other', dayRate: 31, nightRate: 8, preVatDayRate: 30, preVatNightRate: 7, standingCharge: 49 } },
  ] } } };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    return jsonResponse(response);
  });

  // The stored code matches an agreement exactly, but that agreement is malformed
  // (null dayRate). We must NOT mask it with a different agreement's rates.
  const tariff = await new KrakenClient('api-key').getActiveIogTariff('A-ONE', 'E-1R-IOG-EXACT-26-01-01-C', 'IOG-EXACT-26-01-01');
  assert.equal(tariff, null);
});

test('Octoplus event cache dedupes within a cycle, refetches after its TTL, and never caches a rejection', async (t) => {
  let octoplusFetches = 0;
  let failNext = false;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    octoplusFetches += 1;
    if (failNext) return jsonResponse({ errors: [{ message: 'temporary octoplus error' }] });
    return jsonResponse({
      data: {
        savingSessions: {
          events: [],
          account: { signedUpMeterPoint: { regionId: 'A' }, joinedEvents: [] },
        },
      },
    });
  });

  const client = new KrakenClient('api-key');

  // Within one cycle, the two Octoplus getters share a SINGLE network fetch.
  await client.getSavingSessions('A-ONE');
  await client.getFreeElectricitySessions('A-ONE');
  assert.equal(octoplusFetches, 1, 'within a cycle both getters share ONE octoplus fetch');

  // Once past the 10-minute TTL, a new poll refetches (no permanent freeze).
  client.octoplusSessions.ts = Date.now() - 11 * 60_000;
  await client.getSavingSessions('A-ONE');
  assert.equal(octoplusFetches, 2, 'a stale cache refetches after the TTL');

  // A rejected fetch must never be cached (else the poller freezes on the error).
  client.octoplusSessions.ts = Date.now() - 11 * 60_000;
  failNext = true;
  await assert.rejects(client.getSavingSessions('A-ONE'), /temporary octoplus error/);
  assert.equal(octoplusFetches, 3);
  failNext = false;
  await client.getSavingSessions('A-ONE');
  assert.equal(octoplusFetches, 4, 'the rejected fetch was not cached; the retry hits the network again');
});

test('concurrent token consumers share a single obtainKrakenToken request (S51 single-flight)', async (t) => {
  let tokenRequests = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      tokenRequests += 1;
      // Defer so both callers are waiting on the same in-flight token.
      await new Promise((r) => setTimeout(r, 5));
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({ data: { account: { balance: 100 } } });
  });

  const client = new KrakenClient('api-key', 'A-ONE');
  // Two authenticated calls started together must not each fetch a token.
  await Promise.all([client.getBalance('A-ONE'), client.getBalance('A-ONE')]);
  assert.equal(tokenRequests, 1, 'both concurrent callers shared one token request');

  // A later call reuses the cached token (no new token request).
  await client.getBalance('A-ONE');
  assert.equal(tokenRequests, 1, 'the cached token is reused');
});

test('a failed token fetch is not memoised and the next attempt retries (S51 single-flight)', async (t) => {
  let tokenRequests = 0;
  let failToken = true;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes('obtainKrakenToken')) {
      tokenRequests += 1;
      if (failToken) return jsonResponse({ errors: [{ message: 'bad key' }] });
      return jsonResponse({ data: { obtainKrakenToken: { token: 'jwt-token' } } });
    }
    return jsonResponse({ data: { account: { balance: 100 } } });
  });

  const client = new KrakenClient('api-key', 'A-ONE');
  await assert.rejects(client.getBalance('A-ONE'), /bad key/);
  failToken = false;
  await client.getBalance('A-ONE');
  assert.equal(tokenRequests, 2, 'the rejected token was not cached; the retry fetched again');
});
