'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const compose = JSON.parse(fs.readFileSync(path.join(root, 'drivers/electricity/driver.flow.compose.json'), 'utf8'));
const card = (kind, id) => compose[kind].find((entry) => entry.id === id);

test('additive charging follow-up preserves every released electricity Flow contract', () => {
  const contracts = structuredClone(compose);
  const additions = new Set(['enough_threshold_time_before', 'charging_plan_decision_is', 'configure_charging_plan_standard', 'get_charging_plan_status', 'charging_plan_decision_changed', 'estimate_battery_duration']);
  for (const kind of Object.keys(contracts)) {
    contracts[kind] = contracts[kind].filter((entry) => !additions.has(entry.id));
    for (const entry of contracts[kind]) delete entry.hint;
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(contracts)).digest('hex');
  // v1.0.38 electricity compose, excluding presentation-only hint fields.
  assert.equal(hash, 'a5e332b65925e9abf7658bbf577da8d15dd93828316cb21f21eafeb5e8372809');
});

test('availability hints distinguish future slots from permission to charge now', () => {
  for (const id of ['threshold_slots_before', 'threshold_slots_available']) {
    const hint = card('conditions', id).hint.en;
    assert.match(hint, /not whether/);
    assert.match(hint, /Do not use this alone to start charging/);
    assert.match(hint, /unknown|missing data/i);
    assert.match(hint, /inverted|inversion/);
  }
  assert.match(card('conditions', 'charging_plan_active').hint.en, /active now/);
  assert.match(card('conditions', 'charging_plan_active').hint.en, /battery-change trigger/);
  assert.match(card('triggers', 'charging_plan_run_ended').hint.en, /separate stop Flow/);
  assert.match(card('triggers', 'charging_plan_run_ended').hint.en, /independent battery-native stop/);
});

test('current checks and legacy trigger hints do not promise periodic polling or a calendar-day plan', () => {
  assert.match(card('conditions', 'configured_price_band').hint.en, /directly.*Number tags/);
  assert.match(card('conditions', 'configured_price_band').hint.en, /not colour IDs/);
  assert.match(card('conditions', 'in_threshold_slot').hint.en, /does not.*trigger/);
  assert.match(card('conditions', 'is_cheapest_now').hint.en, /rolling.*window/);
  for (const id of ['price_changed', 'cheapest_slot_started']) {
    assert.match(card('triggers', id).hint.en, /numeric price change/);
    assert.match(card('triggers', id).hint.en, /Equal-priced adjacent/);
  }
  assert.match(card('actions', 'configure_charging_plan').hint.en, /Local timers use cached prices/);
});

test('the Standard Flow guide includes late battery events, separate stops and explicit field limits', () => {
  const guide = fs.readFileSync(path.join(root, 'docs/charging-flows.md'), 'utf8');
  assert.ok(card('actions', 'configure_charging_plan').tokens.length > 0);
  assert.equal(card('actions', 'configure_charging_plan_standard').tokens, undefined);
  assert.deepEqual(card('actions', 'configure_charging_plan_standard').args, card('actions', 'configure_charging_plan').args);
  assert.match(guide, /only in Advanced Flow/);
  assert.match(guide, /not yet released/);
  assert.match(guide, /Configure a charging eligibility plan \(Standard compatible\)/);
  assert.match(guide, /Start if the battery becomes low during an active period/);
  assert.match(guide, /Stop when the selected period ends/);
  assert.match(guide, /Do not put a price, plan-active or battery-low condition before stop/);
  assert.match(guide, /independent battery-native.*stop/);
  assert.match(guide, /nearly simultaneous triggers can both run/);
  assert.match(guide, /Standard Flow Else is not an error handler/);
  assert.match(guide, /not real-Homey or battery\s+acceptance/);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /docs\/charging-flows\.md/);
});
