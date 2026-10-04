'use strict';

// Read-only Homey evidence. Never prints device/Flow IDs, settings, credentials,
// provider payloads or raw errors; digests support before/after identity checks.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');

const execute = promisify(execFile);
const cli = process.argv[2] || 'homey';
const appId = 'uk.co.zarb.octopusenergy';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function read(...args) {
  // CLI 4.3.1 exits before large pipe output fully drains. Filter at source;
  // never expose the unrelated devices/Flows or their settings to stdout.
  if (args[0] === 'devices') args.push('--jq', 'with_entries(select((.value.driverUri // .value.driverId // "") | contains("uk.co.zarb.octopusenergy"))) | map_values({id,driverId,driverUri,capabilities,settings,available})');
  const { stdout } = await execute(cli, ['api', ...args, '--json', '--timeout', '15000'],
    { timeout: 25000, maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function main() {
  const [app, allDevices] = await Promise.all([
    read('apps', 'get-app', '--id', appId),
    read('devices', 'get-devices'),
  ]);
  const devices = Object.values(allDevices).filter((d) => String(d.driverUri || d.driverId).includes(appId)).sort((a, b) => a.id.localeCompare(b.id));
  const matches = [appId, ...devices.map((d) => d.id)].map((id) => `($s | contains(${JSON.stringify(id)}))`).join(' or ');
  const flowFilter = `with_entries((.value | tostring) as $s | select(${matches})) | map_values({id,enabled,trigger,conditions,actions,cards})`;
  const [allFlows, allAdvanced] = await Promise.all([
    read('flow', 'get-flows', '--jq', flowFilter),
    read('flow', 'get-advanced-flows', '--jq', flowFilter),
  ]);
  const flows = Object.values(allFlows).sort((a, b) => a.id.localeCompare(b.id));
  const advanced = Object.values(allAdvanced).sort((a, b) => a.id.localeCompare(b.id));
  const settingsDigest = digest(devices.map((d) => [d.id,
    Object.entries(d.settings || {}).sort(([a], [b]) => a.localeCompare(b))]));
  const flowDigest = digest(flows.map((f) => [f.id, f.enabled, f.trigger, f.conditions, f.actions]));
  let diagnostics = null;
  try {
    const d = await read('apps', 'get-app-setting', '--id', appId, '--name', 'dispatch_diagnostics_v2');
    diagnostics = {
      accounts: d?.accounts,
      eligible: d?.eligible,
      ineligible: d?.ineligible,
      unknown: d?.unknown,
      degraded: d?.degraded,
      stale: d?.stale,
      lastAttempt: d?.lastAttempt,
    };
  } catch (err) { /* Not-yet-populated diagnostics are an explicit gap. */ }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    version: app.version,
    ready: app.ready ?? null,
    crashed: app.crashed ?? null,
    enabled: app.enabled ?? null,
    devices: devices.length,
    unavailable: devices.filter((d) => d.available === false).length,
    identities: digest(devices.map((d) => [d.id, d.driverId, d.driverUri, d.capabilities])),
    settingsDigest,
    standardFlows: flows.length,
    flowDigest,
    advancedFlows: advanced.length,
    advancedFlowDigest: digest(advanced.map((f) => [f.id, f.enabled, f.cards])),
    diagnostics,
  }, null, 2));
}

main().catch(() => {
  console.error('Read-only Homey smoke check unavailable; no settings, devices or Flows changed.');
  process.exitCode = 1;
});
