'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateThresholdCapacity, evaluateBoundedSlots } = require('../lib/planning/priceAvailability');
const { reconcileChargingPlan, describeChargingPlan, CHARGING_PLAN_DECISIONS } = require('../lib/planning/chargingPlan');
const { nextLocalDeadline } = require('../.homeybuild/lib/timezone');

const start = Date.parse('2026-10-09T12:00:00Z');
const rows = (prices, at = start) => prices.map((price, i) => ({
  valid_from: new Date(at + i * 1800000).toISOString(),
  valid_to: new Date(at + (i + 1) * 1800000).toISOString(),
  value_inc_vat: price,
}));
const options = {
  from: start, to: start + 7200000, threshold: 10, fresh: true, duration: 1,
};
const policy = {
  mode: 'duration', price: 10, duration: 1, deadline: start + 7200000, fallback: true, maximum: 25,
};
const fresh = { current: true, until: start + 9000000 };
const state = (prices, p = policy, now = start, previous = null) => (
  reconcileChargingPlan(previous, p, rows(prices), fresh, now).state
);

test('one cheap slot is not enough; separated cheap slots can supply the chosen duration', () => {
  const one = evaluateThresholdCapacity(rows([5, 15, 15, 15]), options);
  assert.equal(one.status, 'insufficient');
  assert.equal(one.availableHours, 0.5);
  const separated = evaluateThresholdCapacity(rows([5, 15, 5, 15]), options);
  assert.equal(separated.status, 'sufficient');
  assert.equal(separated.availableHours, 1);
});

test('capacity clips the active slot and deadline, never counts elapsed time or late cheap slots', () => {
  const result = evaluateThresholdCapacity(rows([5, 5, 5, 5]), {
    ...options, from: start + 1200000, to: start + 4200000, duration: 1,
  });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.availableHours, 5 / 6);
  assert.equal(evaluateThresholdCapacity(rows([25, 25, 5, 5]), {
    ...options, to: start + 3600000, duration: 0.1,
  }).availableHours, 0);
});

test('capacity price boundaries are strict, with zero and negative prices literal', () => {
  const result = evaluateThresholdCapacity(rows([-1, 0, 10, 9]), { ...options, duration: 1.5 });
  assert.equal(result.availableHours, 1.5);
  assert.equal(result.status, 'sufficient');
  assert.equal(evaluateThresholdCapacity(rows([-1, 0, 10, 9]), {
    ...options, threshold: 0, duration: 0.5,
  }).availableHours, 0.5);
});

test('unpublished, stale, malformed and overlapping horizons cannot prove insufficient cheap time', () => {
  const prices = rows([5, 5, 25, 25]);
  for (const input of [[], prices.slice(0, 2), [prices[0], ...prices.slice(2)], [...prices, prices[1]], [{ ...prices[0], value_inc_vat: null }, ...prices.slice(1)]]) {
    const result = evaluateThresholdCapacity(input, options);
    assert.equal(result.status, 'unknown');
    assert.equal(result.availableHours, null);
  }
  assert.equal(evaluateThresholdCapacity(prices, { ...options, fresh: false }).status, 'unknown');
  assert.equal(evaluateThresholdCapacity(prices, { ...options, threshold: NaN }).status, 'unknown');
  // Even apparently enough cheap time cannot assert coverage of the unpublished remainder.
  assert.equal(evaluateThresholdCapacity(prices.slice(0, 2), { ...options, duration: 0.25 }).status, 'unknown');
});

test('invalid duration or deadline fails closed, and the duration maximum is explicit', () => {
  for (const duration of [0, -1, NaN, Infinity, 24.1, '1']) {
    assert.equal(evaluateThresholdCapacity(rows([5, 5, 5, 5]), { ...options, duration }).status, 'unknown');
  }
  assert.equal(evaluateThresholdCapacity(rows(Array(48).fill(5)), {
    ...options, to: start + 86400000, duration: 24,
  }).status, 'sufficient');
  assert.equal(evaluateThresholdCapacity(rows([5, 5, 5, 5]), { ...options, to: start }).status, 'unknown');
});

test('local deadline capacity uses real elapsed hours across autumn and spring clock changes', () => {
  for (const [at, expectedHours] of [
    [Date.parse('2026-10-25T00:00:00Z'), 3],
    [Date.parse('2026-03-29T00:00:00Z'), 2],
  ]) {
    const to = nextLocalDeadline('03:00', 'Europe/London', at);
    const result = evaluateThresholdCapacity(rows(Array(expectedHours * 2).fill(5), at), {
      ...options, from: at, to, duration: expectedHours,
    });
    assert.equal(result.status, 'sufficient');
    assert.equal(result.availableHours, expectedHours);
  }
});

