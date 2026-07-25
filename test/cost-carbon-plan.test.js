'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateCostCarbonPlan } = require('../.homeybuild/lib/planning/costCarbon.js');

const SLOT_MS = 30 * 60_000;

function rates(start, prices) {
  return prices.map((price, index) => ({
    valid_from: new Date(start + index * SLOT_MS).toISOString(),
    valid_to: new Date(start + (index + 1) * SLOT_MS).toISOString(),
    value_inc_vat: price,
    value_exc_vat: price,
    payment_method: null,
  }));
}

function carbon(start, intensities) {
  return intensities.map((intensity, index) => ({
    from: new Date(start + index * SLOT_MS).toISOString(),
    to: new Date(start + (index + 1) * SLOT_MS).toISOString(),
    intensity,
    index: 'moderate',
  }));
}

test('price-only selects the cheapest contiguous window', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [30, 5, 6, 20]),
    carbon(start, [50, 300, 300, 50]),
    {
      now: new Date(start),
      horizonEnd: new Date(start + 4 * SLOT_MS),
      durationSlots: 2,
      greenness: 0,
      energyKwh: 7,
    },
  );

  assert.equal(result.available, true);
  assert.equal(result.start, new Date(start + SLOT_MS).toISOString());
  assert.equal(result.averagePrice, 5.5);
  assert.equal(result.estimatedCost, 0.39);
  assert.equal(result.extraPriceVsCheapest, 0);
  assert.match(result.estimateLabel, /not a bill or settlement/i);
});

test('carbon-heavy weighting accepts a price premium for a cleaner window', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [10, 10, 14, 14]),
    carbon(start, [300, 300, 50, 50]),
    {
      now: new Date(start),
      horizonEnd: new Date(start + 4 * SLOT_MS),
      durationSlots: 2,
      greenness: 0.8,
      energyKwh: 7,
    },
  );

  assert.equal(result.start, new Date(start + 2 * SLOT_MS).toISOString());
  assert.equal(result.averagePrice, 14);
  assert.equal(result.averageCarbon, 50);
  assert.equal(result.extraPriceVsCheapest, 4);
  assert.equal(result.carbonReductionVsCheapest, 250);
  assert.equal(result.estimatedEmissionsKg, 0.35);
});

test('normalisation makes an even weight independent of raw unit scales', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [1, 1, 2, 2]),
    carbon(start, [500, 500, 100, 100]),
    {
      now: new Date(start),
      horizonEnd: new Date(start + 4 * SLOT_MS),
      durationSlots: 2,
      greenness: 0.6,
    },
  );

  assert.equal(result.start, new Date(start + 2 * SLOT_MS).toISOString());
});

test('fails closed when any in-horizon rate lacks carbon coverage', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [5, 6, 7]),
    carbon(start, [100, 90]),
    {
      now: new Date(start),
      horizonEnd: new Date(start + 3 * SLOT_MS),
      durationSlots: 2,
      greenness: 0.5,
    },
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, 'insufficient-carbon');
  assert.deepEqual(result.slots, []);
});

test('fails closed when carbon covers only the start of a rate slot', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [5]),
    [{
      from: new Date(start).toISOString(),
      to: new Date(start + 60_000).toISOString(),
      intensity: 100,
    }],
    {
      now: new Date(start),
      horizonEnd: new Date(start + SLOT_MS),
      durationSlots: 1,
      greenness: 0.5,
    },
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, 'insufficient-carbon');
});

test('fails closed when price rows do not continuously cover the horizon', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const rs = rates(start, [5, 6, 7]);
  rs[1].valid_from = new Date(start + 2 * SLOT_MS).toISOString();
  rs[1].valid_to = new Date(start + 3 * SLOT_MS).toISOString();
  rs[2].valid_from = new Date(start + 4 * SLOT_MS).toISOString();
  rs[2].valid_to = new Date(start + 5 * SLOT_MS).toISOString();
  const result = evaluateCostCarbonPlan(
    rs,
    carbon(start, [100, 90, 80, 70, 60]),
    {
      now: new Date(start),
      horizonEnd: new Date(start + 5 * SLOT_MS),
      durationSlots: 2,
      greenness: 0.5,
    },
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, 'insufficient-rates');
});

test('fails closed when later prices in the requested horizon are unpublished', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [5, 6]),
    carbon(start, [100, 90, 80, 70]),
    {
      now: new Date(start),
      horizonEnd: new Date(start + 4 * SLOT_MS),
      durationSlots: 1,
      greenness: 0.5,
    },
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, 'insufficient-rates');
});

test('weights the partially used final charge slot in estimates', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [20, 30]),
    carbon(start, [100, 200]),
    {
      now: new Date(start),
      horizonEnd: new Date(start + 2 * SLOT_MS),
      durationSlots: 2,
      greenness: 0.5,
      energyKwh: 4,
      energyPerSlotKwh: 3.5,
    },
  );

  assert.equal(result.averagePrice, 21.25);
  assert.equal(result.estimatedCost, 0.85);
  assert.equal(result.averageCarbon, 113);
  assert.equal(result.estimatedEmissionsKg, 0.45);
});

test('does not count an in-progress slot as a full future charging slot', () => {
  const start = Date.parse('2026-07-25T00:00:00Z');
  const result = evaluateCostCarbonPlan(
    rates(start, [20, 20]),
    carbon(start, [100, 100]),
    {
      now: new Date(start + 20 * 60_000),
      horizonEnd: new Date(start + 60 * 60_000),
      durationSlots: 2,
      greenness: 0.5,
      energyKwh: 7,
      energyPerSlotKwh: 3.5,
    },
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, 'insufficient-rates');
});
