'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

/**
 * Sprint 44 — enforce byte-consistency between the app-level Flow compose
 * sources (.homeycompose/flow/**) and the generated app.json. This is the guard
 * that lets us hand-edit both without `homey app build`: any drift fails CI.
 */

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const flow = app.flow || {};

for (const kind of ['triggers', 'conditions', 'actions']) {
  const dir = path.join(root, '.homeycompose', 'flow', kind);
  if (!fs.existsSync(dir)) continue;
  const appById = new Map((flow[kind] || []).map((c) => [c.id, c]));

  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const compose = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    test(`app.json flow.${kind} matches compose for ${compose.id}`, () => {
      const appCard = appById.get(compose.id);
      assert.ok(appCard, `flow.${kind}.${compose.id} is missing from app.json`);
      assert.deepStrictEqual(
        appCard, compose,
        `flow.${kind}.${compose.id} differs between .homeycompose and app.json — regenerate or hand-sync them`,
      );
    });
  }
}
