'use strict';

/**
 * Shared, identifier-safe error/log helpers. Previously duplicated across
 * OctopusMeterDevice, SavingSessionsPoller and DispatchPoller; consolidated here
 * (S52 decomposition, BL-09) so redaction is defined once.
 */

/**
 * Turn an error into a log-safe message: replace every provided secret with
 * `[redacted]`, collapse whitespace and cap the length. Accepts one or many
 * secrets (undefined/empty entries are ignored).
 */
export function redactSecrets(err: unknown, secrets: Array<string | undefined | null>): string {
  let message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  for (const secret of secrets) {
    // Skip empty/undefined secrets — replacing '' would interleave "[redacted]"
    // between every character (a latent bug in the previous per-poller copies).
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message.replace(/\s+/g, ' ').slice(0, 240);
}

/** Mask an account number for logs/keys (never the full number). */
export function maskAccount(accountNumber: string): string {
  if (!accountNumber || accountNumber.length <= 4) return 'account';
  return `${accountNumber.slice(0, 2)}***${accountNumber.slice(-2)}`;
}
