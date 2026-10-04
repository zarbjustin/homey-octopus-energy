'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileSessions, SESSION_LIMIT } = require('../.homeybuild/lib/sessionLifecycle');

const now = Date.parse('2026-10-25T00:00:00Z'); // UK DST transition
const event = (id, start = 60, end = 120, joined = true) => ({
  id,
  startAt: new Date(now + start * 60_000).toISOString(),
  endAt: new Date(now + end * 60_000).toISOString(),
  rewardPerKwh: 100,
  joined,
});
const announced = (r) => r.emissions.filter((e) => e.kind === 'announced');

for (const count of [51, 100, 500]) {
  test(`${count} expired history rows never emit, including restart`, () => {
    const feed = Array.from({ length: count }, (_, i) => event(`old-${i}`, -120, -60));
    let r = reconcileSessions(feed, undefined, now);
    assert.equal(r.counts.expired, count);
    for (let i = 0; i < 3; i += 1) {
      r = reconcileSessions(feed, JSON.parse(JSON.stringify(r.ledger)), now);
      assert.deepEqual(r.emissions, []);
    }
    assert.equal(r.ledger.records.length, 0);
  });
}

test('100 upcoming events survive repeats, duplicates, shuffle, restart and one new event', () => {
  const feed = Array.from({ length: 100 }, (_, i) => event(`new-${i}`));
  const first = reconcileSessions(feed, undefined, now);
  assert.equal(announced(first).length, 100);
  const repeat = reconcileSessions([...feed.reverse(), ...feed], JSON.parse(JSON.stringify(first.ledger)), now);
  assert.deepEqual(repeat.emissions, []);
  assert.equal(announced(reconcileSessions([...feed, event('extra')], repeat.ledger, now)).length, 1);
});

test('reschedule and legacy migration preserve announcement identity', () => {
  const first = reconcileSessions([event('known')], { known: ['known'], started: [], ended: [] }, now);
  assert.equal(announced(first).length, 0);
  const changed = reconcileSessions([event('known', 75, 135)], first.ledger, now);
  assert.equal(announced(changed).length, 0);
});

test('active first discovery is silent; only observed active events end', () => {
  const active = reconcileSessions([event('active', -10, 10)], undefined, now);
  assert.deepEqual(active.emissions, []);
  const ended = reconcileSessions([], active.ledger, now + 10 * 60_000);
  assert.deepEqual(ended.emissions.map((e) => e.kind), ['ended']);
  assert.deepEqual(reconcileSessions([], ended.ledger, now + 11 * 60_000).emissions, []);
  const upcoming = reconcileSessions([event('missed')], undefined, now);
  assert.deepEqual(reconcileSessions([event('missed')], upcoming.ledger, now + 121 * 60_000).emissions, []);
});

test('normal lifecycle, per-15-minute lead buckets and unjoined announcement gate', () => {
  let r = reconcileSessions([event('joined', 30, 90), event('unjoined', 30, 90, false)], undefined, now);
  assert.equal(announced(r).length, 2);
  assert.equal(r.emissions.filter((e) => e.kind === 'starting_soon').length, 1);
  r = reconcileSessions([event('joined', 30, 90)], r.ledger, now + 16 * 60_000);
  assert.deepEqual(r.emissions.map((e) => e.kind), ['starting_soon']);
  r = reconcileSessions([event('joined', 30, 90)], r.ledger, now + 30 * 60_000);
  assert.deepEqual(r.emissions.map((e) => e.kind), ['started']);
  r = reconcileSessions([], r.ledger, now + 90 * 60_000);
  assert.deepEqual(r.emissions.map((e) => e.kind), ['ended']);
});

test('malformed, conflicting rows and corrupt persistence fail closed', () => {
  const bad = { ...event('bad'), endAt: 'nonsense' };
  const conflict = [event('duplicate'), event('duplicate', 90, 150)];
  assert.deepEqual(reconcileSessions([bad, ...conflict], undefined, now).emissions, []);
  const seeded = reconcileSessions([event('quiet')], { records: [{}] }, now);
  assert.deepEqual(seeded.emissions, []);
  assert.equal(announced(reconcileSessions([event('quiet')], seeded.ledger, now)).length, 0);
});

test('safety overflow never evicts actionable entries or reannounces on restart', () => {
  const feed = Array.from({ length: SESSION_LIMIT + 10 }, (_, i) => event(`future-${i}`));
  const first = reconcileSessions(feed, undefined, now);
  assert.equal(announced(first).length, SESSION_LIMIT);
  assert.equal(first.counts.overflow, 10);
  const repeat = reconcileSessions(feed.reverse(), first.ledger, now);
  assert.equal(announced(repeat).length, 0);
  assert.equal(repeat.counts.overflow, 10);
  assert.equal(repeat.ledger.records.length, SESSION_LIMIT);
});

test('expired records prune by time without resurrecting history', () => {
  const r = reconcileSessions([event('pruned', -10, 10)], undefined, now);
  const pruned = reconcileSessions([event('pruned', -10, 10)], r.ledger, now + 25 * 3600_000);
  assert.equal(pruned.counts.pruned, 1);
  assert.equal(pruned.ledger.known.length, 0);
  assert.deepEqual(pruned.emissions, []);
});
