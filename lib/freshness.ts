'use strict';

/**
 * Shared data-provenance / freshness convention (Foundation F1).
 *
 * A `Reading<T>` carries not just a value but *how much to trust it*:
 *  - `current`  — a fresh value from its source.
 *  - `stale`    — a previously good value that has not been refreshed (retain it,
 *                 but never present it as if it were current).
 *  - `unknown`  — no value is available yet.
 *
 * Sprint 42 defines and threads this struct internally; user-facing badges are a
 * later sprint. Nothing here is Homey- or network-specific so it is unit-testable
 * in isolation.
 */

export type FreshnessState = 'current' | 'stale' | 'unknown';

export type ReadingSource = 'graphql' | 'rest' | 'cache';

export interface Reading<T> {
  value: T | null;
  /** ISO timestamp the value was measured at (source of truth), else null. */
  readAt: string | null;
  source: ReadingSource;
  state: FreshnessState;
}

/** A reading with no value yet. */
export function unknownReading<T>(source: ReadingSource = 'graphql'): Reading<T> {
  return {
    value: null, readAt: null, source, state: 'unknown',
  };
}

/** A fresh reading. */
export function currentReading<T>(value: T, readAt: string | null, source: ReadingSource = 'graphql'): Reading<T> {
  return {
    value, readAt, source, state: 'current',
  };
}

/**
 * Whether a reading taken at `readAt` should now be considered stale, given how
 * often it is expected to refresh. A missing/invalid `readAt` is treated as stale.
 */
export function isStale(readAt: string | null, cadenceMs: number, now: number = Date.now()): boolean {
  if (!readAt) return true;
  const t = new Date(readAt).getTime();
  if (!Number.isFinite(t)) return true;
  // Allow up to two missed refresh cycles before declaring staleness.
  return now - t > Math.max(cadenceMs * 2, cadenceMs + 30_000);
}

/** Demote a previously current reading to `stale`, retaining its last value. */
export function staleFrom<T>(previous: Reading<T> | null): Reading<T> {
  if (!previous || previous.value === null) return unknownReading<T>(previous?.source);
  return { ...previous, state: 'stale' };
}
