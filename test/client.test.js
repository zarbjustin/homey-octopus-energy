'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { OctopusClient } = require('../.homeybuild/lib/OctopusClient.js');

test('activeTariff prefers the open-ended agreement', () => {
  const agreements = [
    { tariff_code: 'E-1R-OLD-A', valid_from: '2022-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z' },
    { tariff_code: 'E-1R-CURRENT-A', valid_from: '2023-01-01T00:00:00Z', valid_to: null },
  ];
  assert.strictEqual(OctopusClient.activeTariff(agreements), 'E-1R-CURRENT-A');
});

test('activeTariff falls back to the most recent when all are closed', () => {
  const agreements = [
    { tariff_code: 'E-1R-OLD-A', valid_from: '2022-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z' },
    { tariff_code: 'E-1R-NEWER-A', valid_from: '2023-06-01T00:00:00Z', valid_to: '2024-01-01T00:00:00Z' },
  ];
  assert.strictEqual(OctopusClient.activeTariff(agreements), 'E-1R-NEWER-A');
});

test('activeTariff returns null for no agreements', () => {
  assert.strictEqual(OctopusClient.activeTariff([]), null);
  assert.strictEqual(OctopusClient.activeTariff(), null);
});

test('client requires an API key', () => {
  assert.throws(() => new OctopusClient({ apiKey: '' }), /API key/);
});
