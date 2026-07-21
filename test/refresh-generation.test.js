'use strict';

// Tests for the BL-08 refresh generation/cancellation guard. When the 90s
// stuck-lock watchdog forces a reset, a second refresh starts while the first
// is still in flight; the stale one must not persist its (out-of-date)
// cumulative-meter cursor/total (R-004 double-count / regression).

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');
Module._load = originalLoad;

test('isStaleRefresh is false for the current generation and true for a superseded one', () => {
  const device = Object.create(OctopusMeterDevice.prototype);
  device.refreshGeneration = 7;
  assert.equal(device.isStaleRefresh(7), false);
  assert.equal(device.isStaleRefresh(6), true);
  assert.equal(device.isStaleRefresh(8), true);
});

function meterDevice() {
  const store = {};
  const caps = {};
  const device = Object.create(OctopusMeterDevice.prototype);
  device.store = () => ({ mpxn: '01', serial: '02', fuel: 'electricity', isExport: false });
  device.hasCapability = (c) => c === 'meter_power';
  device.client = {
    consumption: () => Promise.resolve([
      { interval_start: '2026-07-21T00:00:00Z', interval_end: '2026-07-21T00:30:00Z', consumption: 0.5 },
      { interval_start: '2026-07-21T00:30:00Z', interval_end: '2026-07-21T01:00:00Z', consumption: 0.7 },
    ]),
  };
  device.getStoreValue = (k) => store[k];
  device.setStoreValue = (k, v) => { store[k] = v; return Promise.resolve(); };
  device.setCapabilityValue = (k, v) => { caps[k] = v; return Promise.resolve(); };
  device.error = () => {};
  device._store = store;
  device._caps = caps;
  return device;
}

test('refreshConsumption persists the cumulative meter for the current generation', async () => {
  const device = meterDevice();
  device.refreshGeneration = 3;
  await device.refreshConsumption(3);
  assert.equal(device._store.cumulativeMeter, 1.2); // 0.5 + 0.7
  assert.equal(device._store.lastConsumptionEnd, '2026-07-21T01:00:00Z');
  assert.equal(device._caps.meter_power, 1.2);
});

test('a superseded refresh does NOT persist the cumulative meter (fenced)', async () => {
  const device = meterDevice();
  device.refreshGeneration = 4; // a newer refresh already started
  await device.refreshConsumption(3); // this stale generation must not write
  assert.equal(device._store.cumulativeMeter, undefined);
  assert.equal(device._store.lastConsumptionEnd, undefined);
  assert.equal(device._caps.meter_power, undefined);
});

test('the fence protects against double-counting when a stale refresh resumes after a newer one wrote', async () => {
  const device = meterDevice();
  // The current generation (5) already advanced the cursor/total.
  device.refreshGeneration = 5;
  device._store.cumulativeMeter = 1.2;
  device._store.lastConsumptionEnd = '2026-07-21T01:00:00Z';
  // A stale generation (4) resumes and tries to add the SAME records again.
  await device.refreshConsumption(4);
  // Fenced: the total is not double-counted (would have been 2.4 without the guard).
  assert.equal(device._store.cumulativeMeter, 1.2);
  assert.equal(device._store.lastConsumptionEnd, '2026-07-21T01:00:00Z');
});

test('overlapping commits of the same records serialize and do not double-count', async () => {
  const device = meterDevice();
  device.refreshGeneration = 1;
  // Two concurrent refreshes of the current generation. The commit queue runs
  // them one at a time and each re-reads the cursor, so the second adds nothing.
  await Promise.all([device.refreshConsumption(1), device.refreshConsumption(1)]);
  assert.equal(device._store.cumulativeMeter, 1.2); // not 2.4
  assert.equal(device._store.lastConsumptionEnd, '2026-07-21T01:00:00Z');
});

test('a refresh superseded WHILE another is pending does not double-count (watchdog race)', async () => {
  const device = meterDevice();
  device.refreshGeneration = 1;
  const pA = device.refreshConsumption(1); // in flight
  device.refreshGeneration = 2; // watchdog forces a new generation, superseding A
  const pB = device.refreshConsumption(2); // the current generation
  await Promise.all([pA, pB]);
  assert.equal(device._store.cumulativeMeter, 1.2); // B committed once; A was fenced
});

test('a commit in progress blocks a later commit until it finishes (no interleave)', async () => {
  const device = meterDevice();
  device.refreshGeneration = 1;
  let release;
  const gate = new Promise((res) => { release = res; });
  const store = device._store;
  let gatedFirstWrite = true;
  device.setStoreValue = async (k, v) => {
    if (gatedFirstWrite && k === 'lastConsumptionEnd') { gatedFirstWrite = false; await gate; }
    store[k] = v;
  };
  const pA = device.refreshConsumption(1);
  const pB = device.refreshConsumption(1);
  await new Promise((r) => setTimeout(r, 10)); // let A park on its gated first write
  assert.equal(store.cumulativeMeter, undefined); // A has not written the total yet
  release();
  await Promise.all([pA, pB]);
  assert.equal(store.cumulativeMeter, 1.2); // A committed; B re-read the advanced cursor -> no-op
});

test('a slow commit write still serializes a later commit — no interleave, no double-count', async () => {
  // Strict serialization (no forced timeout release): even a slow first write
  // makes the second commit wait, so it re-reads the advanced cursor and adds
  // nothing. This is the deliberate correctness-over-liveness choice for the
  // billing-relevant monotonic meter (Homey writes cannot be cancelled).
  const device = meterDevice();
  device.refreshGeneration = 1;
  const store = device._store;
  let slowFirst = true;
  device.setStoreValue = async (k, v) => {
    if (slowFirst && k === 'lastConsumptionEnd') {
      slowFirst = false;
      await new Promise((r) => setTimeout(r, 25)); // delayed, but does settle
    }
    store[k] = v;
  };
  const pA = device.refreshConsumption(1);
  const pB = device.refreshConsumption(1);
  await Promise.all([pA, pB]);
  assert.equal(store.cumulativeMeter, 1.2); // not 2.4 — B saw A's advanced cursor
  assert.equal(store.lastConsumptionEnd, '2026-07-21T01:00:00Z');
});
