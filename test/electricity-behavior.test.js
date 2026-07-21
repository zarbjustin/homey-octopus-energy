'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') {
    return { Driver: class Driver {}, Device: class Device {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const ElectricityDriver = require('../.homeybuild/drivers/electricity/driver.js');
const ElectricityDevice = require('../.homeybuild/drivers/electricity/device.js');
Module._load = originalLoad;

test('good-time condition requires both price and carbon data', async () => {
  const conditions = new Map();
  const register = (target) => ({
    registerRunListener(listener) { target.listener = listener; return this; },
  });
  const driver = Object.create(ElectricityDriver.prototype);
  driver.homey = {
    flow: {
      getDeviceTriggerCard: () => register({}),
      getConditionCard: (id) => {
        const target = {};
        conditions.set(id, target);
        return register(target);
      },
      getActionCard: () => register({}),
    },
  };
  driver.log = () => {};
  await driver.onInit();

  const listener = conditions.get('good_now').listener;
  const device = {
    getCurrentPrice: () => 10,
    getCarbon: () => null,
  };
  assert.equal(await listener({ device, max_price: 15, max_carbon: 200 }), false);
  device.getCarbon = () => 100;
  assert.equal(await listener({ device, max_price: 15, max_carbon: 200 }), true);
});

test('plunge trigger and notification fire only when crossing below zero', async () => {
  const fired = [];
  const notifications = [];
  const device = Object.create(ElectricityDevice.prototype);
  device.previousPrice = -1;
  device.previousLevel = 'plunge';
  device.hasCapability = () => false;
  device.getPriceLevel = () => 'plunge';
  device.notifyEnabled = () => true;
  device.notify = async (message) => { notifications.push(message); };
  device.error = () => {};
  device.homey = {
    flow: {
      getDeviceTriggerCard: (id) => ({
        trigger: async (_target, tokens) => { fired.push({ id, tokens }); },
      }),
    },
  };

  await device.onPriceUpdated(-2, {});
  assert.equal(fired.filter((event) => event.id === 'price_plunge').length, 0);
  assert.equal(notifications.length, 0);

  device.previousPrice = 1;
  await device.onPriceUpdated(-2, {});
  assert.equal(fired.filter((event) => event.id === 'price_plunge').length, 1);
  assert.equal(notifications.length, 1);
});

test('smart-charge window is unknown when rates are present but none covers now (stale price)', async () => {
  const values = { octopus_smart_charge: true };
  const device = Object.create(ElectricityDevice.prototype);
  device.hasCapability = (c) => c === 'octopus_smart_charge' || c === 'octopus_charge_start';
  device.getCapabilityValue = (c) => (c in values ? values[c] : null);
  device.setCapabilityValue = async (c, v) => { values[c] = v; };
  device.error = () => {};
  device.currentPrice = 12.3; // stale value from a previous successful refresh
  const past = Date.now() - 3600_000;
  device.rates = [{ value_inc_vat: 12.3, value_exc_vat: 11.7, valid_from: new Date(past - 1800_000).toISOString(), valid_to: new Date(past).toISOString() }];

  await device.updateSmartCharge();
  assert.equal(values.octopus_smart_charge, null, 'no current-covering row → unknown, not a stale true/false');
  assert.equal(values.octopus_charge_start, '—');
});

test('repair leaves live power alone when it is inactive', async () => {
  const device = Object.create(ElectricityDevice.prototype);
  device.liveSubscribedAccount = null;
  device.getSetting = () => false;
  // Device-id caching now lives in the shared LiveDemandSource (invalidated via
  // the app on a credential change), so repair is a no-op when live power is off.
  await device.onCredentialsApplied();
  assert.equal(device.liveSubscribedAccount, null);
});

test('smart-charge window shows unknown (null) not a misleading No when price data is absent', async () => {
  const values = {};
  const device = Object.create(ElectricityDevice.prototype);
  device.hasCapability = (c) => c === 'octopus_smart_charge' || c === 'octopus_charge_start';
  device.getCapabilityValue = (c) => (c in values ? values[c] : null);
  device.setCapabilityValue = async (c, v) => { values[c] = v; };
  device.error = () => {};
  device.currentPrice = null; // no price resolved (IOG price gap)
  device.rates = [];

  await device.updateSmartCharge();
  assert.equal(values.octopus_smart_charge, null, 'window is unknown, not false');
  assert.equal(values.octopus_charge_start, '—');
});

test('smart-charge window computes normally once price data exists', async () => {
  const values = { octopus_smart_charge: null };
  const device = Object.create(ElectricityDevice.prototype);
  device.hasCapability = (c) => c === 'octopus_smart_charge' || c === 'octopus_charge_start';
  device.getCapabilityValue = (c) => (c in values ? values[c] : null);
  device.setCapabilityValue = async (c, v) => { values[c] = v; };
  device.error = () => {};
  device.getSetting = () => undefined;
  device.smartChargeMaxPrice = () => undefined;
  device.isInCheapestPlan = () => true;
  device.nextChargeStart = () => '01:30';
  device.trigger = () => {};
  device.currentPrice = 12.3;
  device.rates = [{ value_inc_vat: 12.3, value_exc_vat: 11.7, valid_from: new Date().toISOString(), valid_to: null }];

  await device.updateSmartCharge();
  assert.equal(values.octopus_smart_charge, true);
  assert.equal(values.octopus_charge_start, '01:30');
});
