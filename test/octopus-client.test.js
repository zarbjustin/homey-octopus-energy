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
  let seenAuth;
  let seenRedirect;
  const client = new OctopusClient({
    apiKey: 'sk_test_123',
    fetchImpl: async (url, opts) => {
      seenAuth = opts.headers.Authorization;
      seenRedirect = opts.redirect;
      return jsonResponse(ACCOUNT);
    },
  });
  await client.getAccount('A-ABCD1234');
  const expected = `Basic ${Buffer.from('sk_test_123:').toString('base64')}`;
  assert.strictEqual(seenAuth, expected);
  assert.strictEqual(seenRedirect, 'manual');
});

test('production clients require HTTPS endpoints without embedded credentials', () => {
  assert.throws(
    () => new OctopusClient({ apiKey: 'secret', baseUrl: 'http://api.example/v1' }),
    /must use HTTPS/,
  );
  assert.throws(
    () => new OctopusClient({ apiKey: 'secret', baseUrl: 'https://user:pass@api.example/v1' }),
    /must not contain credentials/,
  );
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

test('getAll refuses pagination links on an unexpected origin', async () => {
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => jsonResponse({ count: 1, next: 'https://evil.example/steal', previous: null, results: [] }),
  });
  await assert.rejects(() => client.getAll('/products/'), /unexpected origin/);
});

test('redirect responses are rejected without forwarding credentials', async () => {
  let calls = 0;
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 302,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => '',
      };
    },
  });

  await assert.rejects(() => client.getAccount('A-ABCD1234'), /redirects are not permitted/);
  assert.strictEqual(calls, 1);
});

test('API errors do not expose request URLs or response bodies', async () => {
  const privateBody = 'upstream-secret-account-data';
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => privateBody,
    }),
  });

  await assert.rejects(
    () => client.get('/accounts/A-PRIVATE/?token=private-token'),
    (err) => {
      assert.match(err.message, /request failed \(400\)/);
      assert.doesNotMatch(err.message, /A-PRIVATE|private-token|upstream-secret-account-data/);
      return true;
    },
  );
});

test('throttled requests accept Retry-After seconds and HTTP dates', async () => {
  for (const retryAfter of ['0', new Date(Date.now() - 1000).toUTCString()]) {
    let calls = 0;
    const client = new OctopusClient({
      apiKey: 'secret',
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            status: 429,
            headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null },
            json: async () => ({}),
            text: async () => '',
          };
        }
        return jsonResponse(ACCOUNT);
      },
    });

    assert.strictEqual((await client.getAccount('A-ABCD1234')).number, 'A-ABCD1234');
    assert.strictEqual(calls, 2);
  }
});

test('only network failures and transient HTTP statuses are retried', async () => {
  let networkCalls = 0;
  const networkClient = new OctopusClient({
    apiKey: 'secret',
    maxRetries: 2,
    fetchImpl: async () => {
      networkCalls += 1;
      if (networkCalls === 1) throw new TypeError('socket closed');
      return jsonResponse(ACCOUNT);
    },
  });
  assert.strictEqual((await networkClient.getAccount('A-ABCD1234')).number, 'A-ABCD1234');
  assert.strictEqual(networkCalls, 2);

  let parseCalls = 0;
  const parseClient = new OctopusClient({
    apiKey: 'secret',
    maxRetries: 3,
    fetchImpl: async () => {
      parseCalls += 1;
      return {
        ...jsonResponse(ACCOUNT),
        json: async () => { throw new SyntaxError('invalid JSON'); },
      };
    },
  });
  await assert.rejects(() => parseClient.getAccount('A-ABCD1234'), /invalid JSON/);
  assert.strictEqual(parseCalls, 1);

  let failedCalls = 0;
  const privateNetworkDetail = 'request to https://api.example/A-PRIVATE failed';
  const failedClient = new OctopusClient({
    apiKey: 'secret',
    maxRetries: 1,
    fetchImpl: async () => {
      failedCalls += 1;
      throw new TypeError(privateNetworkDetail);
    },
  });
  await assert.rejects(
    () => failedClient.getAccount('A-ABCD1234'),
    (err) => {
      assert.match(err.message, /could not be completed/);
      assert.doesNotMatch(err.message, /api\.example|A-PRIVATE/);
      return true;
    },
  );
  assert.strictEqual(failedCalls, 1);
});

