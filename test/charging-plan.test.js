'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileChargingPlan, ChargingPlanController } = require('../lib/planning/chargingPlan');
const { nextLocalDeadline } = require('../.homeybuild/lib/timezone');

const start = Date.parse('2026-10-05T00:00:00Z');
const rows = (prices) => prices.map((price, i) => ({
  valid_from: new Date(start + i * 1800000).toISOString(),
  valid_to: new Date(start + (i + 1) * 1800000).toISOString(),
  value_inc_vat: price,
}));
const policy = {
  mode: 'all', price: 10, deadline: start + 7200000, duration: 0, fallback: false, maximum: 10,
};
const fresh = { current: true, until: start + 7200000 };

test('all-slot lifecycle keeps adjacent equal prices active and stops at each gap', () => {
  const prices = rows([5, 5, 20, 5]);
  let r = reconcileChargingPlan(null, policy, prices, fresh, start);
  assert.deepEqual(r.edges, ['started']);
  assert.equal(r.nextAt, start + 1800000);
  r = reconcileChargingPlan(r.state, policy, prices, fresh, start + 1800000);
  assert.deepEqual(r.edges, []);
  r = reconcileChargingPlan(r.state, policy, prices, fresh, start + 3600000);
  assert.deepEqual(r.edges, ['ended']);
  r = reconcileChargingPlan(r.state, policy, prices, fresh, start + 5400000);
  assert.deepEqual(r.edges, ['started']);
  r = reconcileChargingPlan(r.state, policy, prices, fresh, start + 7200000);
  assert.deepEqual(r.edges, ['ended']);
  assert.equal(r.state.status, 'expired');
});

test('mid-slot republication exits/enters only on real eligibility transitions', () => {
  let r = reconcileChargingPlan(null, policy, rows([5, 5, 5, 5]), fresh, start);
  r = reconcileChargingPlan(r.state, policy, rows([20, 5, 5, 5]), fresh, start + 60000);
  assert.deepEqual(r.edges, ['ended']);
  r = reconcileChargingPlan(r.state, policy, rows([5, 5, 5, 5]), fresh, start + 120000);
  assert.deepEqual(r.edges, ['started']);
  r = reconcileChargingPlan(r.state, policy, rows([5, 6, 7, 8]), fresh, start + 120000);
  assert.deepEqual(r.edges, []);
});

test('unavailable/stale data removes eligibility; recovery is not an empty success', () => {
  const prices = rows([5, 5, 5, 5]);
  let r = reconcileChargingPlan(null, policy, prices, fresh, start);
  r = reconcileChargingPlan(r.state, policy, [], fresh, start + 60000);
  assert.deepEqual(r.edges, ['ended']);
  assert.equal(r.state.status, 'unknown');
  r = reconcileChargingPlan(r.state, policy, prices, { ...fresh, until: start }, start + 120000);
  assert.equal(r.state.active, false);
  r = reconcileChargingPlan(r.state, policy, prices, fresh, start + 180000);
  assert.deepEqual(r.edges, ['started']);
});

test('duration budget persists through restart/replan and partial final stop', () => {
  const duration = {
    ...policy, mode: 'duration', duration: 0.75, fallback: true, maximum: 21,
  };
  const prices = rows([5, 15, 30, 30]);
  let r = reconcileChargingPlan(null, duration, prices, fresh, start);
  assert.equal(r.state.status, 'complete');
  r = reconcileChargingPlan(JSON.parse(JSON.stringify(r.state)), duration, prices, fresh, start + 1800000);
  assert.deepEqual(r.edges, []);
  assert.equal(r.state.usedMs, 1800000);
  assert.equal(r.nextAt, start + 2700000);
  r = reconcileChargingPlan(r.state, duration, prices, fresh, start + 2700000);
  assert.deepEqual(r.edges, ['ended']);
  assert.equal(r.state.reason, 'duration-complete');
  r = reconcileChargingPlan(r.state, duration, prices, fresh, start + 3600000);
  assert.deepEqual(r.edges, []);
});

test('replans preserve spent budget, hard caps and separated runs', () => {
  const p = {
    ...policy, mode: 'duration', duration: 1, fallback: true, maximum: 21,
  };
  let r = reconcileChargingPlan(null, p, rows([5, 30, 15, 30]), fresh, start);
  r = reconcileChargingPlan(r.state, p, rows([25, 30, 15, 5]), fresh, start + 600000);
  assert.deepEqual(r.edges, ['ended']);
  assert.equal(r.state.usedMs, 600000);
  assert.equal(r.state.slots.every((slot) => slot.price <= 21), true);
  assert.equal(r.state.slots.reduce((sum, slot) => sum + slot.end - slot.start, 0), 3000000);
});

