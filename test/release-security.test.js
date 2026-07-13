'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('package and Homey manifests share one version', () => {
  const pkg = require('../package.json');
  const compose = require('../.homeycompose/app.json');
  assert.equal(pkg.version, compose.version);
});

test('GitHub Actions are pinned to immutable commit SHAs', () => {
  const dir = path.join(__dirname, '..', '.github', 'workflows');
  for (const name of fs.readdirSync(dir)) {
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const match of body.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/g)) {
      assert.match(match[1], /^[a-f0-9]{40}$/, `${name} contains mutable action reference ${match[0]}`);
    }
  }
});
