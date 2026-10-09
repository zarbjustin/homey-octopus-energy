'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { summaryMetricFreshness } = require('../lib/statusPresentation');

test('Summary metrics use their own source ages, with no healthy whole-device fallback', () => {
  const now = Date.parse('2026-10-09T12:00Z');
  const stamp = (age) => new Date(now - age * 60000).toISOString();
  const freshness = {
    updatedAt: stamp(0),
    problem: false,
    sources: {
      balance: { state: 'stale', updatedAt: stamp(180) },
      meter_data: { state: 'current', updatedAt: stamp(3) },
      billing_summary: { state: 'current', updatedAt: stamp(1) },
      monthly_cost: { state: 'stale', updatedAt: stamp(120) },
    },
  };
  const values = {
    balance: 0, usage: 2, cost: 1, month: 30, points: 5,
  };
  const result = summaryMetricFreshness(freshness, values, now);
  assert.equal(result.balance.state, 'stale');
  assert.equal(result.balance.ageMinutes, 180);
  assert.equal(result.usage.state, 'current');
  assert.equal(result.cost.ageMinutes, 3);
  assert.equal(result.month.source, 'monthly_cost', 'monthly cost is not the separate billing-period summary');
  assert.equal(result.month.ageMinutes, 120);
  assert.equal(result.points.state, 'unknown');
  assert.equal(result.points.ageMinutes, null);
  assert.equal(summaryMetricFreshness({ ...freshness, problem: true }, values, now).usage.state, 'stale');
});

test('Summary metric badges reject missing/invalid/future source timestamps and missing values', () => {
  const now = Date.parse('2026-10-09T12:00Z');
  for (const updatedAt of [null, 'invalid', new Date(now + 1).toISOString()]) {
    const f = { sources: { balance: { state: 'current', updatedAt } } };
    const view = summaryMetricFreshness(f, { balance: 0 }, now).balance;
    assert.equal(view.state, 'unknown'); assert.equal(view.ageMinutes, null);
  }
  for (const balance of [null, undefined, NaN, Infinity, false, '0']) {
    assert.equal(summaryMetricFreshness({ sources: { balance: { state: 'current', updatedAt: new Date(now).toISOString() } } }, { balance }, now).balance.state, 'unknown');
  }
});

test('Summary per-metric badges show non-colour state/age and delayed settlement, escaping labels', () => {
  const html = fs.readFileSync('widgets/summary/public/index.html', 'utf8');
  const context = vm.createContext({});
  vm.runInContext(html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1], context);
  const cell = context.metricCell({ cost: 0, metricFreshness: { cost: { state: 'stale', ageMinutes: 120 } } }, 'cost', '<img>', '£');
  assert.match(cell, /£0.00/);
  assert.match(cell, /Stale · checked 120 min ago/);
  assert.match(cell, /Delayed settled data/);
  assert.match(cell, /&lt;img&gt;/);
  assert.doesNotMatch(cell, /<img>/);
  assert.match(context.metricCell({ balance: null }, 'balance', 'Balance', '£'), /Unknown · check time unknown/);
  assert.equal(context.n(Infinity), '–');
  assert.equal(context.n(false), '–');
});

const widgetApis = [
  ['agile', 'electricity'],
  ['price', 'electricity'],
  ['timeline', 'electricity'],
  ['carbon', 'electricity'],
  ['optimiser', 'electricity'],
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
  for (const widget of ['agile', 'price', 'summary', 'timeline', 'export', 'carbon', 'optimiser']) {
    const file = path.join(__dirname, '..', 'widgets', widget, 'public', 'index.html');
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /function esc\(value\)/, widget);
    assert.match(html, /esc\(d\.name \|\|/, widget);
    assert.match(html, /esc\(\(d && d\.error\) \|\|/, widget);
  }
});

test('widget frontends expose live status and accessible controls', () => {
  for (const widget of ['agile', 'price', 'summary', 'timeline', 'export', 'carbon', 'optimiser']) {
    const file = path.join(__dirname, '..', 'widgets', widget, 'public', 'index.html');
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /aria-live="polite"/, widget);
    assert.match(html, /freshnessHtml/, widget);
  }
  const agile = fs.readFileSync(
    path.join(__dirname, '..', 'widgets', 'agile', 'public', 'index.html'),
    'utf8',
  );
  assert.match(agile, /<button type="button" class="tab/);
  assert.match(agile, /aria-pressed/);
  const optimiser = fs.readFileSync(
    path.join(__dirname, '..', 'widgets', 'optimiser', 'public', 'index.html'),
    'utf8',
  );
  assert.match(optimiser, /role="group"/);
  assert.match(optimiser, /aria-pressed/);
});

