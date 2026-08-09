'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_THRESHOLDS,
  normaliseThresholds,
  priceBand,
  widgetPriceBandOptions,
} = require('../lib/widgetPriceBands');

test('price bands include their upper boundary and preserve negative prices', () => {
  const values = [-0.01, 0, 10, 10.01, 20, 20.01, 30, 30.01];
  assert.deepEqual(
    values.map((value) => priceBand(value, DEFAULT_THRESHOLDS)),
    ['negative', 'green', 'green', 'yellow', 'yellow', 'orange', 'orange', 'red'],
  );
  assert.equal(priceBand(Number.NaN, DEFAULT_THRESHOLDS), 'unknown');
});

test('price bands accept ascending custom thresholds', () => {
  const result = normaliseThresholds({ greenMax: '7.5', yellowMax: 15, orangeMax: '25' });
  assert.deepEqual(result, {
    thresholds: { greenMax: 7.5, yellowMax: 15, orangeMax: 25 },
    corrected: false,
  });
  assert.equal(priceBand(7.6, result.thresholds), 'yellow');
});

test('missing settings use defaults quietly while malformed settings are corrected', () => {
  assert.deepEqual(normaliseThresholds(), {
    thresholds: { greenMax: 10, yellowMax: 20, orangeMax: 30 },
    corrected: false,
  });
  assert.deepEqual(normaliseThresholds({ greenMax: 30, yellowMax: 20, orangeMax: 10 }), {
    thresholds: { greenMax: 10, yellowMax: 20, orangeMax: 30 },
    corrected: true,
  });
  assert.equal(normaliseThresholds({ greenMax: -1, yellowMax: 20, orangeMax: 30 }).corrected, true);
  assert.equal(normaliseThresholds({ greenMax: 10, yellowMax: 20, orangeMax: 201 }).corrected, true);
});

test('widget band options whitelist palettes and display modes', () => {
  assert.deepEqual(widgetPriceBandOptions({ palette: 'colourblind', mode: 'cheapest_slots' }), {
    thresholds: { greenMax: 10, yellowMax: 20, orangeMax: 30 },
    palette: 'colourblind',
    mode: 'cheapest_slots',
    corrected: false,
  });
  const unsafe = widgetPriceBandOptions({ palette: '<script>', mode: 'unexpected' });
  assert.equal(unsafe.palette, 'standard');
  assert.equal(unsafe.mode, 'price_bands');
});

test('Agile widget API decorates today and tomorrow without changing cheapest metadata', async () => {
  const api = require('../widgets/agile/api.js');
  const slots = [
    {
      start: 'a', price: -1, cheapest: true, current: true,
    },
    {
      start: 'b', price: 12, cheapest: false, current: false,
    },
    {
      start: 'c', price: 31, cheapest: false, current: false,
    },
  ];
  const device = {
    getData: () => ({ id: 'meter-1' }),
    getName: () => 'Meter',
    getDataFreshness: () => null,
    getFreshAgileDayData: async () => ({
      today: slots,
      tomorrow: [{
        start: 'd', price: 21, cheapest: true, current: false,
      }],
    }),
  };
  const homey = {
    drivers: { getDriver: () => ({ getDevices: () => [device] }) },
  };
  const result = await api.getData({
    homey,
    query: {
      id: 'meter-1',
      cheapest: '6',
      green_max: '10',
      yellow_max: '20',
      orange_max: '30',
      palette: 'high_contrast',
      colour_mode: 'price_bands',
    },
  });

  assert.deepEqual(result.today.map((slot) => slot.band), ['negative', 'yellow', 'red']);
  assert.equal(result.today[0].cheapest, true);
  assert.equal(result.tomorrow[0].band, 'orange');
  assert.equal(result.bandOptions.palette, 'high_contrast');
  assert.equal(result.bandOptions.corrected, false);
});

test('Timeline widget API applies the same classifier and corrects invalid thresholds', async () => {
  const api = require('../widgets/timeline/api.js');
  const device = {
    getData: () => ({ id: 'meter-1' }),
    getName: () => 'Meter',
    getUpcomingPrices: () => [{ start: 'a', price: 9 }, { start: 'b', price: 35 }],
    getDataFreshness: () => null,
  };
  const homey = {
    drivers: { getDriver: () => ({ getDevices: () => [device] }) },
  };
  const result = await api.getData({
    homey,
    query: {
      id: 'meter-1', green_max: '30', yellow_max: '20', orange_max: '10',
    },
  });

  assert.deepEqual(result.prices.map((slot) => slot.band), ['green', 'red']);
  assert.equal(result.bandOptions.corrected, true);
  assert.deepEqual(result.bandOptions.thresholds, DEFAULT_THRESHOLDS);
});

test('price widgets declare configurable thresholds and accessible non-colour cues', () => {
  const agileCompose = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'widgets', 'agile', 'widget.compose.json'), 'utf8',
  ));
  const timelineCompose = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'widgets', 'timeline', 'widget.compose.json'), 'utf8',
  ));
  const expected = ['green_max', 'yellow_max', 'orange_max', 'palette'];
  assert.deepEqual(expected.filter((id) => !agileCompose.settings.some((setting) => setting.id === id)), []);
  assert.deepEqual(expected.filter((id) => !timelineCompose.settings.some((setting) => setting.id === id)), []);
  assert.equal(agileCompose.settings.find((setting) => setting.id === 'colour_mode').value, 'price_bands');

  for (const widget of ['agile', 'timeline']) {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'widgets', widget, 'public', 'index.html'), 'utf8',
    );
    assert.match(html, /aria-label="Price colour legend"/, widget);
    assert.match(html, /role="img"/, widget);
    assert.match(html, /band-negative/, widget);
    assert.match(html, /band-green/, widget);
    assert.match(html, /band-yellow/, widget);
    assert.match(html, /band-orange/, widget);
    assert.match(html, /band-red/, widget);
    assert.match(html, /green_max/, widget);
    assert.match(html, /high_contrast/, widget);
  }
});
