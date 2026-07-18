'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Driver: class Driver {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDriver } = require('../.homeybuild/lib/OctopusMeterDriver.js');
const { OctopusClient } = require('../.homeybuild/lib/OctopusClient.js');
Module._load = originalLoad;

test('repair refuses to rebind a device to a different meter serial', async (t) => {
  t.mock.method(OctopusClient.prototype, 'discoverMeters', async () => [{
    fuel: 'electricity', mpxn: '111', serial: 'replacement', isExport: false,
    tariffCode: 'E-1R-AGILE-C', productCode: 'AGILE',
  }]);
  const driver = Object.create(OctopusMeterDriver.prototype);
  driver.fuel = 'electricity';
  let login;
  const session = { setHandler: (name, handler) => { if (name === 'login') login = handler; } };
  const writes = [];
  const device = {
    getStoreValue: (key) => ({ mpxn: '111', serial: 'original' }[key]),
    setStoreValue: async (...args) => { writes.push(args); },
  };
  await driver.onRepair(session, device);
  await assert.rejects(() => login({ apiKey: 'key', account: 'A-ONE' }), /original meter was not found/);
  assert.equal(writes.length, 0);
});

test('repair applies validated credentials through the meter device lifecycle', async (t) => {
  t.mock.method(OctopusClient.prototype, 'discoverMeters', async () => [{
    fuel: 'electricity', mpxn: '111', serial: 'original', isExport: false,
    tariffCode: 'E-1R-FIXED-A', productCode: 'FIXED',
  }]);
  const driver = Object.create(OctopusMeterDriver.prototype);
  driver.fuel = 'electricity';
  let login;
  const session = { setHandler: (name, handler) => { if (name === 'login') login = handler; } };
  let applied;
  const device = {
    getStoreValue: (key) => ({ mpxn: '111', serial: 'original' }[key]),
    applyCredentials: async (store) => { applied = store; },
  };

  await driver.onRepair(session, device);
  const result = await login({ apiKey: 'new-key', account: 'a-one' });

  assert.deepEqual(result, { done: true });
  assert.equal(applied.apiKey, 'new-key');
  assert.equal(applied.accountNumber, 'A-ONE');
  assert.equal(applied.tariffCode, 'E-1R-FIXED-A');
});

test('every declared repair view exists and completes rather than entering pairing', () => {
  for (const driver of ['electricity', 'gas', 'export']) {
    const root = path.join(__dirname, '..', 'drivers', driver);
    const compose = JSON.parse(fs.readFileSync(path.join(root, 'driver.compose.json'), 'utf8'));
    for (const view of compose.repair) {
      const file = path.join(root, 'repair', `${view.id}.html`);
      assert.equal(fs.existsSync(file), true, `${driver} repair view ${view.id} is missing`);
      const html = fs.readFileSync(file, 'utf8');
      assert.match(html, /Homey\.emit\('login'/);
      assert.match(html, /Homey\.done\(\)/);
      assert.doesNotMatch(html, /showView\('list_devices'/);
    }
  }
});

test('pairing rejects malformed account numbers before making a request', async () => {
  const driver = Object.create(OctopusMeterDriver.prototype);
  driver.fuel = 'electricity';
  const handlers = {};
  await driver.onPair({ setHandler: (name, handler) => { handlers[name] = handler; } });
  await assert.rejects(
    () => handlers.login({ apiKey: 'key', account: 'not-an-account' }),
    /should look like A-/,
  );
});

test('manual pairing requires all fields and validates the account credentials', async (t) => {
  let accountChecks = 0;
  t.mock.method(OctopusClient.prototype, 'getAccount', async () => {
    accountChecks += 1;
    return { number: 'A-ONE', properties: [] };
  });
  const driver = Object.create(OctopusMeterDriver.prototype);
  driver.fuel = 'electricity';
  const handlers = {};
  await driver.onPair({ setHandler: (name, handler) => { handlers[name] = handler; } });

  await assert.rejects(() => handlers.login({
    apiKey: 'key', account: 'A-ONE', manual_mpxn: '1234567890123',
  }), /requires the meter number, serial number, and full tariff code/);

  assert.equal(await handlers.login({
    apiKey: 'key',
    account: 'A-ONE',
    manual_mpxn: '1234567890123',
    manual_serial: 'SERIAL-1',
    manual_tariff: 'E-1R-AGILE-A',
  }), true);
  assert.equal(accountChecks, 1);
  const devices = await handlers.list_devices();
  assert.equal(devices[0].store.mpxn, '1234567890123');
});
