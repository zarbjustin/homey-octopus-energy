'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const widgetApis = [
  ['agile', 'electricity'],
  ['price', 'electricity'],
  ['timeline', 'electricity'],
  ['carbon', 'electricity'],
  ['export', 'export'],
];

function meter(id) {
  return {
    getData: () => ({ id }),
    getName: () => id,
  };
}

test('a stale widget device id never falls back to a different meter', async () => {
  for (const [widget, driverId] of widgetApis) {
    const api = require(`../widgets/${widget}/api.js`);
    const homey = {
      drivers: {
        getDriver: (id) => {
          assert.equal(id, driverId);
          return { getDevices: () => [meter('other-device')] };
        },
      },
    };
    // eslint-disable-next-line no-await-in-loop
    const result = await api.getData({ homey, query: { id: 'missing-device' } });
    assert.match(result.error, /selected .*meter is no longer available/i, widget);
  }
});

test('summary widget also rejects a stale device id across all meter drivers', async () => {
  const api = require('../widgets/summary/api.js');
  const homey = {
    drivers: {
      getDriver: () => ({ getDevices: () => [meter('other-device')] }),
    },
  };
  const result = await api.getData({ homey, query: { id: 'missing-device' } });
  assert.match(result.error, /selected meter is no longer available/i);
});

test('widget frontends escape device names and upstream error messages', () => {
  for (const widget of ['agile', 'price', 'summary', 'timeline', 'export', 'carbon']) {
    const file = path.join(__dirname, '..', 'widgets', widget, 'public', 'index.html');
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /function esc\(value\)/, widget);
    assert.match(html, /esc\(d\.name \|\|/, widget);
    assert.match(html, /esc\(\(d && d\.error\) \|\|/, widget);
  }
});
