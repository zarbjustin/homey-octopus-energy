'use strict';

const test = require('node:test');
const assert = require('node:assert');

const c = require('../.homeybuild/lib/carbon.js');

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
    { from: '2024-01-01T00:00:00Z', to: '2024-01-01T00:30:00Z', intensity: 120, index: 'moderate' },
    { from: '2024-01-01T00:30:00Z', to: '2024-01-01T01:00:00Z', intensity: 80, index: 'low' },
    { from: '2024-01-01T01:00:00Z', to: '2024-01-01T01:30:00Z', intensity: 200, index: 'high' },
  ];
  // At 00:45 current is 80 (lowest ahead) -> greenest.
  assert.strictEqual(c.isGreenestNow(forecast, new Date('2024-01-01T00:45:00Z')), true);
  // At 00:15 current is 120 but 80 is still ahead -> not greenest.
  assert.strictEqual(c.isGreenestNow(forecast, new Date('2024-01-01T00:15:00Z')), false);
});