test('getAll rejects malformed, repeated, and excessive pagination', async () => {
  const malformed = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => jsonResponse({ count: 1, next: null, previous: null, results: 'invalid' }),
  });
  await assert.rejects(() => malformed.getAll('/products/'), /invalid paginated response/);

  let repeatedCalls = 0;
  const repeated = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => {
      repeatedCalls += 1;
      return jsonResponse({
        count: 2,
        next: 'https://api.octopus.energy/v1/products/?page=2',
        previous: null,
        results: [],
      });
    },
  });
  await assert.rejects(() => repeated.getAll('/products/'), /repeated page/);
  assert.strictEqual(repeatedCalls, 2);

  let pageNumber = 0;
  const excessive = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => {
      pageNumber += 1;
      return jsonResponse({
        count: 51,
        next: `https://api.octopus.energy/v1/products/?page=${pageNumber + 1}`,
        previous: null,
        results: [],
      });
    },
  });
  await assert.rejects(() => excessive.getAll('/products/'), /exceeded the safety limit/);
  assert.strictEqual(pageNumber, 50);
});

test('latest unit rates returns one bounded page without following history', async () => {
  let calls = 0;
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        count: 5000,
        next: 'https://api.octopus.energy/v1/rates/?page=2',
        previous: null,
        results: [{ value_inc_vat: 20 }],
      });
    },
  });

  const rates = await client.latestStandardUnitRates('electricity', 'FIXED', 'E-1R-FIXED-A');
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(rates, [{ value_inc_vat: 20 }]);
});

test('product tariff resolution uses the regional direct-debit code returned by Octopus', async () => {
  let requestedUrl;
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({
        code: 'AGILE',
        single_register_electricity_tariffs: {
          _C: {
            varying: { code: 'E-1R-AGILE-C-VARYING' },
            direct_debit_monthly: { code: 'E-1R-AGILE-C' },
          },
        },
      });
    },
  });

  const tariff = await client.tariffCodeForProduct('AGILE', 'electricity', 'c', 1);
  assert.equal(tariff, 'E-1R-AGILE-C');
  assert.match(requestedUrl, /\/products\/AGILE\/$/);
});

test('product tariff resolution supports Economy 7 and gas tables', async () => {
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => jsonResponse({
      code: 'FLEX',
      dual_register_electricity_tariffs: {
        _A: { direct_debit_monthly: { code: 'E-2R-FLEX-A' } },
      },
      single_register_gas_tariffs: {
        _A: { direct_debit_monthly: { code: 'G-1R-FLEX-A' } },
      },
    }),
  });

  assert.equal(await client.tariffCodeForProduct('FLEX', 'electricity', 'A', 2), 'E-2R-FLEX-A');
  assert.equal(await client.tariffCodeForProduct('FLEX', 'gas', 'A'), 'G-1R-FLEX-A');
});

test('consumption URL encodes meter path segments', async () => {
  let requestedUrl;
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    },
  });

  await client.consumption('electricity', '123/456', 'SERIAL/ONE');
  assert.match(requestedUrl, /123%2F456\/meters\/SERIAL%2FONE\/consumption/);
});

test('GET coalescing: concurrent identical reads hit the network once (BL-03)', async () => {
  let calls = 0;
  const client = new OctopusClient({
    apiKey: 'secret',
    fetchImpl: async () => { calls += 1; return jsonResponse({ count: 1, results: [{ v: 1 }] }); },
  });

  // Two concurrent identical GETs share one network request.
  const [a, b] = await Promise.all([
    client.getAccount('A-DEDUP'),
    client.getAccount('A-DEDUP'),
  ]);
  assert.strictEqual(calls, 1, 'concurrent identical GETs are coalesced to one fetch');

  // A sequential identical GET within the short TTL reuses the response.
  await client.getAccount('A-DEDUP');
  assert.strictEqual(calls, 1, 'a repeat within the TTL is served from the coalescer');

  // A different path is a separate request.
  await client.getAccount('A-OTHER');
  assert.strictEqual(calls, 2, 'a different URL is not coalesced');

  // Coalesced callers get independent (cloned) objects, not a shared reference.
  assert.notStrictEqual(a, b, 'each caller receives its own cloned copy');
  assert.deepEqual(a, b, 'but with equal content');
});
