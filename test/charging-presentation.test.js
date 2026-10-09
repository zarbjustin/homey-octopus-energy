'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { dataHealthView } = require('../lib/statusPresentation');
const { chargingPlanView, reconcileChargingPlan } = require('../lib/planning/chargingPlan');

const now = Date.parse('2026-11-02T12:00:00Z');
const policy = {
  mode: 'duration', price: 10, duration: 1, deadline: now + 7200000, fallback: true, maximum: 25,
};
const rows = [5, 30, 15, 30].map((price, i) => ({ valid_from: new Date(now + i * 1800000).toISOString(), valid_to: new Date(now + (i + 1) * 1800000).toISOString(), value_inc_vat: price }));
function state(prices = rows) {
  return reconcileChargingPlan(null, policy, prices, { current: true, until: now + 9000000 }, now).state;
}
function frontend(file) {
  const html = fs.readFileSync(file, 'utf8');
  const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({ console });
  vm.runInContext(script, context);
  return context;
}

test('plan summary distinguishes remaining budget, selected time and unknown coverage without mutation', () => {
  const s = state();
  const before = JSON.stringify(s);
  const result = chargingPlanView(s, now, 'Europe/London');
  assert.equal(result.remainingHours, 1);
  assert.equal(result.selectedHours, 1);
  assert.equal(result.maximumPrice, 25);
  assert.equal(result.slots.length, 2);
  assert.equal(result.slots[1].fallback, true);
  assert.equal(result.timezone, 'Europe/London');
  assert.equal(JSON.stringify(s), before);
  assert.equal(chargingPlanView(state([]), now, 'Europe/London').selectedHours, null);
  assert.equal(chargingPlanView(null, now, 'Europe/London').configured, false);
  assert.equal(chargingPlanView({ ...s, policy: { ...policy, mode: 'all' } }, now, 'UTC').remainingHours, null);
});

test('cached health maps source age and delayed settlement without leaking raw identifiers/errors', () => {
  const view = dataHealthView({
    problem: true,
    secret: 'private-account',
    sources: {
      prices: { state: 'stale', updatedAt: new Date(now - 900000).toISOString(), lastError: 'private-token' },
      meter_data: { state: 'current', updatedAt: new Date(now).toISOString() },
      unknownSecret: { state: 'current' },
    },
  }, null, now);
  assert.equal(view.items[0].ageMinutes, 15);
  assert.equal(view.items[0].state, 'stale');
  assert.match(view.items[1].advice, /settlement/);
  assert.equal(view.items[2].state, 'unknown');
  assert.doesNotMatch(JSON.stringify(view), /private|unknownSecret|lastError/);
  for (const updatedAt of ['invalid', new Date(now + 1000).toISOString()]) {
    assert.equal(dataHealthView({ sources: { prices: { state: 'current', updatedAt } } }, null, now).items[0].state, 'unknown');
  }
});

test('health distinguishes unsupported, degraded, unknown and fresh dispatch without guessing enrolment', () => {
  for (const [eligibility, freshness, expected] of [['ineligible', 'current', 'unsupported'], ['degraded', 'current', 'stale'], ['unknown', 'current', 'unknown'], ['eligible', 'stale', 'stale'], ['eligible', 'current', 'current']]) {
    const item = dataHealthView(null, { freshness, eligibility: { state: eligibility, reason: 'secret-device-id' } }, now).items.at(-1);
    assert.equal(item.state, expected);
    assert.doesNotMatch(JSON.stringify(item), /secret/);
    if (expected === 'unsupported') assert.match(item.advice, /do not delete or re-pair/);
  }
});

test('summary frontend escapes all plan/health fields and labels unknown separately from zero', () => {
  const ui = frontend('widgets/summary/public/index.html');
  const plan = chargingPlanView(state(), now, 'Europe/London');
  plan.explanation = '<ImG onerror=evil>'; plan.estimateLabel = '<ScRiPt>evil</ScRiPt>';
  const html = ui.planHtml({ chargingPlan: plan }, true);
  assert.match(html, /&lt;img/i);
  assert.doesNotMatch(html, /<img|<script>/i);
  assert.match(html, /Fallback/);
  assert.match(html, /open/);
  assert.match(ui.planHtml({ chargingPlan: chargingPlanView(state([]), now, 'UTC') }), /Selected time unknown/);
  const health = ui.healthHtml({
    health: {
      advice: '<SvG>',
      items: [{
        label: '<ScRiPt>', state: '<B>', ageMinutes: null, advice: '<ImG>',
      }],
    },
  });
  assert.doesNotMatch(health, /<svg>|<script>|<b>|<img>/i);
  assert.match(health, /&lt;svg&gt;/i);
  assert.match(ui.planTime('2026-10-25T01:30:00Z', 'Europe/London'), /01:30/);
});

test('settings health uses success ages and safe fixed advice, not a healthy stamp from another source', () => {
  const ui = frontend('settings/index.html');
  assert.match(ui.integrationHealthLine('prices', { lastSuccess: new Date(now - 7200000).toISOString() }, now), /120 min ago/);
  assert.match(ui.integrationHealthLine('billing_summary', { coverageUnavailable: true, lastError: 'private-key' }, now), /coverage is missing/);
  const text = ui.integrationHealthLine('balance', { lastError: 'private-account' }, now);
  assert.match(text, /last check failed/);
  assert.doesNotMatch(text, /private-account/);
  assert.equal(ui.integrationHealthLine('private-device-id', {}, now), null);
  assert.equal(ui.integrationHealthLine('constructor', {}, now), null);
  assert.match(ui.integrationHealthLine('prices', { lastSuccess: new Date(now + 1000).toISOString() }, now), /no successful update/);
});