test('bounded selection reserves permitted earlier fallback rather than waiting until cheap time is exhausted', () => {
  const prices = rows([15, 30, 5, 30]);
  const result = evaluateBoundedSlots(prices, {
    ...options, duration: 1, fallback: true, maximum: 25,
  });
  assert.deepEqual(result.slots.map((slot) => slot.price), [15, 5]);
  assert.equal(describeChargingPlan(state([15, 30, 5, 30]), start).decision, 'eligible_fallback');
  assert.equal(evaluateBoundedSlots(prices, {
    ...options, duration: 1, fallback: false, maximum: 25,
  }).status, 'insufficient');
  assert.equal(describeChargingPlan(state([26, 30, 5, 30]), start).decision, 'insufficient_capacity');
});

test('three hours select one cheap hour and the cheapest two permitted supplementary hours', () => {
  const prices = rows([5, 20, 15, 5, 25, 18, 30, 30]);
  const result = evaluateBoundedSlots(prices, {
    ...options, to: start + 14400000, duration: 3, fallback: true, maximum: 25,
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.slots.map((slot) => slot.price), [5, 20, 15, 5, 25, 18]);
});

test('decision distinguishes current preferred time from future fallback in the same plan', () => {
  const result = state([5, 15, 30, 30]);
  const original = JSON.stringify(result);
  assert.equal(result.selection, 'fallback');
  const decision = describeChargingPlan(result, start);
  assert.equal(decision.decision, 'eligible_preferred');
  assert.match(decision.explanation, /also selected/);
  const later = state([5, 15, 30, 30], policy, start + 1800000, result);
  assert.equal(describeChargingPlan(later, start + 1800000).decision, 'eligible_fallback');
  assert.equal(JSON.stringify(result), original);
});

test('decision explains waiting, none, insufficient, expired and elapsed planned budget separately', () => {
  const all = { ...policy, mode: 'all' };
  assert.equal(describeChargingPlan(state([30, 5, 30, 30], all), start).decision, 'waiting_for_slot');
  assert.equal(describeChargingPlan(state([30, 30, 30, 30], all), start).decision, 'no_qualifying_slots');
  assert.equal(describeChargingPlan(state([5, 30, 30, 30]), start).decision, 'insufficient_capacity');
  const initial = state([5, 15, 30, 30]);
  const expired = state([5, 15, 30, 30], policy, policy.deadline, initial);
  assert.equal(describeChargingPlan(expired, policy.deadline).decision, 'deadline_passed');
  const elapsed = state([5, 15, 30, 30], policy, start + 3600000, initial);
  const result = describeChargingPlan(elapsed, start + 3600000);
  assert.equal(result.decision, 'duration_complete');
  assert.match(result.explanation, /does not prove/);
});

test('unknown and unconfigured diagnostic decisions are excluded from invertible choices', () => {
  const unknown = reconcileChargingPlan(null, policy, [], fresh, start).state;
  const result = describeChargingPlan(unknown, start);
  assert.equal(result.decision, 'waiting_for_prices');
  assert.match(result.explanation, /Missing prices do not mean no cheaper slots/);
  assert.equal(describeChargingPlan(null, start).decision, 'not_configured');
  assert.equal(CHARGING_PLAN_DECISIONS.includes('waiting_for_prices'), false);
  assert.equal(CHARGING_PLAN_DECISIONS.includes('not_configured'), false);
});

test('price republication replans unknown and expensive current periods without resetting the deadline', () => {
  const unknown = reconcileChargingPlan(null, policy, rows([30, 30]), fresh, start);
  assert.equal(describeChargingPlan(unknown.state, start).decision, 'waiting_for_prices');
  const updated = reconcileChargingPlan(unknown.state, policy, rows([15, 30, 5, 30]), fresh, start);
  assert.deepEqual(updated.edges, ['started']);
  assert.equal(describeChargingPlan(updated.state, start).decision, 'eligible_fallback');
  assert.equal(updated.state.policy.deadline, policy.deadline);
  const corrected = reconcileChargingPlan(updated.state, policy, rows([26, 30, 5, 5]), fresh, start);
  assert.deepEqual(corrected.edges, ['ended']);
  assert.equal(describeChargingPlan(corrected.state, start).decision, 'waiting_for_slot');
  assert.equal(corrected.state.policy.maximum, 25);
});
