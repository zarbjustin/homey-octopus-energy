'use strict';

// Characterization tests for DeviceScheduler — the refresh-timer owner extracted
// verbatim from OctopusMeterDevice (Phase 2 / S52 slice 2). They pin the timer
// behaviour so later refactors (e.g. BL-08 generation/cancellation safety) can
// prove no user-visible change.

const test = require('node:test');
const assert = require('node:assert/strict');

const { DeviceScheduler } = require('../.homeybuild/lib/DeviceScheduler.js');

const MIN = 60_000;

function fakeHost() {
  const host = {
    intervals: [],
    timeouts: [],
    setInterval(fn, ms) {
      const handle = { kind: 'interval', fn, ms, cleared: false };
      host.intervals.push(handle);
      return handle;
    },
    clearInterval(handle) {
      if (handle) handle.cleared = true;
    },
    setTimeout(fn, ms) {
      const handle = { kind: 'timeout', fn, ms, cleared: false };
      host.timeouts.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      if (handle) handle.cleared = true;
    },
  };
  return host;
}

function makeScheduler(host, config, overrides = {}) {
  const refreshCalls = [];
  const scheduler = new DeviceScheduler({
    host,
    refresh: () => {
      refreshCalls.push(Date.now());
      return Promise.resolve();
    },
    config: () => config,
    nextLocalTime: () => new Date(Date.now() + 3 * 3600_000),
    onError: () => {},
    now: () => new Date('2026-07-21T10:07:12.500Z'),
    ...overrides,
  });
  return { scheduler, refreshCalls };
}

test('non-dynamic tariff schedules only the poll interval', () => {
  const host = fakeHost();
  const { scheduler } = makeScheduler(host, {
    isDynamic: false, isAgile: false, pollIntervalMinutes: 30,
  });
  scheduler.start();

  assert.equal(host.intervals.length, 1);
  assert.equal(host.intervals[0].ms, 30 * MIN);
  assert.equal(host.timeouts.length, 0); // no aligned or agile ticks
});

test('poll interval is floored at 5 minutes', () => {
  const host = fakeHost();
  const { scheduler } = makeScheduler(host, {
    isDynamic: false, isAgile: false, pollIntervalMinutes: 1,
  });
  scheduler.start();
  assert.equal(host.intervals[0].ms, 5 * MIN);
});

test('dynamic non-Agile tariff schedules the interval and the aligned tick, but not the Agile publication', () => {
  const host = fakeHost();
  const { scheduler } = makeScheduler(host, {
    isDynamic: true, isAgile: false, pollIntervalMinutes: 30,
  });
  scheduler.start();

  assert.equal(host.intervals.length, 1);
  assert.equal(host.timeouts.length, 1); // aligned tick only
  // now = 10:07:12.500 -> next :30 boundary is 22m47.5s away, +2s = 1369500ms
  assert.equal(host.timeouts[0].ms, ((30 - 7) * MIN - 12 * 1000 - 500) + 2000);
});

test('Agile tariff also schedules the daily publication tick', () => {
  const host = fakeHost();
  const { scheduler } = makeScheduler(host, {
    isDynamic: true, isAgile: true, pollIntervalMinutes: 30,
  });
  scheduler.start();

  assert.equal(host.intervals.length, 1);
  assert.equal(host.timeouts.length, 2); // aligned tick + agile publication
});

test('stop() clears every scheduled timer', () => {
  const host = fakeHost();
  const { scheduler } = makeScheduler(host, {
    isDynamic: true, isAgile: true, pollIntervalMinutes: 30,
  });
  scheduler.start();
  scheduler.stop();

  assert.ok(host.intervals.every((t) => t.cleared));
  assert.ok(host.timeouts.every((t) => t.cleared));
});

test('start() clears the previous timers before scheduling new ones', () => {
  const host = fakeHost();
  const { scheduler } = makeScheduler(host, {
    isDynamic: true, isAgile: false, pollIntervalMinutes: 30,
  });
  scheduler.start();
  const firstInterval = host.intervals[0];
  const firstAligned = host.timeouts[0];

  scheduler.start(); // restart

  assert.equal(firstInterval.cleared, true);
  assert.equal(firstAligned.cleared, true);
  assert.equal(host.intervals.length, 2);
});

test('the aligned tick fires a refresh and reschedules itself', () => {
  const host = fakeHost();
  const { scheduler, refreshCalls } = makeScheduler(host, {
    isDynamic: true, isAgile: false, pollIntervalMinutes: 30,
  });
  scheduler.start();
  assert.equal(host.timeouts.length, 1);

  host.timeouts[0].fn(); // simulate the boundary firing

  assert.equal(refreshCalls.length, 1);
  assert.equal(host.timeouts.length, 2); // rescheduled the next aligned tick
});

test('a refresh rejection is routed to onError, not thrown', async () => {
  const host = fakeHost();
  const errors = [];
  const scheduler = new DeviceScheduler({
    host,
    refresh: () => Promise.reject(new Error('boom')),
    config: () => ({ isDynamic: true, isAgile: false, pollIntervalMinutes: 30 }),
    nextLocalTime: () => new Date(Date.now() + 3600_000),
    onError: (message, err) => errors.push({ message, err }),
    now: () => new Date('2026-07-21T10:00:00.000Z'),
  });
  scheduler.start();

  host.timeouts[0].fn();
  await Promise.resolve(); // let the rejected promise settle

  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Aligned refresh failed:');
});