test('insufficient capacity returns no eligible partial plan', () => {
  const p = {
    ...policy, mode: 'duration', duration: 2, fallback: false,
  };
  const r = reconcileChargingPlan(null, p, rows([5, 30, 30, 30]), fresh, start);
  assert.equal(r.state.status, 'insufficient');
  assert.equal(r.state.active, false);
  assert.deepEqual(r.state.slots, []);
});

test('deadline resolves midnight, ambiguous autumn and missing spring times explicitly', () => {
  assert.equal(new Date(nextLocalDeadline('00:00', 'Europe/London', Date.parse('2026-10-05T21:00:00Z'))).toISOString(), '2026-10-05T23:00:00.000Z');
  assert.equal(new Date(nextLocalDeadline('01:30', 'Europe/London', Date.parse('2026-10-25T00:40:00Z'))).toISOString(), '2026-10-25T01:30:00.000Z');
  assert.equal(new Date(nextLocalDeadline('01:30', 'Europe/London', Date.parse('2026-03-29T00:00:00Z'))).toISOString(), '2026-03-30T00:30:00.000Z');
  assert.throws(() => nextLocalDeadline('24:00', 'Europe/London', start));
});

test('controller serialises, persists before emission, owns local timers and cancels cleanly', async () => {
  let at = start;
  let stored = null;
  const events = [];
  const timers = new Map();
  let timerId = 0;
  const opts = {
    now: () => at,
    load: () => stored,
    save: async (state) => {
      stored = JSON.parse(JSON.stringify(state));
    },
    snapshot: () => ({ rows: rows([5, 30, 5, 30]), fresh }),
    emit: async (edge) => {
      events.push(edge); assert.ok(stored === null || stored.checkedAt === at);
    },
    host: {
      setTimeout(fn, ms) {
        timerId += 1; timers.set(timerId, { fn, ms }); return timerId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    error: (error) => {
      throw error;
    },
  };
  const controller = new ChargingPlanController(opts);
  await Promise.all([controller.configure(policy), controller.update(), controller.update()]);
  assert.deepEqual(events, ['started']);
  assert.equal(timers.size, 1);
  controller.stop();
  assert.equal(timers.size, 0);
  const restarted = new ChargingPlanController(opts);
  await restarted.update();
  assert.deepEqual(events, ['started']);
  at += 1800000;
  await restarted.update();
  assert.deepEqual(events, ['started', 'ended']);
  at += 1800000;
  await restarted.update();
  await restarted.cancel();
  assert.deepEqual(events, ['started', 'ended', 'started', 'ended']);
  assert.equal(stored, null);
  assert.equal(timers.size, 0);
});

test('failed persistence never emits and crash after attempt does not duplicate', async () => {
  let stored = null;
  let attempts = 0;
  const opts = {
    now: () => start,
    load: () => stored,
    snapshot: () => ({ rows: rows([5, 5, 5, 5]), fresh }),
    save: async () => {
      throw new Error('disk');
    },
    emit: async () => {
      attempts += 1;
    },
    host: { setTimeout: () => 1, clearTimeout: () => {} },
    error: () => {},
  };
  const failed = new ChargingPlanController(opts);
  await assert.rejects(failed.configure(policy), /disk/);
  assert.equal(attempts, 0);
  const crash = new ChargingPlanController({
    ...opts,
    save: async (state) => {
      stored = state;
    },
    emit: async () => {
      attempts += 1; throw new Error('delivery');
    },
  });
  await assert.rejects(crash.configure(policy), /delivery/);
  const restart = new ChargingPlanController({
    ...opts,
    save: async (state) => {
      stored = state;
    },
  });
  await restart.update();
  assert.equal(attempts, 1);
});

test('clock rollback and malformed persisted intervals fail closed', () => {
  const r = reconcileChargingPlan(null, policy, rows([5, 5, 5, 5]), fresh, start);
  assert.throws(() => reconcileChargingPlan(r.state, policy, [], fresh, start - 1), /clock/);
  assert.throws(() => reconcileChargingPlan({ ...r.state, slots: [{ start, end: NaN, price: 5 }] }, policy, [], fresh, start), /state/);
});

test('a failed Flow attempt is not retried and stop during persistence cannot resurrect timers', async () => {
  let stored = null;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let timers = 0;
  let events = 0;
  const controller = new ChargingPlanController({
    now: () => start,
    load: () => stored,
    save: async (state) => {
      await gate; stored = state;
    },
    snapshot: () => ({ rows: rows([5, 5, 5, 5]), fresh }),
    emit: async () => {
      events += 1;
    },
    host: {
      setTimeout: () => {
        timers += 1; return 1;
      },
      clearTimeout: () => {},
    },
    error: () => {},
  });
  const pending = controller.configure(policy);
  await Promise.resolve();
  controller.stop();
  release();
  await pending;
  assert.equal(timers, 0);
  assert.equal(events, 0);
});
