'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { KrakenClient } = require('../.homeybuild/lib/KrakenClient');
const { resetBudget } = require('../.homeybuild/lib/KrakenBudget');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const old = { readAt: '2026-10-28T11:40:00Z', demand: 10 };
const fresh = { readAt: '2026-10-28T11:59:50Z', demand: -123 };
const future = { readAt: '2026-10-28T12:10:00Z', demand: 999 };
test.afterEach(() => resetBudget());

for (const [name, rows, expected] of [
  ['oldest first', [old, fresh], fresh],
  ['newest first', [fresh, old], fresh],
  ['invalid first timestamp', [{ readAt: 'invalid', demand: 999 }, old, fresh], fresh],
  ['missing first timestamp', [{ demand: 999 }, fresh], fresh],
  ['null and malformed rows', [null, false, 'invalid', {}, fresh], fresh],
  ['future row cannot hide current data', [future, fresh, old], fresh],
  ['equal timestamps use the last row', [fresh, { ...fresh, demand: 0 }], { ...fresh, demand: 0 }],
  ['singleton object', fresh, fresh],
  ['all old remains old', [old], old],
  ['offset timestamps compare instants', [old, { readAt: '2026-10-28T12:59:50+01:00', demand: 0 }], { readAt: '2026-10-28T12:59:50+01:00', demand: 0 }],
  ['invalid timestamp alone stays invalid', { readAt: 'invalid', demand: 5 }, { readAt: 'invalid', demand: 5 }],
  ['future timestamp alone stays invalid downstream', future, future],
  ['missing timestamp is not replaced', { demand: 5 }, { demand: 5, readAt: null }],
  ['newest invalid demand is not replaced with older power', [fresh, { readAt: '2026-10-28T12:00:00Z', demand: null }], { demand: null, readAt: '2026-10-28T12:00:00Z', outcome: 'invalid-demand' }],
  ['empty list', [], { demand: null, readAt: null, outcome: 'empty' }],
  ['absent telemetry', null, { demand: null, readAt: null, outcome: 'empty' }],
  ['only malformed rows', [null, false, 'invalid'], { demand: null, readAt: null, outcome: 'invalid-demand' }],
]) {
  test(`Mini selects latest dated sample: ${name}`, async (t) => {
    resetBudget();
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    let telemetryCalls = 0;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const query = JSON.parse(init.body).query;
      if (query.includes('obtainKrakenToken')) return new Response(JSON.stringify({ data: { obtainKrakenToken: { token: 'synthetic-token' } } }));
      telemetryCalls += 1;
      assert.deepEqual(JSON.parse(init.body).variables, { deviceId: 'synthetic-mini' });
      return new Response(JSON.stringify({ data: { smartMeterTelemetry: rows } }));
    });
    const result = await new KrakenClient('synthetic-key', 'synthetic-account').getDemandReading('synthetic-mini');
    assert.deepEqual(result, expected);
    assert.equal(telemetryCalls, 1);
    resetBudget();
  });
}
