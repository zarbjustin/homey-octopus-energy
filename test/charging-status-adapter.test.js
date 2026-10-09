'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { reconcileChargingPlan, CHARGING_PLAN_DECISIONS } = require('../lib/planning/chargingPlan');

const load = Module._load;
Module._load = function mock(request, parent, main) {
  if (request === 'homey') return { Device: class Device {}, Driver: class Driver {} };
  return load.call(this, request, parent, main);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice');
const Driver = require('../.homeybuild/drivers/electricity/driver');

Module._load = load;

const start = Date.parse('2026-11-02T12:00:00Z');
const rates = (prices) => prices.map((price, i) => ({
  valid_from: new Date(start + i * 1800000).toISOString(),
  valid_to: new Date(start + (i + 1) * 1800000).toISOString(),
  value_inc_vat: price,
  value_exc_vat: price / 1.05,
}));
const policy = {
  mode: 'duration', price: 10, duration: 1, deadline: start + 7200000, fallback: true, maximum: 25,
};
const fresh = { current: true, until: start + 9000000 };
const forbid = () => {
  throw new Error('Read-only path must not poll, write, emit or control a battery');
};

function device(prices, source = 'current') {
  const d = Object.create(OctopusMeterDevice.prototype);
  d.rates = rates(prices);
  d.vatInc = () => true;
  d.getSetting = () => 60;
  d.getDataFreshness = () => ({ problem: false, sources: { prices: { state: source, updatedAt: new Date(start).toISOString() } } });
  const initial = reconcileChargingPlan(null, policy, d.rates, fresh, start).state;
  d.getStoreValue = () => initial;
  d.setStoreValue = forbid;
  d.refresh = forbid;
  d.client = new Proxy({}, { get: forbid });
  d.kraken = new Proxy({}, { get: forbid });
  d.homey = {
    clock: { getTimezone: () => 'Europe/London' },
    setTimeout: forbid,
    clearTimeout: forbid,
    flow: { getDeviceTriggerCard: forbid },
  };
  return d;
}

async function listeners() {
  const result = new Map();
  const driver = Object.create(Driver.prototype);
  const card = (id) => ({
    registerRunListener(fn) {
      result.set(id, fn); return this;
    },
  });
  driver.homey = { flow: { getDeviceTriggerCard: card, getConditionCard: card, getActionCard: card } };
  driver.log = () => {};
  await driver.onInit();
  return result;
}

test('capacity adapter uses selected meter, VAT, remaining time and absolute local deadline without I/O', () => {
  const originalNow = Date.now;
  Date.now = () => start + 1200000;
  try {
    const a = device([5, 10.2, 30, 30]);
    const b = device([30, 30, 30, 30]);
    assert.equal(a.hasEnoughThresholdTimeBefore(10, '14:00', 0.5), false);
    a.vatInc = () => false;
    assert.equal(a.hasEnoughThresholdTimeBefore(10, '14:00', 0.5), true);
    assert.equal(b.hasEnoughThresholdTimeBefore(10, '14:00', 0.1), false);
    assert.throws(() => a.hasEnoughThresholdTimeBefore(10, 'bad', 1), /deadline|HH:MM/i);
    assert.throws(() => a.hasEnoughThresholdTimeBefore(10, '14:00', 0), /valid duration/);
    assert.throws(() => a.hasEnoughThresholdTimeBefore(10, '16:00', 1), /complete fresh/);
  } finally {
    Date.now = originalNow;
  }
});

test('read-only status uses current time without changing the persisted budget or emitting an edge', () => {
  const originalNow = Date.now;
  let now = start;
  Date.now = () => now;
  try {
    const d = device([5, 15, 30, 30]);
    const before = JSON.stringify(d.getStoreValue());
    assert.equal(d.getChargingPlanStatus().decision, 'eligible_preferred');
    now += 1800000;
    assert.equal(d.getChargingPlanStatus().decision, 'eligible_fallback');
    now += 1800000;
    assert.equal(d.getChargingPlanStatus().decision, 'duration_complete');
    assert.equal(d.getChargingPlanStatus().active, false);
    assert.equal(JSON.stringify(d.getStoreValue()), before);
    assert.match(d.getChargingPlanStatus().estimate_label, /not measured charging/);
  } finally {
    Date.now = originalNow;
  }
});

test('status diagnostics identify stale, unpublished and missing plans without fabricating none', () => {
  const originalNow = Date.now;
  Date.now = () => start;
  try {
    for (const d of [device([5, 15, 30, 30], 'stale'), device([5, 15])]) {
      const result = d.getChargingPlanStatus();
      assert.equal(result.decision, 'waiting_for_prices');
      assert.equal(result.status, 'unknown');
      assert.equal(result.active, false);
    }
    const d = device([5, 15, 30, 30]);
    d.getStoreValue = () => null;
    assert.equal(d.getChargingPlanStatus().decision, 'not_configured');
  } finally {
    Date.now = originalNow;
  }
});

test('new decision and capacity conditions propagate unknown errors even when their result would be inverted', async () => {
  const originalNow = Date.now;
  Date.now = () => start;
  try {
    const run = await listeners();
    for (const d of [device([5, 15, 30, 30], 'stale'), device([5, 15]), device([])]) {
      await assert.rejects(run.get('enough_threshold_time_before')({
        device: d, price: 10, duration: 1, by: '14:00',
      }), /complete fresh/);
      for (const decision of CHARGING_PLAN_DECISIONS) {
        await assert.rejects(run.get('charging_plan_decision_is')({ device: d, decision }), /unavailable|incomplete/);
      }
    }
    const d = device([5, 15, 30, 30]);
    d.getStoreValue = () => null;
    await assert.rejects(run.get('charging_plan_decision_is')({ device: d, decision: 'eligible_preferred' }), /not configured/);
    await assert.rejects(run.get('charging_plan_decision_is')({ device: d, decision: 'waiting_for_prices' }), /valid charging plan decision/);
  } finally {
    Date.now = originalNow;
  }
});

test('new condition listeners and diagnostic action return valid known decisions without commands', async () => {
  const originalNow = Date.now;
  Date.now = () => start;
  try {
    const run = await listeners();
    const d = device([5, 15, 30, 30]);
    assert.equal(await run.get('enough_threshold_time_before')({
      device: d, price: 10, duration: 0.5, by: '14:00',
    }), true);
    assert.equal(await run.get('enough_threshold_time_before')({
      device: d, price: 10, duration: 1, by: '14:00',
    }), false);
    assert.equal(await run.get('charging_plan_decision_is')({ device: d, decision: 'eligible_preferred' }), true);
    assert.equal(await run.get('charging_plan_decision_is')({ device: d, decision: 'eligible_fallback' }), false);
    assert.deepEqual(await run.get('get_charging_plan_status')({ device: d }), d.getChargingPlanStatus());
  } finally {
    Date.now = originalNow;
  }
});

test('Standard setup delegates identical policy to the same controller without returning Advanced output tags', async () => {
  const run = await listeners();
  const calls = [];
  const d = {
    configureChargingPlan: async (...args) => {
      calls.push(args);
      return {
        status: 'unknown', selection: 'unknown', active: false, slots: [],
      };
    },
  };
  const args = {
    device: d, mode: 'duration', price: 10, by: '16:00', duration: 3, fallback: 'on', maximum: 25,
  };
  assert.equal(await run.get('configure_charging_plan_standard')(args), undefined);
  const advanced = await run.get('configure_charging_plan')(args);
  assert.equal(advanced.status, 'unknown');
  assert.deepEqual(calls[0], calls[1]);
  d.configureChargingPlan = async () => {
    throw new Error('persist failed');
  };
  await assert.rejects(run.get('configure_charging_plan_standard')(args), /persist failed/);
});

test('manifest decision options match runtime and existing cards keep their outputs', () => {
  const compose = JSON.parse(fs.readFileSync(path.join(__dirname, '../drivers/electricity/driver.flow.compose.json'), 'utf8'));
  const condition = compose.conditions.find((c) => c.id === 'charging_plan_decision_is');
  assert.deepEqual(condition.args[0].values.map((v) => v.id), CHARGING_PLAN_DECISIONS);
  const standard = compose.actions.find((c) => c.id === 'configure_charging_plan_standard');
  const advanced = compose.actions.find((c) => c.id === 'configure_charging_plan');
  assert.deepEqual(standard.args, advanced.args);
  assert.equal(Object.hasOwn(standard, 'tokens'), false);
  assert.notEqual(standard.advanced, true);
  assert.equal(advanced.tokens.length, 4);
});

test('Standard and Advanced setup share persisted elapsed budget and do not replay an identical run', async () => {
  const originalNow = Date.now;
  let now = start;
  Date.now = () => now;
  try {
    const run = await listeners();
    const d = device([5, 15, 30, 30]);
    let stored = null;
    const events = [];
    const timers = new Map();
    let nextTimer = 0;
    d.getStoreValue = () => stored;
    d.setStoreValue = async (key, value) => {
      stored = structuredClone(value);
    };
    d.error = () => {};
    d.homey.setTimeout = (fn, ms) => {
      nextTimer += 1; timers.set(nextTimer, { fn, ms }); return nextTimer;
    };
    d.homey.clearTimeout = (id) => timers.delete(id);
    d.homey.flow.getDeviceTriggerCard = (id) => ({ trigger: async () => events.push(id) });
    const args = {
      device: d, mode: 'duration', price: 10, by: '14:00', duration: 1, fallback: 'on', maximum: 25,
    };
    await run.get('configure_charging_plan_standard')(args);
    assert.deepEqual(events, ['charging_plan_run_started', 'charging_plan_decision_changed']);
    now += 600000;
    await run.get('configure_charging_plan')(args);
    assert.equal(stored.usedMs, 600000);
    assert.equal(stored.policy.deadline, policy.deadline);
    assert.equal(d.getChargingPlanStatus().decision, 'eligible_preferred');
    assert.deepEqual(events, ['charging_plan_run_started', 'charging_plan_decision_changed']);
    assert.equal(timers.size, 1);
    now += 1200000;
    [...timers.values()][0].fn();
    await d.chargingController.queue;
    assert.equal(d.getChargingPlanStatus().decision, 'eligible_fallback');
    assert.deepEqual(events, ['charging_plan_run_started', 'charging_plan_decision_changed', 'charging_plan_decision_changed']);
    await run.get('cancel_charging_plan')({ device: d });
    assert.equal(stored, null);
    assert.equal(timers.size, 0);
    assert.deepEqual(events, ['charging_plan_run_started', 'charging_plan_decision_changed', 'charging_plan_decision_changed', 'charging_plan_run_ended', 'charging_plan_decision_changed']);
  } finally {
    Date.now = originalNow;
  }
});

test('unpublished prices wait until a cache update, then start only the selected current period', async () => {
  const originalNow = Date.now;
  Date.now = () => start;
  try {
    const run = await listeners();
    const d = device([15, 30]);
    let stored = null;
    const events = [];
    d.getStoreValue = () => stored;
    d.setStoreValue = async (key, value) => {
      stored = structuredClone(value);
    };
    d.error = () => {};
    d.homey.setTimeout = () => 1;
    d.homey.clearTimeout = () => {};
    d.homey.flow.getDeviceTriggerCard = (id) => ({ trigger: async () => events.push(id) });
    await run.get('configure_charging_plan_standard')({
      device: d, mode: 'duration', price: 10, by: '14:00', duration: 1, fallback: 'on', maximum: 25,
    });
    assert.equal(d.getChargingPlanStatus().decision, 'waiting_for_prices');
    assert.deepEqual(events, ['charging_plan_decision_changed']);
    d.rates = rates([15, 30, 5, 30]);
    await d.updateChargingPlanFromCache();
    assert.equal(d.getChargingPlanStatus().decision, 'eligible_fallback');
    assert.deepEqual(events, ['charging_plan_decision_changed', 'charging_plan_run_started', 'charging_plan_decision_changed']);
    assert.equal(stored.policy.deadline, policy.deadline);
    await d.updateChargingPlanFromCache();
    await run.get('get_charging_plan_status')({ device: d });
    assert.deepEqual(events, ['charging_plan_decision_changed', 'charging_plan_run_started', 'charging_plan_decision_changed']);
    await d.onUninit();
  } finally {
    Date.now = originalNow;
  }
});

test('summary and health adapters are cache-only, do not persist budgets and handle corrupt plans safely', () => {
  const originalNow = Date.now;
  Date.now = () => start;
  try {
    const d = device([5, 15, 30, 30]);
    d.getDispatchView = () => ({ eligibility: { state: 'ineligible' }, freshness: 'current' });
    const before = JSON.stringify(d.getStoreValue());
    const view = d.getChargingPlanView();
    assert.equal(view.remainingHours, 1);
    assert.equal(view.selectedHours, 1);
    assert.equal(view.slots.length, 2);
    assert.equal(d.getDataHealthView().items.at(-1).state, 'unsupported');
    assert.equal(JSON.stringify(d.getStoreValue()), before);
    const prior = d.getStoreValue();
    d.getStoreValue = () => ({ ...prior, checkedAt: start + 1000 });
    const bad = d.getChargingPlanView();
    assert.equal(bad.decision, 'unavailable');
    assert.deepEqual(bad.slots, []);
    assert.equal(bad.remainingHours, undefined);
    d.getStoreValue = () => null;
    assert.equal(d.getChargingPlanView().configured, false);
  } finally {
    Date.now = originalNow;
  }
});

test('SOC estimate Flow action returns explicit estimates and rejects stale input without device calls', async () => {
  const originalNow = Date.now;
  Date.now = () => start;
  try {
    const run = await listeners();
    const args = {
      device: new Proxy({}, { get: forbid }),
      currentSoc: 30,
      targetSoc: 80,
      capacity: 10,
      power: 2,
      efficiency: 90,
      readAt: new Date(start).toISOString(),
      maxAgeMinutes: 5,
    };
    const result = await run.get('estimate_battery_duration')(args);
    assert.equal(result.needs_charge, true);
    assert.equal(result.stored_energy_kwh, 5);
    assert.ok(result.duration_hours > 2.7);
    await assert.rejects(run.get('estimate_battery_duration')({ ...args, readAt: new Date(start - 3600000).toISOString() }), /too old/);
    assert.ok(await run.get('charging_plan_decision_changed')({ device: args.device }));
    const compose = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'drivers/electricity/driver.flow.compose.json'), 'utf8'));
    assert.deepEqual(compose.actions.find((c) => c.id === 'estimate_battery_duration').tokens.map((t) => t.name), Object.keys(result));
  } finally {
    Date.now = originalNow;
  }
});

test('Summary API shows the selected electricity plan and does not offer charging plans on gas/export', async () => {
  const api = require('../widgets/summary/api');
  const make = (id) => ({
    getData: () => ({ id }),
    getName: () => id,
    hasCapability: () => false,
    getChargingPlanView: () => ({ configured: true, decision: 'waiting_for_prices' }),
    getDataHealthView: () => ({ items: [] }),
  });
  const homey = { drivers: { getDriver: (id) => ({ getDevices: () => [make(id)] }) } };
  const electric = await api.getData({ homey, query: { id: 'electricity' } });
  assert.equal(electric.chargingPlan.decision, 'waiting_for_prices');
  for (const id of ['gas', 'export']) {
    const result = await api.getData({ homey, query: { id } });
    assert.equal(result.chargingPlan, null);
    assert.deepEqual(result.health, { items: [] });
  }
  assert.match((await api.getData({ homey, query: { id: 'missing' } })).error, /selected meter/);
});
