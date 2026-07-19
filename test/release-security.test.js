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

test('version automation opens a validated release PR instead of pushing main', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'homey-app-version.yml'),
    'utf8',
  );
  assert.match(workflow, /gh pr create/);
  assert.match(workflow, /statuses\/\$\{RELEASE_SHA\}/);
  assert.doesNotMatch(workflow, /git push origin HEAD --tags/);
  assert.doesNotMatch(workflow, /gh release create/);
});

test('post-merge release automation creates annotated tags', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'homey-app-release.yml'),
    'utf8',
  );
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /git tag -a/);
  assert.match(workflow, /gh release create/);
});
