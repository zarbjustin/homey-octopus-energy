'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

for (const driver of ['electricity', 'gas', 'export']) {
  test(`${driver} Flow cards all have runtime implementations`, () => {
    const compose = JSON.parse(read(`drivers/${driver}/driver.flow.compose.json`));
    const runtime = `${read(`drivers/${driver}/driver.ts`)}\n${read(`drivers/${driver}/device.ts`)}`;
    for (const kind of ['triggers', 'conditions', 'actions']) {
      for (const card of compose[kind] ?? []) {
        assert.match(runtime, new RegExp(`['"]${card.id}['"]`), `${kind}.${card.id} is not referenced`);
      }
    }
  });
}

test('app-level Flow cards all have runtime implementations', () => {
  const flowDir = path.join(root, '.homeycompose', 'flow');
  const runtime = [
    'app.ts', 'lib/OctopusMeterDevice.ts', 'lib/DispatchPoller.ts', 'lib/SavingSessionsPoller.ts',
  ].map(read).join('\n');
  for (const kind of ['triggers', 'conditions']) {
    const dir = path.join(flowDir, kind);
    for (const name of fs.readdirSync(dir)) {
      const card = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      assert.match(runtime, new RegExp(`['"]${card.id}['"]`), `${kind}.${card.id} is not referenced`);
    }
  }
});
