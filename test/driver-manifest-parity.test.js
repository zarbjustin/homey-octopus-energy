'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

/**
 * Sprint 47 — enforce byte-consistency between each driver's Flow compose source
 * (drivers/<id>/driver.flow.compose.json) and the generated app.json, since there
 * is no `homey app build` here. Homey injects a leading device arg
 * `{type:'device',name:'device',filter:'driver_id=<id>'}` into every driver card;
 * we strip it before comparing the rest.
 */

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const flow = app.flow || {};

function appCardsByDriver(kind, driver) {
  const filter = `driver_id=${driver}`;
  const map = new Map();
  for (const card of flow[kind] || []) {
    const first = (card.args || [])[0];
    if (first && first.type === 'device' && first.name === 'device' && first.filter === filter) {
      map.set(card.id, card);
    }
  }
  return map;
}

for (const driver of ['electricity', 'export', 'gas']) {
  const composePath = path.join(root, 'drivers', driver, 'driver.flow.compose.json');
  if (!fs.existsSync(composePath)) continue;
  const compose = JSON.parse(fs.readFileSync(composePath, 'utf8'));
  for (const kind of ['triggers', 'conditions', 'actions']) {
    const byId = appCardsByDriver(kind, driver);
    // Reverse direction: no stale/extra driver card may live in app.json.
    test(`app.json ${driver} ${kind} has no cards absent from compose`, () => {
      const composeIds = new Set((compose[kind] || []).map((c) => c.id));
      for (const id of byId.keys()) {
        assert.ok(composeIds.has(id), `${driver} ${kind}.${id} is in app.json but not in compose`);
      }
    });
    for (const card of compose[kind] || []) {
      test(`app.json ${driver} ${kind} matches compose for ${card.id}`, () => {
        const appCard = byId.get(card.id);
        assert.ok(appCard, `${driver} ${kind}.${card.id} missing from app.json (or missing its device arg)`);
        const dev = appCard.args[0];
        assert.deepStrictEqual(dev, { type: 'device', name: 'device', filter: `driver_id=${driver}` });
        const stripped = { ...appCard, args: appCard.args.slice(1) };
        if (!card.args) delete stripped.args; // compose card had no args
        assert.deepStrictEqual(
          stripped, card,
          `${driver} ${kind}.${card.id} differs between compose and app.json — hand-sync them`,
        );
      });
    }
  }
}
