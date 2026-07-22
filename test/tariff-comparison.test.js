'use strict';

// Unit tests for the pure tariff-comparison ranking (lib/compare/tariffComparison.ts,
// Sprint S62 / BL-19). Pins the honesty rules: never "best", eligibility-gated
// tariffs excluded from recommendations, confidence from coverage + volatility,
// and "not evaluated" reasons.

const test = require('node:test');
const assert = require('node:assert/strict');

const { rankTariffs } = require('../.homeybuild/lib/compare/tariffComparison.js');

test('ranks eligible options cheapest-first with a delta vs current; never labels a "best"', () => {
  const c = rankTariffs([
    { name: 'Current', annual: 1200 },
    { name: 'Agile', annual: 1100, volatility: 'variable' },
    { name: 'Flexible', annual: 1250 },
  ], 'Current', { daysOfData: 30 });

  assert.deepEqual(c.ranked.map((r) => r.name), ['Agile', 'Current', 'Flexible']);
  assert.equal(c.cheapestEstimateName, 'Agile');
  assert.equal(c.cheapestEstimateAnnual, 1100);
  assert.equal(c.estimatedAnnualSaving, 100);
  assert.equal(c.currentIsCheapest, false);
  assert.equal(c.ranked[0].delta, -100, 'delta vs current');
  assert.equal(Object.prototype.hasOwnProperty.call(c, 'best_product'), false, 'no "best" claim');
});

test('the current tariff being cheapest yields a zero saving, not a switch nudge', () => {
  const c = rankTariffs([
    { name: 'Current', annual: 1000 },
    { name: 'Flexible', annual: 1100 },
  ], 'Current', { daysOfData: 45 });
  assert.equal(c.currentIsCheapest, true);
  assert.equal(c.estimatedAnnualSaving, 0);
});

test('hardware-gated tariffs are excluded from the recommendation and listed separately', () => {
  const c = rankTariffs([
    { name: 'Current', annual: 1200 },
    { name: 'Intelligent Go', annual: 800, eligibility: 'requires-ev' },
    { name: 'Cosy', annual: 900, eligibility: 'requires-heat-pump' },
    { name: 'Agile', annual: 1150, volatility: 'variable' },
  ], 'Current', { daysOfData: 30 });

  // IOG (£800) is cheapest overall but must NOT be recommended to a non-EV home.
  assert.equal(c.cheapestEstimateName, 'Agile', 'headline excludes hardware-gated tariffs');
  assert.equal(c.estimatedAnnualSaving, 50);
  assert.deepEqual(
    c.eligibilityGated.map((g) => g.name).sort(),
    ['Cosy', 'Intelligent Go'],
  );
  assert.equal(c.eligibilityGated.find((g) => g.name === 'Intelligent Go').requirement, 'Requires an EV / smart charger');
  assert.ok(!c.ranked.some((r) => r.name === 'Intelligent Go'), 'not in the ranking');
});

test('the current tariff is always the baseline even when it is hardware-gated', () => {
  const c = rankTariffs([
    { name: 'Intelligent Go', annual: 800, eligibility: 'requires-ev' }, // user is ON this
    { name: 'Agile', annual: 1100, volatility: 'variable' },
  ], 'Intelligent Go', { daysOfData: 30 });
  assert.equal(c.current, 800, 'current IOG is the baseline, not gated out');
  assert.equal(c.currentIsCheapest, true);
  assert.equal(c.estimatedAnnualSaving, 0);
});

test('confidence reflects history coverage', () => {
  assert.equal(rankTariffs([{ name: 'Current', annual: 1000 }], 'Current', { daysOfData: 40 }).confidence, 'high');
  assert.equal(rankTariffs([{ name: 'Current', annual: 1000 }], 'Current', { daysOfData: 20 }).confidence, 'medium');
  const low = rankTariffs([{ name: 'Current', annual: 1000 }], 'Current', { daysOfData: 7 });
  assert.equal(low.confidence, 'low');
  assert.match(low.confidenceReason, /7 days/);
});

test('a variable cheapest option caps confidence at medium with a volatility caveat', () => {
  const c = rankTariffs([
    { name: 'Current', annual: 1200 },
    { name: 'Agile', annual: 1000, volatility: 'variable' },
  ], 'Current', { daysOfData: 60 }); // coverage alone = high
  assert.equal(c.confidence, 'medium', 'volatility caps it');
  assert.match(c.confidenceReason, /vary/);
});

test('candidates that could not be priced are reported as not-evaluated with a reason', () => {
  const c = rankTariffs([
    { name: 'Current', annual: 1000 },
    { name: 'Agile', annual: null, reason: 'no rates for your region' },
  ], 'Current', { daysOfData: 30 });
  assert.deepEqual(c.notEvaluated, [{ name: 'Agile', reason: 'no rates for your region' }]);
  assert.ok(!c.ranked.some((r) => r.name === 'Agile'));
});
