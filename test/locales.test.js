'use strict';

// BL-28 — internationalisation. Guards that every runtime locale carries exactly
// the same key set as the English source, so no notification/error string can
// silently fall back to a missing translation (or leave a stale key behind).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function flatten(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) keys.push(...flatten(v, full));
    else keys.push(full);
  }
  return keys.sort();
}

function loadLocale(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${name}.json`), 'utf8'));
}

test('en is the source locale and is non-empty', () => {
  const en = loadLocale('en');
  assert.ok(flatten(en).length > 0, 'en.json must define runtime strings');
});

test('every additional locale has the same key set as en (no missing/extra keys)', () => {
  const enKeys = flatten(loadLocale('en'));
  const dir = path.join(__dirname, '..', 'locales');
  const others = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json');
  assert.ok(others.length > 0, 'at least one translated locale should exist');
  for (const file of others) {
    const keys = flatten(loadLocale(file.replace('.json', '')));
    assert.deepEqual(keys, enKeys, `${file} keys must match en.json exactly`);
  }
});

test('locale placeholders match across languages (same {tokens} per key)', () => {
  const tokens = (s) => (s.match(/\{[a-z]+\}/g) || []).sort();
  const walk = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k;
    return (v && typeof v === 'object') ? walk(v, full) : [[full, v]];
  });
  const en = Object.fromEntries(walk(loadLocale('en')));
  const dir = path.join(__dirname, '..', 'locales');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
    const other = Object.fromEntries(walk(loadLocale(file.replace('.json', ''))));
    for (const [key, value] of Object.entries(en)) {
      assert.deepEqual(tokens(other[key]), tokens(value), `${file}: placeholders for ${key} must match en`);
    }
  }
});
