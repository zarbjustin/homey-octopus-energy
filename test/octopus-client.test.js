'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { OctopusClient } = require('../.homeybuild/lib/OctopusClient.js');

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const ACCOUNT = {
  number: 'A-ABCD1234',
  properties: [
    {
      electricity_meter_points: [
        {
          mpan: '1111111111111',
          is_export: false,
          meters: [{ serial_number: 'E-IMPORT-1' }],
          agreements: [{ tariff_code: 'E-1R-AGILE-FLEX-22-11-25-C', valid_from: '2023-01-01T00:00:00Z', valid_to: null }],
        },
        {
          mpan: '2222222222222',
          is_export: true,
          meters: [{ serial_number: 'E-EXPORT-1' }],
          agreements: [{ tariff_code: 'E-1R-OUTGOING-FIX-12M-19-05-13-C', valid_from: '2023-01-01T00:00:00Z', valid_to: null }],
        },
      ],
      gas_meter_points: [
        {
          mprn: '9999999999',
          meters: [{ serial_number: 'G-1' }],
          agreements: [{ tariff_code: 'G-1R-VAR-22-11-01-C', valid_from: '2023-01-01T00:00:00Z', valid_to: null }],
        },
      ],
    },
  ],
};

test('client sends HTTP Basic auth with the API key as username', async () => {
  let seen;
  const client = new OctopusClient({
    apiKey: 'sk_test_123',
    fetchImpl: async (url, opts) => {
      seen = opts.headers.Authorization;
      return jsonResponse(ACCOUNT);
    },
  });
  await client.getAccount('A-ABCD1234');
  const expected = `Basic ${Buffer.from('sk_test_123:').toString('base64')}`;
  assert.strictEqual(seen, expected);
});

test('discoverMeters flattens import, export and gas meters with product codes', async () => {
  const client = new OctopusClient({
    apiKey: 'sk_test',
    fetchImpl: async () => jsonResponse(ACCOUNT),
  });
  const meters = await client.discoverMeters('A-ABCD1234');
  assert.strictEqual(meters.length, 3);

  const imp = meters.find((m) => m.fuel === 'electricity' && !m.isExport);
  assert.strictEqual(imp.mpxn, '1111111111111');
  assert.strictEqual(imp.productCode, 'AGILE-FLEX-22-11-25');

  const exp = meters.find((m) => m.fuel === 'electricity' && m.isExport);
  assert.strictEqual(exp.serial, 'E-EXPORT-1');
  assert.strictEqual(exp.productCode, 'OUTGOING-FIX-12M-19-05-13');

  const gas = meters.find((m) => m.fuel === 'gas');
  assert.strictEqual(gas.mpxn, '9999999999');
  assert.strictEqual(gas.productCode, 'VAR-22-11-01');
});

test('getAll follows pagination via the next link', async () => {
  const page1 = { count: 2, next: 'https://api.octopus.energy/v1/x/?page=2', previous: null, results: [{ a: 1 }] };
  const page2 = { count: 2, next: null, previous: null, results: [{ a: 2 }] };
  let call = 0;
  const client = new OctopusClient({
    apiKey: 'sk_test',
    fetchImpl: async () => {
      call += 1;
      return jsonResponse(call === 1 ? page1 : page2);
    },
  });
  const all = await client.getAll('/x/');
  assert.deepStrictEqual(all, [{ a: 1 }, { a: 2 }]);
});


test('rejects cross-origin pagination before sending credentials', async () => {
  let calls = 0;
  const client = new OctopusClient({
    apiKey: 'sk_test',
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        count: 2,
        next: 'https://attacker.example/collect',
        previous: null,
        results: [{ a: 1 }],
      });
    },
  });

  await assert.rejects(
    () => client.getAll('/x/'),
    /unexpected Octopus API origin/,
  );
  assert.strictEqual(calls, 1);
});

test('does not follow HTTP redirects', async () => {
  const client = new OctopusClient({
    apiKey: 'sk_test',
    fetchImpl: async () => ({
      ok: false,
      status: 302,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }),
  });

  await assert.rejects(
    () => client.getAccount('A-ABCD1234'),
    /redirects are not permitted/,
  );
});

test('rejects malformed paginated responses', async () => {
  const client = new OctopusClient({
    apiKey: 'sk_test',
    fetchImpl: async () => jsonResponse({
      count: 1,
      next: null,
      previous: null,
      results: 'not-an-array',
    }),
  });

  await assert.rejects(
    () => client.getAll('/x/'),
    /invalid paginated response/,
  );
});

test('honours Retry-After for throttled requests', async () => {
  let calls = 0;
  const client = new OctopusClient({
    apiKey: 'sk_test',
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '0' : null },
          json: async () => ({}),
          text: async () => '',
        };
      }
      return jsonResponse(ACCOUNT);
    },
  });

  const account = await client.getAccount('A-ABCD1234');
  assert.strictEqual(account.number, 'A-ABCD1234');
  assert.strictEqual(calls, 2);
});

test('encodes meter identifiers used in consumption paths', async () => {
  let seenUrl;
  const client = new OctopusClient({
    apiKey: 'sk_test',
    fetchImpl: async (url) => {
      seenUrl = url;
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    },
  });

  await client.consumption('electricity', '123/456', 'SERIAL/1');
  assert.match(seenUrl, /123%2F456/);
  assert.match(seenUrl, /SERIAL%2F1/);
});
