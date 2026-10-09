'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChargingPlanController, reconcileChargingPlan, describeChargingPlan } = require('../lib/planning/chargingPlan');

const start = Date.parse('2026-11-02T12:00:00Z');
const policy = {
  mode: 'duration', price: 10, duration: 1, deadline: start + 7200000, fallback: true, maximum: 25,
};
const fresh = { current: true, until: start + 9000000 };
const rows = (prices) => prices.map((price, i) => ({
  valid_from: new Date(start + i * 1800000).toISOString(),
  valid_to: new Date(start + (i + 1) * 1800000).toISOString(),
  value_inc_vat: price,
}));

function fixture() {
  const f = {
    now: start, stored: null, prices: [5, 15, 30, 30], fresh, decisions: [], edges: [], errors: [], timers: new Map(), id: 0,
  };
  f.options = {
    now: () => f.now,
    load: () => f.stored,
    save: async (state) => {
      f.stored = structuredClone(state);
    },
    snapshot: () => ({ rows: rows(f.prices), fresh: f.fresh }),
    emit: async (edge) => {
      f.edges.push(edge);
    },
    emitDecision: async (state, now) => {
      assert.ok(f.stored === null || f.stored.decisionKey.startsWith(describeChargingPlan(state, now).decision));
      f.decisions.push(describeChargingPlan(state, now).decision);
    },
    error: (err) => f.errors.push(err),
    host: {
      setTimeout: (fn) => {
        f.id += 1; f.timers.set(f.id, fn); return f.id;
      },
      clearTimeout: (id) => f.timers.delete(id),
    },
  };
  f.controller = new ChargingPlanController(f.options);
  return f;
}

test('initial setup emits once; repeated refresh and restart do not replay', async () => {
  const f = fixture();
  await f.controller.configure(policy);
  await Promise.all([f.controller.update(), f.controller.update()]);
  f.controller.stop();
  await new ChargingPlanController(f.options).update();
  assert.deepEqual(f.decisions, ['eligible_preferred']);
  assert.deepEqual(f.edges, ['started']);
  assert.equal(f.timers.size, 1);
});

test('legacy plans seed silently without a historical diagnostic announcement', async () => {
  const f = fixture();
  f.stored = reconcileChargingPlan(null, policy, rows(f.prices), fresh, start).state;
  await f.controller.update();
  assert.deepEqual(f.decisions, []);
  assert.match(f.stored.decisionKey, /^eligible_preferred:/);
  f.now += 1800000;
  await f.controller.update();
  assert.deepEqual(f.decisions, ['eligible_fallback']);
});

test('adjacent same-decision slots stay quiet; preferred/fallback and completion are distinct', async () => {
  const f = fixture();
  await f.controller.configure({ ...policy, duration: 1.5 });
  // Insufficient permitted capacity initially.
  assert.deepEqual(f.decisions, ['insufficient_capacity']);
  f.prices = [5, 5, 15, 30];
  await f.controller.update();
  f.now += 1800000;
  await f.controller.update();
  assert.deepEqual(f.decisions, ['insufficient_capacity', 'eligible_preferred']);
  f.now += 1800000;
  await f.controller.update();
  f.now += 1800000;
  await f.controller.update();
  assert.deepEqual(f.decisions, ['insufficient_capacity', 'eligible_preferred', 'eligible_fallback', 'duration_complete']);
});

test('unknown repeats are silent and recovered prices/deadline/cancellation each notify once', async () => {
  const f = fixture();
  f.prices = [];
  await f.controller.configure(policy);
  await f.controller.update();
  assert.deepEqual(f.decisions, ['waiting_for_prices']);
  f.prices = [30, 30, 5, 5];
  await f.controller.update();
  assert.deepEqual(f.decisions, ['waiting_for_prices', 'waiting_for_slot']);
  f.now = policy.deadline;
  await f.controller.update();
  await f.controller.update();
  await f.controller.cancel();
  await f.controller.cancel();
  await new ChargingPlanController(f.options).update();
  assert.deepEqual(f.decisions, ['waiting_for_prices', 'waiting_for_slot', 'deadline_passed', 'not_configured']);
});

test('whole-plan fallback changes matter while unchanged numeric prices/countdowns do not', async () => {
  const f = fixture();
  f.prices = [30, 30, 5, 5];
  await f.controller.configure(policy);
  f.now += 60000;
  f.prices = [31, 29, 4, 6];
  await f.controller.update();
  assert.equal(f.decisions.length, 1);
  f.prices = [30, 15, 30, 5];
  await f.controller.update();
  assert.deepEqual(f.decisions, ['waiting_for_slot', 'waiting_for_slot']);
  assert.equal(f.stored.selection, 'fallback');
});

test('failed persistence emits nothing; failed notification cannot break lifecycle or replay', async () => {
  const f = fixture();
  const fail = new ChargingPlanController({
    ...f.options,
    save: async () => {
      throw new Error('disk');
    },
  });
  await assert.rejects(fail.configure(policy), /disk/);
  assert.equal(f.decisions.length, 0);
  const crash = new ChargingPlanController({
    ...f.options,
    emitDecision: async () => {
      f.decisions.push('attempt'); throw new Error('notification');
    },
  });
  await crash.configure(policy);
  assert.deepEqual(f.edges, ['started']);
  assert.equal(f.errors.length, 1);
  await new ChargingPlanController(f.options).update();
  assert.deepEqual(f.decisions, ['attempt']);
});

test('stop during persistence cannot emit a new diagnostic or resurrect timers', async () => {
  const f = fixture();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const c = new ChargingPlanController({
    ...f.options,
    save: async (state) => {
      await gate; f.stored = state;
    },
  });
  const pending = c.configure(policy);
  await Promise.resolve();
  c.stop();
  release();
  await pending;
  assert.equal(f.decisions.length, 0);
  assert.equal(f.edges.length, 0);
  assert.equal(f.timers.size, 0);
});

test('decision events retain evaluation time when asynchronous lifecycle delivery crosses a slot', async () => {
  const f = fixture();
  const c = new ChargingPlanController({
    ...f.options,
    emit: async () => {
      f.now += 1800000;
    },
  });
  await c.configure(policy);
  assert.deepEqual(f.decisions, ['eligible_preferred']);
  assert.equal(f.stored.checkedAt, start);
});
