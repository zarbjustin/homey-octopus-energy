'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const WIDGETS = ['summary', 'price', 'agile', 'carbon', 'export', 'timeline'];

function html(w) {
  return fs.readFileSync(path.join(root, 'widgets', w, 'public', 'index.html'), 'utf8');
}

/** Extract a `function NAME(...) { ... }` body by brace-matching. */
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// --- F1: every widget renders a consistent, namespaced provenance badge ------

for (const w of WIDGETS) {
  test(`${w} widget renders the shared provenance convention`, () => {
    const src = html(w);
    assert.match(src, /function freshnessHtml\(d, sourceLabel\)/, 'canonical freshnessHtml signature');
    assert.match(src, /class="prov-badge /, 'namespaced provenance badge (no .badge collision)');
    assert.match(src, /'b-current'/, 'current state');
    assert.match(src, /'b-stale'/, 'stale state');
    assert.match(src, /'b-unknown'/, 'unknown state');
    assert.match(src, /freshnessHtml\(d, 'Device refresh'\)/, 'render passes an honest device-scoped source label');
  });
}

// App-derived recommendations/forecasts must be labelled as estimates; published
// forward tariff rows (timeline) must NOT be mislabelled as estimates.
for (const w of ['price', 'agile', 'carbon', 'export']) {
  test(`${w} widget labels its app-derived value as an estimate`, () => {
    assert.match(html(w), /estimatedBadge\('/, `${w} should mark its calculated value as an estimate`);
  });
}
test('timeline widget does not mislabel published forward prices as estimates', () => {
  assert.doesNotMatch(html('timeline'), /estimatedBadge\('/);
});

test('carbon widget labels only the forecast recommendation as an estimate', () => {
  const src = html('carbon');
  assert.match(src, /estimatedBadge\('Estimated forecast'\)/, 'greenest recommendation is a forecast estimate');
  // The measured/actual-or-forecast current intensity must NOT be flatly "Estimated".
  assert.doesNotMatch(src, /Estimated · Carbon API/);
});

// --- Behavioural check of the freshness helper (real code, real escaping) -----

function buildFreshness(w) {
  const src = html(w);
  const sandbox = { Date };
  vm.createContext(sandbox);
  for (const fn of ['esc', 'provenanceBadge', 'ageText', 'estimatedBadge', 'freshnessHtml']) {
    vm.runInContext(extractFn(src, fn), sandbox);
  }
  return sandbox.freshnessHtml;
}

for (const w of WIDGETS) {
  test(`${w} freshness helper maps state honestly and escapes input`, () => {
    const freshnessHtml = buildFreshness(w);
    const now = new Date().toISOString();

    const current = freshnessHtml({ freshness: { updatedAt: now, stale: false, problem: false } }, 'Device refresh');
    assert.match(current, /Current/);
    assert.match(current, /b-current/);

    const stale = freshnessHtml({ freshness: { updatedAt: now, stale: true, problem: false } }, 'Device refresh');
    assert.match(stale, /Stale/);
    assert.doesNotMatch(stale, /b-current/);

    const problem = freshnessHtml({ freshness: { updatedAt: now, stale: false, problem: true } }, 'Device refresh');
    assert.match(problem, /Stale/, 'a connection problem is never shown as Current');
    assert.doesNotMatch(problem, /b-current/);

    const unknown = freshnessHtml({ freshness: { updatedAt: null } }, 'Device refresh');
    assert.match(unknown, /Unknown/);
    assert.match(unknown, /b-unknown/);

    // A malicious source label must be HTML-escaped, never injected raw.
    const evil = freshnessHtml({ freshness: { updatedAt: null } }, '<img src=x onerror=alert(1)>');
    assert.doesNotMatch(evil, /<img/);
    assert.match(evil, /&lt;img/);
  });
}

// --- Settings: no unsafe innerHTML with dynamic billing values ----------------

test('settings billing summary is built with safe DOM APIs, not innerHTML', () => {
  const src = fs.readFileSync(path.join(root, 'settings', 'index.html'), 'utf8');
  assert.doesNotMatch(src, /li\.innerHTML\s*=/, 'billing rows must not be injected via innerHTML');
  assert.match(src, /createTextNode|textContent/, 'billing rows use textContent/DOM nodes');
  assert.match(src, /<h2>Intelligent dispatch status<\/h2>/, 'dispatch status list has its own heading');
});
