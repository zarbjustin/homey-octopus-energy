'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeEffectiveRate, ALLOWANCE_WINDOW, ESTIMATE_NOT_SETTLEMENT,
} = require('../.homeybuild/lib/effectiveRate.js');

const FOUR_RATE = { evPeak: 30.1, evOffPeak: 7.5 };
const DAY_NIGHT = { evPeak: null, evOffPeak: null };

function input(overrides) {
  return {
    optedIn: true,
    householdBase: 24.5,
    inGuaranteedWindow: false,
    activeKinds: [],
    tariff: FOUR_RATE,
    finalisedPrevHalfHour: null,
    ...overrides,
  };
}

test('guaranteed window returns the household off-peak base at high confidence', () => {
  const r = computeEffectiveRate(input({ inGuaranteedWindow: true, householdBase: 7.0 }));
  assert.equal(r.estimatedEffective, 7.0);
  assert.equal(r.confidence, 'high');
  assert.ok(r.reasons.includes('guaranteed-whole-home-offpeak'));
});

test('bonus SMART outside the window keeps the household base, not the EV rate', () => {
  const r = computeEffectiveRate(input({ activeKinds: ['SMART'], householdBase: 24.5 }));
  assert.equal(r.estimatedEffective, 24.5);
  assert.notEqual(r.estimatedEffective, FOUR_RATE.evOffPeak);
  assert.equal(r.confidence, 'medium');
  assert.ok(r.reasons.includes('bonus-smart-ev-only'));
});

test('active BOOST assumes no household discount (base, low confidence)', () => {
  const r = computeEffectiveRate(input({ activeKinds: ['BOOST'] }));
  assert.equal(r.estimatedEffective, 24.5);
  assert.equal(r.confidence, 'low');
  assert.ok(r.reasons.includes('boost-no-assumed-discount'));
});

test('mixed SMART+BOOST stays at base with low confidence', () => {
  const r = computeEffectiveRate(input({ activeKinds: ['SMART', 'BOOST'] }));
  assert.equal(r.estimatedEffective, 24.5);
  assert.equal(r.confidence, 'low');
  assert.ok(r.reasons.includes('dispatch-mixed'));
});

test('unknown dispatch kind stays at base with low confidence', () => {
  const r = computeEffectiveRate(input({ activeKinds: ['unknown'] }));
  assert.equal(r.estimatedEffective, 24.5);
  assert.equal(r.confidence, 'low');
  assert.ok(r.reasons.includes('dispatch-kind-unknown'));
});

test('no active dispatch outside the window is the plain household base', () => {
  const r = computeEffectiveRate(input({ activeKinds: [] }));
  assert.equal(r.estimatedEffective, 24.5);
  assert.equal(r.confidence, 'high');
  assert.ok(r.reasons.includes('household-base-rate'));
});

test('unknown tariff fails closed to a null estimate', () => {
  const r = computeEffectiveRate(input({ tariff: null }));
  assert.equal(r.estimatedEffective, null);
  assert.equal(r.confidence, 'unknown');
  assert.ok(r.reasons.includes('unknown-tariff'));
});

test('opted-out returns a null estimate', () => {
  const r = computeEffectiveRate(input({ optedIn: false }));
  assert.equal(r.estimatedEffective, null);
  assert.ok(r.reasons.includes('not-opted-in'));
});

test('missing household base never substitutes an EV rate', () => {
  const r = computeEffectiveRate(input({ householdBase: null, activeKinds: ['SMART'] }));
  assert.equal(r.estimatedEffective, null);
  assert.equal(r.householdBase, null);
  assert.ok(r.reasons.includes('household-base-unavailable'));
});

test('estimated effective is never below the household base', () => {
  for (const kinds of [[], ['SMART'], ['BOOST'], ['unknown'], ['SMART', 'BOOST']]) {
    const r = computeEffectiveRate(input({ activeKinds: kinds, householdBase: 24.5 }));
    assert.ok(r.estimatedEffective >= r.householdBase);
  }
});

test('EV four-rate values are exposed separately and never folded in', () => {
  const r = computeEffectiveRate(input({ activeKinds: ['SMART'] }));
  assert.equal(r.ev.peak, 30.1);
  assert.equal(r.ev.offPeak, 7.5);
  assert.equal(r.ev.allowanceWindow, ALLOWANCE_WINDOW);
  assert.equal(r.ev.allowanceRemaining, null);
  assert.notEqual(r.estimatedEffective, r.ev.offPeak);
});

test('DayNight tariff exposes null EV rates', () => {
  const r = computeEffectiveRate(input({ tariff: DAY_NIGHT }));
  assert.equal(r.ev.peak, null);
  assert.equal(r.ev.offPeak, null);
});

test('every result is flagged estimate, never settlement', () => {
  for (const t of [FOUR_RATE, DAY_NIGHT, null]) {
    const r = computeEffectiveRate(input({ tariff: t }));
    assert.equal(r.estimated, true);
    assert.equal(r.settlement, false);
    assert.ok(r.reasons.includes(ESTIMATE_NOT_SETTLEMENT));
  }
});

test('finalised previous half-hour passes through untouched', () => {
  const r = computeEffectiveRate(input({ finalisedPrevHalfHour: 22.34 }));
  assert.equal(r.finalisedPrevHalfHour, 22.34);
  // and passes through even when the estimate itself is unavailable
  const r2 = computeEffectiveRate(input({ tariff: null, finalisedPrevHalfHour: 22.34 }));
  assert.equal(r2.finalisedPrevHalfHour, 22.34);
});
