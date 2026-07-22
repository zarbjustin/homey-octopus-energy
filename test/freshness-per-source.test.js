'use strict';

// BL-15: per-source freshness. Verifies getDataFreshness() reports each data
// source independently (so one stale domain isn't masked by the device-wide
// timestamp — R-017/BB-06), retains the last value, and backs the
// data_source_stale Flow condition.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { OctopusMeterDevice } = require('../.homeybuild/lib/OctopusMeterDevice.js');
const { opaqueKey } = require('../.homeybuild/lib/diagnosticsKey.js');
Module._load = originalLoad;

function settingsStore() {
  const map = new Map();
  return { get: (k) => map.get(k), set: (k, v) => map.set(k, v), _map: map };
}

function makeDevice(diag) {
  const settings = settingsStore();
  const device = Object.create(OctopusMeterDevice.prototype);
  device.homey = { settings };
  device.getData = () => ({ id: 'elec-1' });
  device.getSetting = (k) => (k === 'poll_interval' ? 30 : undefined); // maxAge = 75 min
  device.hasCapability = () => false;
  device.getCapabilityValue = () => null;
  device.lastHealthyRefreshAt = Date.now();
  device.diagnosticUpdates = {};
  const key = opaqueKey(device.homey, 'elec-1');
  settings.set('integration_diagnostics_v1', { [key]: diag });
  return device;
}

const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('getDataFreshness reports per-source state (current / stale / unknown) and retains last value', () => {
  const device = makeDevice({
    prices: { lastSuccess: ago(10 * 60_000) }, // 10 min → current
    carbon: { lastSuccess: ago(2 * 3600_000) }, // 2 h → stale (> 75 min)
    balance: { lastSuccess: ago(5 * 60_000) }, // current
    meter_data: { lastAttempt: new Date().toISOString() }, // no lastSuccess → unknown
  });

  const f = device.getDataFreshness();
  assert.equal(f.sources.prices.state, 'current');
  assert.equal(f.sources.carbon.state, 'stale');
  assert.equal(f.sources.balance.state, 'current');
  assert.equal(f.sources.meter_data.state, 'unknown');
  // A stale source keeps its last-known timestamp (never blanked) — the R-018 antidote.
  assert.ok(f.sources.carbon.updatedAt, 'stale source retains its last update time');
  assert.ok(f.sources.carbon.ageMs > 75 * 60_000, 'age is exposed');
  assert.equal(f.sources.meter_data.updatedAt, null, 'unknown source has no timestamp');
});

test('isDataSourceStale maps friendly ids and treats unknown as not-stale; any = worst source', () => {
  const device = makeDevice({
    prices: { lastSuccess: ago(10 * 60_000) }, // current
    carbon: { lastSuccess: ago(2 * 3600_000) }, // stale
    meter_data: { lastAttempt: new Date().toISOString() }, // unknown
  });

  assert.equal(device.isDataSourceStale('carbon'), true, 'stale carbon source');
  assert.equal(device.isDataSourceStale('price'), false, 'fresh price source');
  assert.equal(device.isDataSourceStale('consumption'), false, 'unknown is not stale (no last value)');
  assert.equal(device.isDataSourceStale('any'), true, 'any = true when a monitored source is stale');
});

test('isDataSourceStale any = false when every source is current', () => {
  const device = makeDevice({
    prices: { lastSuccess: ago(5 * 60_000) },
    carbon: { lastSuccess: ago(5 * 60_000) },
  });
  assert.equal(device.isDataSourceStale('any'), false);
});

test('in-flight cycle diagnostics do not erase a persisted lastSuccess for a failed source', () => {
  const device = makeDevice({ prices: { lastSuccess: ago(10 * 60_000) } });
  // Current cycle attempted prices but failed (no fresh lastSuccess yet).
  device.diagnosticUpdates = { prices: { lastAttempt: new Date().toISOString(), lastError: 'boom' } };
  const f = device.getDataFreshness();
  assert.equal(f.sources.prices.state, 'current', 'persisted lastSuccess is retained across a failed cycle');
});
