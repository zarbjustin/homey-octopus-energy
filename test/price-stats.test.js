'use strict';

// Regression tests for today's price min/max/avg stats (octopus_price_*_today).
//
// Darren's IOG account (community 156860) showed blank Lowest/Highest/Average
// tiles even though the Current price resolved. Root cause: the stats used to
// filter rate rows by `valid_from` within today (works for Agile's 48 discrete
// per-slot rows, whose valid_from IS today) but IOG half-hourly agreement rows
// are FEW long-span rows whose valid_from predates today -> the window filter
// returned [] -> blank. The fix samples the schedule (rateAt) at each half-hour
// across today, which is correct for both shapes.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');
Module._load = originalLoad;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function rate(from, to, price) {
  return {
    valid_from: new Date(from).toISOString(),
    valid_to: to === null ? null : new Date(to).toISOString(),
    value_inc_vat: price,
    value_exc_vat: price,
    payment_method: null,
  };
}

// Today at 00:00 UTC (the harness pins the timezone to UTC).
function utcMidnightToday() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function deviceWithRates(rates) {
  const device = Object.create(OctopusMeterDevice.prototype);
  const captured = {};
  device.rates = rates;
  device.settings = () => ({ vat: 'inc' });
  device.homey = { clock: { getTimezone: () => 'UTC' } };
  device.hasCapability = (name) => name === 'octopus_price_avg_today';
  device.setCapabilityValue = (name, value) => {
    captured[name] = value;
    return Promise.resolve();
  };
  device.error = () => {};
  device.captured = captured;
  return device;
}

test('Agile-shaped discrete rows produce correct min/max/avg today', async () => {
  const midnight = utcMidnightToday();
  const rates = [];
  // 48 discrete half-hour rows across today, valid_from today (Agile shape).
  for (let i = 0; i < 48; i += 1) {
    const from = midnight + i * 30 * 60_000;
    const price = 10 + i; // 10..57p, strictly increasing
    rates.push(rate(from, from + 30 * 60_000, price));
  }
  const device = deviceWithRates(rates);
  await device.refreshPriceStats();

  assert.equal(device.captured.octopus_price_min_today, 10);
  assert.equal(device.captured.octopus_price_max_today, 57);
  assert.equal(device.captured.octopus_price_avg_today, 33.5);
});

test('IOG blank scenario: a single long-span row whose valid_from predates today still populates stats', async () => {
  const midnight = utcMidnightToday();
  // One row covering [2 days ago, +2 days) at a flat price. The old window
  // filter would drop it (valid_from not within today) and leave stats blank.
  const device = deviceWithRates([rate(midnight - 2 * DAY, midnight + 2 * DAY, 20)]);
  await device.refreshPriceStats();

  assert.equal(device.captured.octopus_price_min_today, 20);
  assert.equal(device.captured.octopus_price_max_today, 20);
  assert.equal(device.captured.octopus_price_avg_today, 20);
});

test('no rates covering today leaves the tiles blank (fail closed, no 0/NaN)', async () => {
  const midnight = utcMidnightToday();
  // A row that expired before today starts: nothing covers today's slots.
  const device = deviceWithRates([rate(midnight - 3 * DAY, midnight - 2 * DAY, 15)]);
  await device.refreshPriceStats();

  assert.ok(!('octopus_price_min_today' in device.captured));
  assert.ok(!('octopus_price_max_today' in device.captured));
  assert.ok(!('octopus_price_avg_today' in device.captured));
});

test('IOG day/night long-span rows yield night as the lowest and day as the highest', async () => {
  const midnight = utcMidnightToday();
  // IOG guaranteed cheap window overnight, standard rate through the day.
  // valid_from of the overnight row predates today (yesterday 23:30).
  const rates = [
    rate(midnight - 30 * 60_000, midnight + 5.5 * HOUR, 7), // 23:30 yest -> 05:30 today (night)
    rate(midnight + 5.5 * HOUR, midnight + 23.5 * HOUR, 28.96), // 05:30 -> 23:30 today (day)
    rate(midnight + 23.5 * HOUR, midnight + DAY + 5.5 * HOUR, 7), // 23:30 today -> 05:30 tmrw (night)
  ];
  const device = deviceWithRates(rates);
  await device.refreshPriceStats();

  assert.equal(device.captured.octopus_price_min_today, 7);
  assert.equal(device.captured.octopus_price_max_today, 28.96);
  assert.ok(device.captured.octopus_price_avg_today > 7 && device.captured.octopus_price_avg_today < 28.96);
});