test('optimiser widget uses the cached device planner and bounds controls', async () => {
  const api = require('../widgets/optimiser/api.js');
  const expected = {
    available: true,
    start: '2026-07-25T01:00:00Z',
    end: '2026-07-25T03:00:00Z',
  };
  const calls = [];
  const device = {
    getData: () => ({ id: 'meter-1' }),
    getName: () => 'Meter',
    getDataFreshness: () => ({ updatedAt: null, stale: false, problem: false }),
    getCostCarbonPlan: (...args) => {
      calls.push(args);
      return expected;
    },
  };
  const homey = {
    drivers: {
      getDriver: (id) => {
        assert.equal(id, 'electricity');
        return { getDevices: () => [device] };
      },
    },
  };

  const result = await api.getData({
    homey,
    query: {
      id: 'meter-1', duration: '99', within: '0', greenness: '2',
    },
  });
  assert.equal(result.plan, expected);
  assert.deepEqual(calls, [[12, 1, 1]]);
});

test('widget APIs pass device freshness through to their frontends', async () => {
  const api = require('../widgets/timeline/api.js');
  const freshness = { updatedAt: '2026-07-19T00:00:00Z', stale: true, problem: false };
  const device = {
    getData: () => ({ id: 'meter-1' }),
    getName: () => 'Meter',
    getUpcomingPrices: () => [],
    getDataFreshness: () => freshness,
  };
  const homey = {
    drivers: {
      getDriver: () => ({ getDevices: () => [device] }),
    },
  };

  const result = await api.getData({ homey, query: { id: 'meter-1' } });
  assert.deepEqual(result.freshness, freshness);
});

test('summary widget populates the S44 effective-price hook from the device', async () => {
  const api = require('../widgets/summary/api.js');
  const effective = {
    householdBase: 24.5,
    estimatedEffective: 24.5,
    finalisedPrevHalfHour: 22.3,
    confidence: 'medium',
    estimated: true,
    settlement: false,
    reasons: ['bonus-smart-ev-only', 'estimate-not-settlement'],
    ev: {
      peak: 30.1, offPeak: 7.5, allowanceWindow: '12:00–12:00 local', allowanceRemaining: null,
    },
  };
  const device = {
    getData: () => ({ id: 'd1' }),
    getName: () => 'Meter',
    hasCapability: () => false,
    getCapabilityValue: () => null,
    getDataFreshness: () => ({ updatedAt: null, stale: false, problem: false }),
    getLiveDemandView: () => ({
      netW: -900, importW: 0, exportW: 900, state: 'current', readAt: '2026-07-20T00:00:00Z', source: 'graphql',
    }),
    getDispatchView: () => ({
      activeNow: true, active: [], next: null, recentFinalised: [{ start: 'x', end: 'y', delta: 2.3 }],
    }),
    getCachedEffectiveRateView: () => effective,
  };
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  const data = await api.getData({ homey, query: { id: 'd1' } });
  assert.equal(data.live.exportW, 900);
  assert.equal(data.dispatch.activeNow, true);
  assert.equal(data.effectivePrice.estimated, true);
  assert.equal(data.effectivePrice.settlement, false);
  assert.equal(data.effectivePrice.ev.offPeak, 7.5);
});

test('summary widget returns a null effective price when the device has no view', async () => {
  const api = require('../widgets/summary/api.js');
  const device = {
    getData: () => ({ id: 'd1' }),
    getName: () => 'Meter',
    hasCapability: () => false,
    getCapabilityValue: () => null,
  };
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  const data = await api.getData({ homey, query: { id: 'd1' } });
  assert.equal(data.effectivePrice, null);
});

test('summary widget renders the estimated effective rate and EV pricing separately', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'summary', 'public', 'index.html'), 'utf8');
  assert.match(html, /function badge\(/);
  assert.match(html, /Net-derived from Home Mini/);
  assert.match(html, /not a billed rate or settlement/i);
  // The S44 effective-price block is rendered, clearly labelled Estimated and
  // never as settlement, with EV rates in a separate section.
  assert.match(html, /effectiveHtml\(d\)/);
  assert.match(html, /Estimated/);
  assert.match(html, /not a bill or settlement/i);
  assert.match(html, /EV device pricing/);
  assert.match(html, /EV-device rates only, not your household rate/i);
  // Every dynamic value goes through esc()/n(); null renders as an en dash.
  assert.match(html, /function confBadge\(/);
});
