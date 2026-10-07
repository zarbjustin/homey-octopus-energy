'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const load = Module._load;
Module._load = function mock(request, parent, main) {
  if (request === 'homey') return { Device: class Device {}, Driver: class Driver {} };
  return load.call(this, request, parent, main);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice');
const Driver = require('../.homeybuild/drivers/electricity/driver');
const ElectricityDevice = require('../.homeybuild/drivers/electricity/device');

Module._load = load;

test('selected meter adapter uses cached source freshness and respects VAT', () => {
  const at = Date.parse('2026-10-05T00:10:00Z');
  const device = Object.create(OctopusMeterDevice.prototype);
  device.getDataFreshness = () => ({ problem: false, sources: { prices: { state: 'current' } } });
  device.vatInc = () => false;
  device.rates = [0, 1, 2].map((n) => ({
    valid_from: new Date(at - 600000 + n * 1800000).toISOString(),
    valid_to: new Date(at - 600000 + (n + 1) * 1800000).toISOString(),
    value_inc_vat: 12,
    value_exc_vat: 9,
  }));
  assert.equal(device.getThresholdSlots(10, 1, at).slots.length, 3);
  device.vatInc = () => true;
  assert.equal(device.getThresholdSlots(10, 1, at).status, 'none');
  device.getDataFreshness = () => ({ problem: false, sources: { prices: { state: 'stale' } } });
  assert.throws(() => device.getThresholdSlots(10, 1, at), /unavailable/);
});

test('new condition listeners propagate unknown instead of false for inversion safety', async () => {
  const listeners = new Map();
  const driver = Object.create(Driver.prototype);
  const card = (id) => ({
    registerRunListener(fn) {
      listeners.set(id, fn); return this;
    },
  });
  driver.homey = { flow: { getDeviceTriggerCard: card, getConditionCard: card, getActionCard: card } };
  driver.log = () => {};
  await driver.onInit();
  const device = {
    getThresholdSlots: () => {
      throw new Error('unknown');
    },
    isInThresholdSlot: () => {
      throw new Error('unknown');
    },
    getConfiguredPriceBand: () => {
      throw new Error('unknown');
    },
    getThresholdSlotsBefore: () => {
      throw new Error('unknown');
    },
    getChargingPlanEligibility: () => {
      throw new Error('unknown');
    },
  };
  for (const id of ['threshold_slots_available', 'in_threshold_slot', 'configured_price_band', 'threshold_slots_before', 'charging_plan_active']) {
    await assert.rejects(listeners.get(id)({
      device, price: 10, within: 1, band: 'green',
    }), /unknown/);
  }
});

test('configured plans reconcile through selected-meter cache only, including timers and restart', async () => {
  const originalNow = Date.now;
  let at = Date.parse('2026-10-05T00:00:00Z');
  Date.now = () => at;
  try {
    const make = (store, price) => {
      const d = Object.create(OctopusMeterDevice.prototype);
      d.vatInc = () => true;
      d.getSetting = () => 30;
      d.getDataFreshness = () => ({ problem: false, sources: { prices: { state: 'current', updatedAt: '2026-10-05T00:00:00Z' } } });
      d.rates = [0, 1, 2, 3].map((i) => ({
        valid_from: new Date(Date.parse('2026-10-05T00:00:00Z') + i * 1800000).toISOString(),
        valid_to: new Date(Date.parse('2026-10-05T00:00:00Z') + (i + 1) * 1800000).toISOString(),
        value_inc_vat: price,
      }));
      d.getStoreValue = (key) => store.get(key);
      d.setStoreValue = async (key, value) => store.set(key, value);
      d.error = () => {};
      d.client = new Proxy({}, {
        get() {
          throw new Error('Network access forbidden');
        },
      });
      d.events = [];
      d.homey = {
        clock: { getTimezone: () => 'Europe/London' },
        setTimeout: (fn, ms) => {
          d.timer = { fn, ms }; return 1;
        },
        clearTimeout: () => {
          d.timer = null;
        },
        flow: { getDeviceTriggerCard: (id) => ({ trigger: async () => d.events.push(id) }) },
      };
      return d;
    };
    const store = new Map();
    const a = make(store, 5);
    const b = make(new Map(), 30);
    assert.equal(a.getThresholdSlotsBefore(10, '02:00').status, 'some');
    assert.equal(b.getThresholdSlotsBefore(10, '02:00').status, 'none');
    await a.configureChargingPlan('duration', 10, '02:00', 0.25, 'off', 21);
    assert.equal(a.getChargingPlanEligibility(), true);
    assert.deepEqual(a.events, ['charging_plan_run_started']);
    assert.equal(a.timer.ms, 900000);
    const restarted = make(store, 5);
    await restarted.updateChargingPlanFromCache();
    assert.deepEqual(restarted.events, []);
    at += 900000;
    restarted.timer.fn();
    await restarted.chargingController.queue;
    assert.equal(restarted.getChargingPlanEligibility(), false);
    assert.deepEqual(restarted.events, ['charging_plan_run_ended']);
    assert.throws(() => b.getChargingPlanEligibility(), /No charging plan/);
    await restarted.onUninit();
    assert.equal(restarted.timer, null);
  } finally {
    Date.now = originalNow;
  }
});

test('threshold candidates follow adjacent slot edges, persist attempts, and seed on restart', async () => {
  const device = Object.create(ElectricityDevice.prototype);
  const fired = [];
  const store = new Map();
  device.getStoreValue = (key) => store.get(key);
  device.setStoreValue = async (key, value) => store.set(key, value);
  device.getPriceLevel = () => 'normal';
  device.hasCapability = () => false;
  device.notifyEnabled = () => false;
  device.previousPrice = null;
  device.previousOptimiserSlot = null;
  device.error = () => {};
  device.homey = { flow: { getDeviceTriggerCard: (id) => ({ trigger: async () => fired.push(id) }) } };
  const rate = (n) => ({
    valid_from: new Date(1791158400000 + n * 1800000).toISOString(),
    valid_to: new Date(1791158400000 + (n + 1) * 1800000).toISOString(),
  });
  await device.onPriceUpdated(10, rate(0));
  assert.equal(fired.filter((id) => id.startsWith('threshold_slot')).length, 0);
  await device.onPriceUpdated(10, rate(1));
  await device.onPriceUpdated(10, rate(1));
  assert.equal(fired.filter((id) => id.startsWith('threshold_slot')).length, 2);
  await device.onPriceUpdated(10, rate(3));
  assert.equal(fired.filter((id) => id.startsWith('threshold_slot')).length, 2);
  device.thresholdEdgeBaseline = null;
  await device.onPriceUpdated(10, rate(3));
  assert.equal(fired.filter((id) => id.startsWith('threshold_slot')).length, 2);
  assert.equal(fired.filter((id) => id === 'price_changed').length, 0);
  assert.equal(fired.filter((id) => id === 'cheapest_slot_started').length, 0);
  await device.onPriceUpdated(11, rate(4));
  assert.equal(fired.filter((id) => id === 'price_changed').length, 1);
  assert.equal(fired.filter((id) => id === 'cheapest_slot_started').length, 1);
});

test('future cheap availability does not grant current eligibility or emit an early plan start', async () => {
  const originalNow = Date.now;
  const start = Date.parse('2026-11-02T00:00:00Z');
  let at = start;
  Date.now = () => at;
  try {
    const device = Object.create(OctopusMeterDevice.prototype);
    const store = new Map();
    const events = [];
    const timers = new Map();
    let timerId = 0;
    device.vatInc = () => true;
    device.getSetting = () => 60;
    device.getDataFreshness = () => ({ problem: false, sources: { prices: { state: 'current', updatedAt: new Date(start).toISOString() } } });
    device.rates = [29, 18, 18, 29].map((value, i) => ({
      valid_from: new Date(start + i * 1800000).toISOString(),
      valid_to: new Date(start + (i + 1) * 1800000).toISOString(),
      value_inc_vat: value,
    }));
    device.getStoreValue = (key) => store.get(key);
    device.setStoreValue = async (key, value) => store.set(key, value);
    device.error = () => {};
    device.refresh = () => {
      throw new Error('Provider refresh forbidden');
    };
    device.client = new Proxy({}, {
      get() {
        throw new Error('Network forbidden');
      },
    });
    device.homey = {
      clock: { getTimezone: () => 'Europe/London' },
      setTimeout: (fn, ms) => {
        timerId += 1; timers.set(timerId, { fn, ms }); return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
      flow: { getDeviceTriggerCard: (id) => ({ trigger: async () => events.push(id) }) },
    };
    assert.equal(device.getThresholdSlotsBefore(20, '02:00').status, 'some');
    assert.equal(device.isInThresholdSlot(20, 1), false);
    await device.configureChargingPlan('all', 20, '02:00', 1, 'off', 20);
    assert.equal(device.getChargingPlanEligibility(), false);
    assert.deepEqual(events, []);
    assert.equal([...timers.values()][0].ms, 1800000);
    const tick = async (time) => {
      at = time;
      [...timers.values()][0].fn();
      await device.chargingController.queue;
    };
    await tick(start + 1800000);
    assert.equal(device.getChargingPlanEligibility(), true);
    assert.deepEqual(events, ['charging_plan_run_started']);
    await tick(start + 3600000);
    assert.equal(device.getChargingPlanEligibility(), true);
    assert.deepEqual(events, ['charging_plan_run_started']); // Equal-priced adjacency stays active.
    await tick(start + 5400000);
    assert.equal(device.getChargingPlanEligibility(), false);
    assert.deepEqual(events, ['charging_plan_run_started', 'charging_plan_run_ended']);
    await device.onUninit();
    assert.equal(timers.size, 0);
  } finally {
    Date.now = originalNow;
  }
});

test('a late battery event can check current plan eligibility without replaying the plan start', async () => {
  const { reconcileChargingPlan } = require('../lib/planning/chargingPlan');
  const originalNow = Date.now;
  const start = Date.parse('2026-11-02T00:00:00Z');
  let at = start;
  Date.now = () => at;
  try {
    const listeners = new Map();
    const driver = Object.create(Driver.prototype);
    const card = (id) => ({
      registerRunListener(fn) {
        listeners.set(id, fn); return this;
      },
    });
    driver.homey = { flow: { getDeviceTriggerCard: card, getConditionCard: card, getActionCard: card } };
    driver.log = () => {};
    await driver.onInit();
    const device = Object.create(OctopusMeterDevice.prototype);
    device.rates = [18, 18, 29, 29].map((value, i) => ({
      valid_from: new Date(start + i * 1800000).toISOString(),
      valid_to: new Date(start + (i + 1) * 1800000).toISOString(),
      value_inc_vat: value,
    }));
    device.vatInc = () => true;
    device.getSetting = () => 60;
    let source = 'current';
    device.getDataFreshness = () => ({ problem: false, sources: { prices: { state: source, updatedAt: new Date(start).toISOString() } } });
    const policy = {
      mode: 'all', price: 20, deadline: start + 7200000, duration: 0, fallback: false, maximum: 20,
    };
    const initial = reconcileChargingPlan(null, policy, device.rates, { current: true, until: start + 9000000 }, start);
    device.getStoreValue = () => initial.state;
    device.setStoreValue = () => {
      throw new Error('Condition must not write or emit');
    };
    device.refresh = () => {
      throw new Error('Condition must not refresh');
    };
    assert.deepEqual(initial.edges, ['started']);
    let batteryLow = false;
    let simulatedStarts = 0;
    const evaluateStart = async () => {
      if (batteryLow && await listeners.get('charging_plan_active')({ device })) simulatedStarts += 1;
    };
    await evaluateStart();
    assert.equal(simulatedStarts, 0); // Battery was not low at the period start.
    at += 600000;
    batteryLow = true;
    await evaluateStart(); // A separate battery-low trigger runs the same current condition.
    assert.equal(simulatedStarts, 1);
    const later = reconcileChargingPlan(initial.state, policy, device.rates, { current: true, until: start + 9000000 }, at);
    assert.deepEqual(later.edges, []); // No second plan-start event is required.
    at = start + 3600000;
    await evaluateStart();
    assert.equal(simulatedStarts, 1); // A later battery event outside selected time cannot start.
    source = 'stale';
    await assert.rejects(evaluateStart(), /unavailable|stale/);
    assert.equal(simulatedStarts, 1);
  } finally {
    Date.now = originalNow;
  }
});

test('run listeners suppress adjacent qualifying slots and detect expensive gaps', async () => {
  const listeners = new Map();
  const driver = Object.create(Driver.prototype);
  const card = (id) => ({
    registerRunListener(fn) {
      listeners.set(id, fn); return this;
    },
  });
  driver.homey = { flow: { getDeviceTriggerCard: card, getConditionCard: card, getActionCard: card } };
  driver.log = () => {};
  await driver.onInit();
  const args = { device: { getThresholdSlots: () => ({ status: 'some', slots: [] }) }, price: 10, within: 1 };
  assert.equal(await listeners.get('threshold_slot_started')(args, { previous: 20, price: 5 }), true);
  assert.equal(await listeners.get('threshold_slot_started')(args, { previous: 5, price: 5 }), false);
  assert.equal(await listeners.get('threshold_slot_ended')(args, { previous: 5, price: 10 }), true);
});
