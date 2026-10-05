'use strict';

const test = require('node:test');
const assert = require('node:assert');

const c = require('../.homeybuild/lib/carbon.js');

test('greenest-now does not borrow a future point or accept an incomplete/invalid horizon', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const point = (from, to, intensity) => ({ from, to, intensity });
  const future = point('2026-10-05T00:30:00Z', '2026-10-05T01:00:00Z', 20);
  const current = point('2026-10-05T00:00:00Z', '2026-10-05T00:30:00Z', 10);
  assert.equal(c.isGreenestNow([future], now, 1), false);
  assert.equal(c.isGreenestNow([current], now, 1), false);
  assert.equal(c.isGreenestNow([current, future], now, 1), true);
  assert.equal(c.isGreenestNow([current, future, future], now, 1), false);
  assert.equal(c.isGreenestNow([{ ...current, intensity: null }, future], now, 1), false);
  assert.equal(c.isGreenestNow([current, future], now, 0), false);
});

test('CarbonClient does not coerce empty, boolean or negative intensities to useful readings', async (t) => {
  for (const forecast of ['', false, null, -1]) {
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ from: '2026-10-05T00:00:00Z', to: '2026-10-05T00:30:00Z', intensity: { forecast } }] }),
    }));
    assert.equal(await new c.CarbonClient().getCurrent(), null);
  }
});

test('carbonLevelId maps API index strings to enum ids', () => {
  assert.strictEqual(c.carbonLevelId('very low'), 'very_low');
  assert.strictEqual(c.carbonLevelId('Low'), 'low');
  assert.strictEqual(c.carbonLevelId('moderate'), 'moderate');
  assert.strictEqual(c.carbonLevelId('high'), 'high');
  assert.strictEqual(c.carbonLevelId('VERY HIGH'), 'very_high');
  assert.strictEqual(c.carbonLevelId('unknown'), 'moderate');
});

test('isGreenestNow compares the current point to the forward window', () => {
  const forecast = [
    {
      from: '2024-01-01T00:00:00Z', to: '2024-01-01T00:30:00Z', intensity: 120, index: 'moderate',
    },
    {
      from: '2024-01-01T00:30:00Z', to: '2024-01-01T01:00:00Z', intensity: 80, index: 'low',
    },
    {
      from: '2024-01-01T01:00:00Z', to: '2024-01-01T01:30:00Z', intensity: 200, index: 'high',
    },
  ];
  // At 00:45 current is 80 (lowest ahead) -> greenest.
  assert.strictEqual(c.isGreenestNow(forecast, new Date('2024-01-01T00:45:00Z')), true);
  // At 00:15 current is 120 but 80 is still ahead -> not greenest.
  assert.strictEqual(c.isGreenestNow(forecast, new Date('2024-01-01T00:15:00Z')), false);
});

test('CarbonClient drops forecast rows with no intensity instead of inventing zero', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          from: '2026-07-25T00:00:00Z',
          to: '2026-07-25T00:30:00Z',
          intensity: {},
        },
        {
          from: '2026-07-25T00:30:00Z',
          to: '2026-07-25T01:00:00Z',
          intensity: { forecast: 80, index: 'low' },
        },
      ],
    }),
  });
  try {
    const result = await new c.CarbonClient('https://example.invalid').getForecast();
    assert.deepStrictEqual(result, [{
      from: '2026-07-25T00:30:00Z',
      to: '2026-07-25T01:00:00Z',
      intensity: 80,
      index: 'low',
    }]);
  } finally {
    global.fetch = originalFetch;
  }
});
