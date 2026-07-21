'use strict';

import { createHash, randomBytes } from 'crypto';

/**
 * Privacy: persisted diagnostics/state maps must not be KEYED by raw identifiers
 * (account number, or a device id built from MPAN/MPRN + serial). A settings/backup
 * export would then leak those identifiers directly. Instead we key by a stable,
 * per-install salted hash: the blob contains no plaintext identifier, and
 * correlating a key back to an identifier requires both the install salt and a
 * guessed identifier.
 *
 * The salt is a random per-install value stored once in settings; it is stable
 * across restarts so keys are consistent, and never leaves the device.
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
  if (all[key] === undefined && Object.prototype.hasOwnProperty.call(all, identifier)) {
    all[key] = all[identifier];
    delete all[identifier];
  }
  return key;
}
