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

test('repair leaves live power alone when it is inactive', async () => {
  const device = Object.create(ElectricityDevice.prototype);
  device.liveSubscribedAccount = null;
  device.getSetting = () => false;
  // Device-id caching now lives in the shared LiveDemandSource (invalidated via
  // the app on a credential change), so repair is a no-op when live power is off.
  await device.onCredentialsApplied();
  assert.equal(device.liveSubscribedAccount, null);
});
