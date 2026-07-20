'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normaliseDevices, isParticipating } = require('../.homeybuild/lib/dispatch/deviceModel.js');
const { classifyKind } = require('../.homeybuild/lib/dispatch/types.js');

const devicesFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'kraken', 'devices.json'), 'utf8'),
);

test('classifyKind fails closed to unknown', () => {
  assert.equal(classifyKind('SMART'), 'SMART');
  assert.equal(classifyKind('BOOST'), 'BOOST');
  assert.equal(classifyKind('FOO'), 'unknown');
  assert.equal(classifyKind(undefined), 'unknown');
});

test('normaliseDevices classifies the synthetic devices and their participation', () => {
  const devices = normaliseDevices(devicesFixture.data);
  assert.equal(devices.length, 2);
  const battery = devices.find((d) => d.category === 'BATTERY');
  const charger = devices.find((d) => d.category === 'CHARGE_POINT');
  assert.ok(battery);
  assert.ok(charger);
  assert.equal(battery.participating, true); // SMART_CONTROL_CAPABLE
  assert.equal(charger.participating, true); // SMART_CONTROL_IN_PROGRESS
});

test('a device without an id is skipped (fail closed)', () => {
  const devices = normaliseDevices({ devices: [{ __typename: 'SmartFlexChargePoint' }, { id: 'ok', __typename: 'SmartFlexVehicle' }] });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceId, 'ok');
  assert.equal(devices[0].category, 'EV');
});

test('an unknown device typename is kept as other/unknown, not dropped', () => {
  const devices = normaliseDevices({ devices: [{ id: 'x', __typename: 'SomethingNew', status: { currentState: 'IDLE' } }] });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].category, 'other');
  assert.equal(devices[0].participating, false);
});

test('isParticipating detects smart-flex control states', () => {
  assert.equal(isParticipating('SMART_CONTROL_IN_PROGRESS'), true);
  assert.equal(isParticipating('SMART_CONTROL_CAPABLE'), true);
  assert.equal(isParticipating('IDLE'), false);
  assert.equal(isParticipating(null), false);
});
