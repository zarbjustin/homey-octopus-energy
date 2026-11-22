'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildPriceWidgetDay } = require('../.homeybuild/lib/pricing/widgetDay.js');
const widgetApi = require('../widgets/agile/api');

const date = '2026-11-15';
const options = {
  timeZone: 'Europe/London',
  now: new Date(`${date}T23:35:00Z`),
  dayOffset: 0,
  cheapestCount: 6,
  incVat: true,
  thresholds: { cheap: 10, expensive: 30 },
};
const rate = (valid_from, valid_to, price) => ({
  valid_from, valid_to, value_inc_vat: price, value_exc_vat: price / 1.05, payment_method: null,
});
const go = [
  rate('2026-11-14T05:30:00Z', `${date}T00:30:00Z`, 34.53),
  rate(`${date}T00:30:00Z`, `${date}T05:30:00Z`, 9.40),
  rate(`${date}T05:30:00Z`, '2026-11-16T00:30:00Z', 34.53),
  rate('2026-11-16T00:30:00Z', '2026-11-16T05:30:00Z', 9.40),
  rate('2026-11-16T05:30:00Z', '2026-11-17T00:30:00Z', 34.53),
];

test('Go maps tariff periods to the correct chart widths and carries rates across midnight', () => {
  const today = buildPriceWidgetDay(go, options);
  const tomorrow = buildPriceWidgetDay(go, { ...options, dayOffset: 1 });
  assert.equal(today.hasLongPeriods, true);
  assert.equal(tomorrow.available, true);
  assert.deepEqual(today.slots.map((slot) => [
    slot.label, slot.endLabel, slot.price, slot.current, slot.cheapest,
  ]), [
    ['00:00', '00:30', 34.53, false, false],
    ['00:30', '05:30', 9.40, false, true],
    ['05:30', '24:00', 34.53, true, false],
  ]);
  assert.equal(today.slots[1].position, (0.5 / 24) * 100);
  assert.equal(today.slots[1].width, (5 / 24) * 100);
  assert.equal(tomorrow.slots[0].price, 34.53);
  assert.ok(tomorrow.slots.every((slot) => !slot.current));
  assert.equal(buildPriceWidgetDay(go.slice(0, 3), { ...options, dayOffset: 1 }).available, false);
});

test('the widget renders the Go screenshot case with actual labels and Now on the daytime band', async () => {
  const today = buildPriceWidgetDay(go, options);
  const data = await widgetApi.getData({
    query: {},
    homey: {
      drivers: {
        getDriver: () => ({
          getDevices: () => [{
            getName: () => 'Electricity Meter',
            getAgileDayData: () => ({
              today: today.slots,
              todayTicks: today.ticks,
              todayHasLongPeriods: today.hasLongPeriods,
              currentPrice: 34.53,
            }),
          }],
        }),
      },
    },
  });
  const file = fs.readFileSync(path.join(__dirname, '../widgets/agile/public/index.html'), 'utf8');
  const script = file.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
  const content = { innerHTML: '' };
  vm.runInNewContext(`${script}\nSTATE.data = data; render();`, {
    data, document: { body: {}, getElementById: () => content },
  });
  assert.match(content.innerHTML, /00:30 – 05:30.*9\.40p/);
  assert.match(content.innerHTML, /bar band-red current" role="img" aria-label="05:30–24:00/);
  assert.ok(content.innerHTML.includes(`left:${today.slots[1].position}%;width:${today.slots[1].width}%`));
  assert.doesNotMatch(content.innerHTML, /05:30.06:00|Estimated selection|class="tag now"/);
});

test('Agile slots and chart axis follow the 25-hour clock-change day without collapsing repeated slots', () => {
  const start = Date.parse('2026-10-24T23:00:00Z');
  const at = (slot) => new Date(start + slot * 1_800_000).toISOString();
  const rates = Array.from({ length: 50 }, (_, i) => rate(at(i), at(i + 1), i === 6 ? -1 : 15));
  const result = buildPriceWidgetDay(rates, { ...options, now: new Date(at(4)), cheapestCount: 1 });
  assert.equal(result.hasLongPeriods, false);
  assert.equal(result.available, true);
  assert.equal(result.slots.length, 50);
  assert.equal(result.slots[4].width, 2);
  assert.equal(result.slots[2].label, '01:00');
  assert.equal(result.slots[4].label, '01:00');
  assert.ok(!result.slots[2].current && result.slots[4].current);
  assert.equal(result.ticks[1].position, (7 / 25) * 100);
  assert.deepEqual(result.slots.filter((slot) => slot.cheapest).map((slot) => slot.price), [-1]);
  assert.equal(result.slots[49].endLabel, '24:00');
});
