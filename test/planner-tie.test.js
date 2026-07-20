'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSeededRandom, pickTie, selectCheapestWindow, selectExpensiveWindow,
  selectExtremeSlots, planEnergy, energyWeightedAverage, isPlanActive,
} = require('../.homeybuild/lib/planner/tie.js');

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

function rate(slotIndex, price) {
  const start = BASE + slotIndex * 30 * 60_000;
  return {
    value_inc_vat: price,
    value_exc_vat: price,
    valid_from: new Date(start).toISOString(),
    valid_to: new Date(start + 30 * 60_000).toISOString(),
    payment_method: null,
  };
}

test('seeded RNG is deterministic and seed-sensitive', () => {
  const a = createSeededRandom('night-1');
  const b = createSeededRandom('night-1');
  const c = createSeededRandom('night-2');
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  const seqC = [c(), c(), c()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('pickTie honours earliest/latest and stays in-range for random', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(pickTie(items, 'earliest', () => 0.9), 'a');
  assert.equal(pickTie(items, 'latest', () => 0), 'c');
  const rng = createSeededRandom('x');
  assert.ok(items.includes(pickTie(items, 'random', rng)));
});

test('cheapest window: earliest vs latest pick opposite equal-cost blocks', () => {
  // Two equal-cost contiguous 2-slot blocks: slots [0,1]=5,5 and [4,5]=5,5.
  const rates = [rate(0, 5), rate(1, 5), rate(2, 30), rate(3, 30), rate(4, 5), rate(5, 5)];
  const earliest = selectCheapestWindow(rates, 2, { tie: 'earliest' });
  const latest = selectCheapestWindow(rates, 2, { tie: 'latest' });
  assert.equal(earliest[0].valid_from, rate(0, 5).valid_from);
  assert.equal(latest[0].valid_from, rate(4, 5).valid_from);
});

test('cheapest window default is earliest (preserves legacy behaviour)', () => {
  const rates = [rate(0, 5), rate(1, 5), rate(4, 5), rate(5, 5)];
  const w = selectCheapestWindow(rates, 2, {});
  assert.equal(w[0].valid_from, rate(0, 5).valid_from);
});

test('expensive window selects the highest-value block (export)', () => {
  const rates = [rate(0, 5), rate(1, 5), rate(2, 30), rate(3, 30), rate(4, 5)];
  const w = selectExpensiveWindow(rates, 2, {});
  assert.equal(w[0].valid_from, rate(2, 30).valid_from);
});

test('negative prices are preserved and selected as cheapest', () => {
  const rates = [rate(0, -5), rate(1, 10), rate(2, 3)];
  const slots = selectExtremeSlots(rates, 1, {});
  assert.equal(slots.length, 1);
  assert.equal(slots[0].value_inc_vat, -5);
});

test('extreme slots: boundary tie group resolved by strategy, returned time-sorted', () => {
  // cheapest 2 of: [0]=1, [1]=5, [2]=5, [3]=5 → one strict (1) + one from the 5-group.
  const rates = [rate(0, 1), rate(1, 5), rate(2, 5), rate(3, 5)];
  const earliest = selectExtremeSlots(rates, 2, { tie: 'earliest' });
  const latest = selectExtremeSlots(rates, 2, { tie: 'latest' });
  assert.deepEqual(earliest.map((r) => r.value_inc_vat), [1, 5]);
  assert.equal(earliest[1].valid_from, rate(1, 5).valid_from);
  assert.equal(latest[1].valid_from, rate(3, 5).valid_from);
});

test('planEnergy allocates all energy or returns null; final slot may be partial', () => {
  const rates = [rate(0, 5), rate(1, 5), rate(2, 5)];
  // 5 kWh at 7 kW → perSlot 3.5 kWh → needs 2 slots (3.5 + 1.5).
  const plan = planEnergy(rates, 5, 7, {});
  assert.ok(plan);
  assert.equal(plan.count, 2);
  assert.equal(plan.allocations[0].kwh, 3.5);
  assert.equal(plan.allocations[1].kwh, 1.5);
  assert.equal(plan.neededKwh, 5);
  // Insufficient window → null (never partial).
  assert.equal(planEnergy([rate(0, 5)], 10, 1, {}), null);
});

test('planEnergy puts the partial slot on the least-favourable chosen slot (import)', () => {
  // Time order is 20p then 5p; need 4 kWh at 7 kW → 2 slots (3.5 + 0.5).
  const rates = [rate(0, 20), rate(1, 5)];
  const plan = planEnergy(rates, 4, 7, {});
  const byPrice = Object.fromEntries(plan.allocations.map((a) => [a.price, a.kwh]));
  assert.equal(byPrice[5], 3.5); // full charge in the cheap slot
  assert.equal(byPrice[20], 0.5); // only the remainder in the dear slot
  assert.ok(Math.abs(plan.estimatedAmount - (3.5 * 5 + 0.5 * 20)) < 1e-9); // 27.5p
});

test('a slot that would finish after the deadline is excluded', () => {
  const rates = [rate(0, 5), rate(1, 5)]; // slot 1 is 00:30–01:00
  const w = selectCheapestWindow(rates, 1, { to: new Date(BASE + 45 * 60_000) });
  assert.equal(w.length, 1);
  assert.equal(w[0].valid_from, rate(0, 5).valid_from);
});

test('planEnergy export mode targets the dearest slots and may be negative-value', () => {
  const rates = [rate(0, -2), rate(1, 20), rate(2, 15)];
  const plan = planEnergy(rates, 0.5, 1, { kind: 'export' });
  assert.ok(plan);
  assert.equal(plan.allocations[0].price, 20);
});

test('energyWeightedAverage weights by kWh incl. a partial final slot', () => {
  const avg = energyWeightedAverage([{ kwh: 3.5, price: 10 }, { kwh: 1.5, price: 2 }]);
  assert.ok(Math.abs(avg - ((3.5 * 10 + 1.5 * 2) / 5)) < 1e-9);
  assert.equal(energyWeightedAverage([]), null);
});

test('isPlanActive uses half-open [from,to) intervals', () => {
  const plan = planEnergy([rate(0, 5), rate(1, 5)], 0.5, 1, {});
  const start = BASE;
  assert.equal(isPlanActive(plan, start), true);
  assert.equal(isPlanActive(plan, start + 30 * 60_000), false); // exactly the end boundary
});

test('random tie plans are deterministic for a fixed seed and only reorder equal slots', () => {
  const rates = [rate(0, 5), rate(1, 5), rate(2, 5), rate(3, 5)];
  const p1 = selectExtremeSlots(rates, 2, { tie: 'random', rng: createSeededRandom('s1') });
  const p2 = selectExtremeSlots(rates, 2, { tie: 'random', rng: createSeededRandom('s1') });
  assert.deepEqual(p1.map((r) => r.valid_from), p2.map((r) => r.valid_from));
  // all chosen slots still cost 5 (cost is unaffected by the tie strategy)
  for (const r of p1) assert.equal(r.value_inc_vat, 5);
});
