'use strict';

import { createHash, randomBytes } from 'crypto';

/**
 * Privacy: persisted diagnostics/state maps must not be KEYED by raw identifiers
 * (account number, or a device id built from MPAN/MPRN + serial). Keying by a
 * per-install salted hash keeps casual/plaintext identifiers out of the persisted
 * blob and the settings UI. NOTE: the salt is stored in the same settings domain,
 * so a full settings/backup export contains both salt and hashes and remains open
 * to offline dictionary guessing of identifiers — this is pseudonymisation to stop
 * casual exposure, not export-proof confidentiality.
 *
 * The salt is a random per-install value stored once in settings; it is stable
 * across restarts so keys are consistent.
 */

interface SettingsHost {
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
}

const SALT_KEY = 'diagnostics_key_salt';

function installSalt(homey: SettingsHost): string {
  let salt = homey.settings.get(SALT_KEY) as string | undefined;
  if (!salt || typeof salt !== 'string') {
    salt = randomBytes(16).toString('hex');
    homey.settings.set(SALT_KEY, salt);
  }
  return salt;
}

/** Stable, per-install, identifier-free key for an identifier (account/device id). */
export function opaqueKey(homey: SettingsHost, identifier: string): string {
  return createHash('sha256').update(`${installSalt(homey)}|${identifier}`).digest('hex').slice(0, 24);
}

/**
 * Resolve the opaque key for an identifier within a settings map, lazily migrating
 * a legacy entry stored under the raw identifier to the opaque key (so functional
 * state — e.g. known saving-session IDs — is preserved across the upgrade and the
 * raw-keyed entry is pruned). Mutates `all` in place; the caller persists it.
 */
export function opaqueKeyMigrating(
  homey: SettingsHost, all: Record<string, unknown>, identifier: string,
): string {
  const key = opaqueKey(homey, identifier);
  if (Object.prototype.hasOwnProperty.call(all, identifier)) {
    // Only copy the legacy value if the opaque entry doesn't already exist, but
    // ALWAYS remove the raw-keyed entry so a plaintext identifier can never linger.
    if (all[key] === undefined) all[key] = all[identifier];
    delete all[identifier];
  }
  return key;
}
