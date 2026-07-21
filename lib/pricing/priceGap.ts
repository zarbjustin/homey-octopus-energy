'use strict';

/**
 * Pure price-refresh error classification, extracted from OctopusMeterDevice
 * (Phase 2 / S52 slice 3). Kept dependency-free so the recovery-trigger
 * condition is unit-testable and lives in one place.
 */

/**
 * Whether a price-refresh error is a recoverable "no rate covering now" gap
 * (as opposed to a hard failure like auth/network) — i.e. worth attempting
 * tariff rediscovery / product-variant recovery for. Matches the "no rate",
 * "no current rate", "no rate covering", 404 and "not found" shapes Octopus
 * surfaces when a tariff's rows do not cover the current instant.
 */
export function isRecoverablePriceGapError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /no (?:current )?.*rate|no rate covering|404|not found/i.test(message);
}
