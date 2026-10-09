'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateBatteryDuration } = require('../lib/planning/batteryDuration');

const now = Date.parse('2026-11-02T12:00:00Z');
const input = {
  currentSoc: 30,
  targetSoc: 80,
  capacity: 10,
  power: 2,
  efficiency: 90,
  readAt: '2026-11-02T11:58:00Z',
  maxAgeMinutes: 5,
};

test('SOC helper estimates usable stored energy, AC input and unrounded duration', () => {
  const before = JSON.stringify(input);
  const result = estimateBatteryDuration(input, now);
  assert.equal(result.stored_energy_kwh, 5);
  assert.equal(result.input_energy_kwh, 5 / 0.9);
  assert.equal(result.duration_hours, 5 / 0.9 / 2);
  assert.equal(result.needs_charge, true);
  assert.match(result.estimate_label, /constant AC power/);
  assert.match(result.estimate_label, /not measured/);
  assert.equal(JSON.stringify(input), before);
});

test('SOC target at/below current returns no charge, not a discharge instruction', () => {
  for (const targetSoc of [30, 0]) {
    const result = estimateBatteryDuration({ ...input, targetSoc }, now);
    assert.equal(result.duration_hours, 0);
    assert.equal(result.needs_charge, false);
    assert.equal(result.input_energy_kwh, 0);
  }
});

test('SOC helper rejects null, non-finite, invalid percentages, units and age policy', () => {
  for (const field of ['currentSoc', 'targetSoc', 'capacity', 'power', 'efficiency', 'maxAgeMinutes']) {
    for (const invalid of [null, undefined, NaN, Infinity, '10']) {
      assert.throws(() => estimateBatteryDuration({ ...input, [field]: invalid }, now));
    }
  }
  for (const patch of [{ currentSoc: -1 }, { targetSoc: 101 }, { capacity: 0 }, { power: -1 }, { efficiency: 0 }, { efficiency: 101 }, { maxAgeMinutes: 0.5 }, { maxAgeMinutes: 61 }]) {
    assert.throws(() => estimateBatteryDuration({ ...input, ...patch }, now));
  }
});

test('SOC helper requires an actual timezone-aware recent timestamp, including offsets', () => {
  for (const readAt of [null, '', 'invalid', '2026-11-02', '2026-11-02T11:58:00', '2026-11-02T12:00:01Z', '2026-11-02T11:54:59Z']) {
    assert.throws(() => estimateBatteryDuration({ ...input, readAt }, now), /reading/);
  }
  assert.ok(estimateBatteryDuration({ ...input, readAt: '2026-11-02T12:58:00+01:00' }, now).needs_charge);
  assert.ok(estimateBatteryDuration({ ...input, readAt: '2026-11-02T11:55:00Z' }, now).needs_charge);
  assert.throws(() => estimateBatteryDuration({ ...input, readAt: '2026-02-30T12:00:00Z' }, Date.parse('2026-03-02T12:00:00Z')), /reading/);
  assert.throws(() => estimateBatteryDuration({ ...input, readAt: '2026-11-01T24:00:00Z' }, Date.parse('2026-11-02T00:00:00Z')), /reading/);
});

test('SOC helper never silently truncates an impossible or overflowing duration', () => {
  for (const patch of [{ power: 0.001 }, { capacity: Number.MAX_VALUE }, { power: Number.MIN_VALUE }]) {
    assert.throws(() => estimateBatteryDuration({ ...input, ...patch }, now), /24-hour|valid/);
  }
  const result = estimateBatteryDuration({ ...input, efficiency: 100, power: 5 / 24 }, now);
  assert.equal(result.duration_hours, 24);
  assert.throws(() => estimateBatteryDuration({ ...input, capacity: 1000, power: 0.01 }, now), /24-hour/);
});
