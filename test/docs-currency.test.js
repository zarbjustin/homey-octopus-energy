'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const S47_CARDS = [
  'find_cheapest_slot_advanced', 'plan_charge_advanced', 'analyse_price_day',
  'relative_price_band_is', 'find_peak_export_slot_advanced', 'plan_export_advanced',
];

test('README documents the current 1.0.17 release, not a stale version', () => {
  const readme = read('README.md');
  assert.match(readme, /1\.0\.17/);
  assert.doesNotMatch(readme, /Version `1\.0\.14`/);
  assert.match(readme, /estimated .*effective rate/i, 'documents the opt-in IOG effective-rate estimate');
});

test('README lists the Sprint 47 advanced Flow cards by id', () => {
  const readme = read('README.md');
  for (const id of S47_CARDS) assert.ok(readme.includes(id), `README should mention ${id}`);
});

test('README release version matches package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(read('README.md').includes(pkg.version), `README should mention ${pkg.version}`);
});

test('the IOG price-gap recovery is never claimed as production-proven', () => {
  const doc = read('docs/reviews/import-price-gap-handover.md');
  assert.match(doc, /not (yet )?field-?(confirmed|verified)/i, 'the field gate must remain explicit');
  assert.doesNotMatch(doc, /production-proven|confirmed fixed/i);
});
